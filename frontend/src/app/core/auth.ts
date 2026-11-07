import { HttpClient, HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { RedirectCommand, Router, type CanActivateFn, type UrlTree } from '@angular/router';
import { catchError, firstValueFrom, throwError } from 'rxjs';
import type { AuthUser, MeResponse } from './models';

export interface PortalAccessStatus {
  granted: boolean;
  expiresAt: string | null;
}

/** Signed-in staff user for the admin portal. The session itself lives in an HttpOnly cookie. */
@Injectable({ providedIn: 'root' })
export class AuthStore {
  private readonly http = inject(HttpClient);
  readonly me = signal<MeResponse | null>(null);
  readonly user = computed<AuthUser | null>(() => this.me()?.user ?? null);
  /** "replaced" when this browser was signed out because the account signed in on another device. */
  readonly signedOutReason = signal<string | null>(null);

  /** Makes sure the XSRF cookie exists before the first POST. */
  async ensureCsrf(): Promise<void> {
    if (typeof document !== 'undefined' && !document.cookie.includes('XSRF-TOKEN=')) {
      await firstValueFrom(this.http.get('/api/v1/auth/csrf'));
    }
  }

  async refresh(): Promise<MeResponse | null> {
    try {
      const res = await firstValueFrom(this.http.get<MeResponse | { user: null; signedOutReason?: string | null }>('/api/v1/auth/me'));
      this.me.set(res.user ? (res as MeResponse) : null);
      this.signedOutReason.set(res.user ? null : ('signedOutReason' in res ? (res.signedOutReason ?? null) : null));
    } catch {
      this.me.set(null);
    }
    return this.me();
  }

  async login(email: string, password: string): Promise<{ twoFactorRequired: boolean }> {
    await this.ensureCsrf();
    const res = await firstValueFrom(this.http.post<{ twoFactorRequired: boolean }>('/api/v1/auth/login', { email, password }));
    await this.refresh();
    return res;
  }

  async verify(code: string) {
    await firstValueFrom(this.http.post('/api/v1/auth/2fa/verify', { code }));
    await this.refresh();
  }

  beginSetup() {
    return firstValueFrom(this.http.post<{ secret: string; otpauthUri: string }>('/api/v1/auth/2fa/setup', {}));
  }

  async enable(code: string) {
    await firstValueFrom(this.http.post('/api/v1/auth/2fa/enable', { code }));
    await this.refresh();
  }

  changePassword(currentPassword: string, newPassword: string) {
    return firstValueFrom(this.http.post('/api/v1/auth/change-password', { currentPassword, newPassword }));
  }

  /** Whether this browser opened a valid staff sign-in link in the last few minutes. */
  async portalAccess(): Promise<PortalAccessStatus> {
    try {
      return await firstValueFrom(this.http.get<PortalAccessStatus>('/api/v1/auth/portal-access'));
    } catch {
      return { granted: false, expiresAt: null };
    }
  }

  /** Checks the token from a sign-in link. The server sets the pass as an HttpOnly cookie. */
  async verifyAccessKey(key: string): Promise<void> {
    await this.ensureCsrf();
    await firstValueFrom(this.http.post('/api/v1/auth/portal-access', { key }));
  }

  async logout(everywhere = false) {
    await firstValueFrom(this.http.post(everywhere ? '/api/v1/auth/logout-all' : '/api/v1/auth/logout', {})).catch(() => undefined);
    this.me.set(null);
  }

  /** True when the user holds the permission globally or on at least one section. */
  can(permission: string): boolean {
    const u = this.user();
    return !!u && (u.permissions.includes(permission) || u.scopedPermissions.some((p) => p.permission === permission));
  }

  /** True when the user holds at least one of the permissions. */
  canAny(permissions: readonly string[]): boolean {
    return permissions.some((p) => this.can(p));
  }
}

/** Admissions setup by area, each with create, edit and delete. Mirrors SETUP_PERMISSIONS in the API. */
export const SETUP_PERMISSIONS = {
  programmes: ['programmes.create', 'programmes.edit', 'programmes.delete'],
  shortCourses: ['short_courses.create', 'short_courses.edit', 'short_courses.delete'],
  intakes: ['intakes.create', 'intakes.edit', 'intakes.delete'],
  documents: ['document_types.create', 'document_types.edit', 'document_types.delete'],
} as const;

/** Any part of admissions setup. */
export const ADMISSIONS_SETUP_PERMISSIONS = Object.values(SETUP_PERMISSIONS).flat();

/** Website content: pages and blog posts. Mirrors CONTENT_PERMISSIONS in the API. */
export const CONTENT_PERMISSIONS = ['pages.create', 'pages.edit', 'pages.publish', 'pages.delete'] as const;

/**
 * Route data { anyOf: [...] }: the user needs at least one of these permissions, otherwise they see
 * the "no access" page. The API enforces the same rules; this only keeps people out of empty screens.
 */
export const permissionGuard: CanActivateFn = (route): boolean | UrlTree => {
  const anyOf = route.data['anyOf'] as string[] | undefined;
  return !anyOf?.length || inject(AuthStore).canAny(anyOf) ? true : inject(Router).createUrlTree(['/admin/no-access']);
};

/**
 * The site's own "page not found", shown at the address that was asked for. Used for every /admin
 * address a visitor may not see, so the admin portal does not reveal itself. The web server sends the
 * same page with a 404 status when the address is loaded directly.
 */
export function notFound(router: Router): RedirectCommand {
  return new RedirectCommand(router.parseUrl('/admin-page-not-found'), { skipLocationChange: true });
}

/** The admin portal: only for staff with a session. Everyone else sees "page not found". */
export const adminGuard: CanActivateFn = async (): Promise<boolean | UrlTree | RedirectCommand> => {
  const auth = inject(AuthStore);
  const router = inject(Router);
  const me = auth.me() ?? (await auth.refresh());
  if (!me) return notFound(router);
  if (me.twoFactorPending) return router.createUrlTree(['/admin/login']);
  if (me.twoFactorSetupRequired) return router.createUrlTree(['/admin/two-step-setup']);
  if (!auth.can('admin.access')) return notFound(router);
  return true;
};

/** Pages that only make sense part-way through signing in (the code step, setting up two-step login). */
export const signingInGuard: CanActivateFn = async (): Promise<boolean | RedirectCommand> => {
  const auth = inject(AuthStore);
  const router = inject(Router);
  return (auth.me() ?? (await auth.refresh())) ? true : notFound(router);
};

/**
 * /admin/<token>: the staff sign-in page, reached only through a valid sign-in link. Opening the link
 * gives this browser a pass for a few minutes; the API refuses staff sign-in without it.
 * Anyone already signed in goes straight to the portal.
 */
export const signInLinkGuard: CanActivateFn = async (route): Promise<boolean | UrlTree | RedirectCommand> => {
  // Both injected before the first await: inject() only works synchronously in a guard.
  const auth = inject(AuthStore);
  const router = inject(Router);
  const me = auth.me() ?? (await auth.refresh());
  // Just opened from the address bar: the web server has already checked this link for this visitor.
  if (!me && (await auth.portalAccess()).granted) return true;
  try {
    // Checked as whoever is signed in: someone else's link is "not found" for them too.
    await auth.verifyAccessKey(route.paramMap.get('token') ?? '');
  } catch {
    return notFound(router);
  }
  return me && !me.twoFactorPending ? router.createUrlTree(['/admin']) : true;
};

/**
 * A staff member signed in on another device: leave the portal for the website instead of leaving an
 * error on whatever screen they were using. Their sign-in link explains why when they open it again.
 */
export const sessionReplacedInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const auth = inject(AuthStore);
  return next(req).pipe(
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse && err.status === 401 && (err.error as { code?: string } | null)?.code === 'SESSION_REPLACED') {
        auth.me.set(null);
        // The sign-in page is only reachable through a sign-in link, so go back to the website.
        if (router.url.startsWith('/admin')) void router.navigateByUrl('/');
      }
      return throwError(() => err);
    }),
  );
};
