import { HttpClient, HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { Router, type CanActivateFn, type UrlTree } from '@angular/router';
import { catchError, firstValueFrom, throwError } from 'rxjs';
import type { AuthUser, MeResponse } from './models';

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

/** Sends visitors to the right step: sign in, enter code, or set up two-step login. */
export const adminGuard: CanActivateFn = async (): Promise<boolean | UrlTree> => {
  const auth = inject(AuthStore);
  const router = inject(Router);
  const me = auth.me() ?? (await auth.refresh());
  if (!me) return router.createUrlTree(['/admin/login'], auth.signedOutReason() === 'replaced' ? { queryParams: { reason: 'replaced' } } : {});
  if (me.twoFactorPending) return router.createUrlTree(['/admin/login'], { queryParams: { step: 'code' } });
  if (me.twoFactorSetupRequired) return router.createUrlTree(['/admin/two-step-setup']);
  if (!auth.can('admin.access')) return router.createUrlTree(['/admin/login'], { queryParams: { denied: 1 } });
  return true;
};

/**
 * A staff member signed in on another device: send this browser to the sign-in page with the reason,
 * instead of leaving an error on whatever screen they were using.
 */
export const sessionReplacedInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const auth = inject(AuthStore);
  return next(req).pipe(
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse && err.status === 401 && (err.error as { code?: string } | null)?.code === 'SESSION_REPLACED') {
        auth.me.set(null);
        if (router.url.startsWith('/admin') && !router.url.startsWith('/admin/login'))
          void router.navigate(['/admin/login'], { queryParams: { reason: 'replaced' } });
      }
      return throwError(() => err);
    }),
  );
};
