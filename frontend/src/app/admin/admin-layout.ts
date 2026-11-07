import { Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { ADMISSIONS_SETUP_PERMISSIONS, AuthStore, CONTENT_PERMISSIONS } from '../core/auth';
import { SiteStore } from '../core/site';
import { Icon, type IconName } from './icon';

interface NavItem {
  label: string;
  path: string;
  /** Shown to people with at least one of these. */
  permission: string | readonly string[];
  icon: IconName;
  exact?: boolean;
}

const NAV: { heading: string; items: NavItem[] }[] = [
  {
    heading: '',
    items: [{ label: 'Dashboard', path: '/admin', permission: 'admin.access', icon: 'dashboard', exact: true }],
  },
  {
    heading: 'Content',
    items: [
      { label: 'Pages', path: '/admin/pages', permission: CONTENT_PERMISSIONS, icon: 'pages' },
      { label: 'Blog', path: '/admin/blog', permission: CONTENT_PERMISSIONS, icon: 'pages' },
      { label: 'Media library', path: '/admin/media', permission: [...CONTENT_PERMISSIONS, 'media.upload', 'media.edit', 'media.delete'], icon: 'media' },
      { label: 'Menus', path: '/admin/menus', permission: 'menus.edit', icon: 'menu' },
    ],
  },
  {
    heading: 'Admissions',
    items: [
      { label: 'Applications', path: '/admin/applications', permission: 'applications.view', icon: 'inbox' },
      { label: 'Applicants', path: '/admin/applicants', permission: 'applicants.manage', icon: 'users' },
      { label: 'Admissions setup', path: '/admin/admissions-setup', permission: ADMISSIONS_SETUP_PERMISSIONS, icon: 'cap' },
    ],
  },
  {
    heading: 'Academics',
    items: [{ label: 'Timetable', path: '/admin/timetable', permission: 'timetable.manage', icon: 'calendar' }],
  },
  {
    heading: 'Site',
    items: [
      { label: 'Site settings', path: '/admin/settings', permission: 'settings.edit', icon: 'sliders' },
      { label: 'Languages', path: '/admin/languages', permission: 'settings.edit', icon: 'globe' },
      { label: 'Interface text', path: '/admin/text', permission: 'text_strings.edit', icon: 'text' },
      { label: 'Redirects', path: '/admin/redirects', permission: 'redirects.edit', icon: 'redirect' },
    ],
  },
  {
    heading: 'System',
    items: [
      { label: 'Staff users', path: '/admin/users', permission: 'users.manage', icon: 'users' },
      { label: 'Access control', path: '/admin/access-control', permission: ['access.manage', 'users.manage'], icon: 'shield' },
      { label: 'Staff sign-in links', path: '/admin/access-management', permission: 'portal_keys.manage', icon: 'key' },
      { label: 'Audit log', path: '/admin/audit', permission: 'audit.view', icon: 'shield' },
    ],
  },
];

/** "super_admin" -> "Super admin" */
const roleLabel = (key: string) => key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ');

/** Admin shell: grouped navigation filtered by the user's permissions, and the top bar. */
@Component({
  selector: 'app-admin-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon],
  template: `
    <div class="shell">
      <aside class="side" [class.side--open]="navOpen()" id="admin-nav">
        <a routerLink="/admin" class="brand" (click)="navOpen.set(false)">
          <span class="brand__text">
            <strong>{{ site.institutionName() || 'Website' }}</strong>
            <small>Admin portal</small>
          </span>
        </a>
        <button type="button" class="side__close" (click)="navOpen.set(false)" aria-label="Close menu"><app-icon name="close" /></button>

        <nav aria-label="Admin">
          @for (group of groups(); track group.heading) {
            @if (group.heading) {
              <p class="group">{{ group.heading }}</p>
            }
            <ul>
              @for (item of group.items; track item.path) {
                <li>
                  <a [routerLink]="item.path" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: !!item.exact }" (click)="navOpen.set(false)">
                    <app-icon [name]="item.icon" />
                    <span>{{ item.label }}</span>
                  </a>
                </li>
              }
            </ul>
          }
        </nav>

        <a class="side__site" href="/" target="_blank" rel="noopener">
          <app-icon name="external" [size]="16" /> View website
        </a>
      </aside>
      @if (navOpen()) {
        <div class="scrim" (click)="navOpen.set(false)" aria-hidden="true"></div>
      }

      <div class="body">
        <header class="top">
          <button type="button" class="a-btn a-btn--icon menu-btn" (click)="navOpen.set(true)" aria-controls="admin-nav" [attr.aria-expanded]="navOpen()" aria-label="Open menu">
            <app-icon name="menu" />
          </button>
          <div class="top__spacer"></div>
          <a routerLink="/admin/account" class="me" title="My account">
            <span class="me__avatar" aria-hidden="true">{{ initials(auth.user()?.fullName ?? '') }}</span>
            <span class="me__text">
              <strong>{{ auth.user()?.fullName }}</strong>
              <small>{{ role() }}</small>
            </span>
          </a>
          <button type="button" class="a-btn a-btn--icon" (click)="logout()" aria-label="Sign out" title="Sign out"><app-icon name="logout" /></button>
        </header>
        <main class="content"><router-outlet /></main>
      </div>
    </div>
  `,
  styles: `
    .shell { display: grid; grid-template-columns: 16.5rem 1fr; min-height: 100vh; }

    .side {
      position: sticky; top: 0; height: 100vh; overflow-y: auto;
      display: flex; flex-direction: column; gap: 0.25rem; padding: 1rem 0.85rem;
      background: linear-gradient(180deg, var(--a-navy) 0%, #00144a 100%); color: #c5d1e8;
    }
    .brand { display: flex; align-items: center; gap: 0.7rem; padding: 0.35rem 0.5rem 1rem; margin-bottom: 0.25rem; border-bottom: 1px solid rgb(255 255 255 / 0.08); text-decoration: none; color: #fff; }
    .brand__text { display: grid; gap: 0.1rem; line-height: 1.2; min-width: 0; }
    .brand__text strong { font-size: 1rem; line-height: 1.2; overflow-wrap: anywhere; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; }
    .brand__text small { color: #93a4c4; font-size: 0.8rem; }
    .side__close { display: none; }

    .group { margin: 1rem 0.65rem 0.35rem; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: #8193b6; }
    .side ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
    .side nav a {
      position: relative; display: flex; align-items: center; gap: 0.7rem;
      padding: 0.55rem 0.7rem; border-radius: 9px; color: #c5d1e8; text-decoration: none; font-weight: 550;
      transition: background-color 0.15s ease, color 0.15s ease;
    }
    .side nav a app-icon { color: #8fa3c9; transition: color 0.15s ease; }
    .side nav a:hover { background: rgb(255 255 255 / 0.07); color: #fff; }
    .side nav a:hover app-icon { color: #fff; }
    .side nav a.active { background: rgb(255 255 255 / 0.12); color: #fff; }
    .side nav a.active app-icon { color: var(--a-accent); }
    .side nav a.active::before { content: ''; position: absolute; left: -0.85rem; top: 0.45rem; bottom: 0.45rem; width: 4px; border-radius: 0 4px 4px 0; background: var(--a-accent); }
    .side nav a:focus-visible { outline: 2px solid var(--a-accent); outline-offset: 1px; }

    .side__site { margin-top: auto; display: flex; align-items: center; gap: 0.5rem; padding: 0.65rem 0.7rem; border-radius: 9px; color: #c5d1e8; text-decoration: none; font-size: 0.9rem; border: 1px solid rgb(255 255 255 / 0.12); }
    .side__site:hover { background: rgb(255 255 255 / 0.07); color: #fff; }

    .body { min-width: 0; display: flex; flex-direction: column; }
    .top {
      position: sticky; top: 0; z-index: 400; display: flex; gap: 0.6rem; align-items: center;
      padding: 0.6rem 1.75rem; min-height: 3.75rem;
      background: rgb(255 255 255 / 0.85); backdrop-filter: saturate(180%) blur(10px);
      border-bottom: 1px solid var(--a-line);
    }
    .top__spacer { flex: 1; }
    .menu-btn { display: none; }
    .me { display: flex; align-items: center; gap: 0.6rem; padding: 0.25rem 0.75rem 0.25rem 0.3rem; border-radius: 999px; text-decoration: none; color: var(--a-text); transition: background-color 0.15s ease; }
    .me:hover { background: #eef2f8; }
    .me__avatar { display: grid; place-items: center; width: 2.1rem; height: 2.1rem; border-radius: 50%; background: linear-gradient(135deg, var(--a-primary), var(--a-navy)); color: #fff; font-weight: 700; font-size: 0.8rem; }
    .me__text { display: grid; line-height: 1.2; }
    .me__text strong { font-size: 0.88rem; }
    .me__text small { color: var(--a-muted); font-size: 0.75rem; }

    .content { padding: 1.75rem; min-width: 0; width: 100%; max-width: 1440px; }
    .scrim { display: none; }

    @media (max-width: 900px) {
      .shell { grid-template-columns: 1fr; }
      .side { position: fixed; z-index: 600; inset: 0 auto 0 0; width: min(18rem, 85vw); translate: -100% 0; transition: translate 0.22s ease; box-shadow: var(--a-shadow-lg); }
      .side--open { translate: 0 0; }
      .side__close { display: inline-flex; position: absolute; top: 1.1rem; right: 0.75rem; background: none; border: 0; color: #c5d1e8; padding: 0.35rem; cursor: pointer; border-radius: 8px; }
      .brand { padding-right: 2.5rem; }
      .scrim { display: block; position: fixed; inset: 0; z-index: 550; background: rgb(0 18 64 / 0.4); }
      .menu-btn { display: inline-flex; }
      .top { padding: 0.5rem 1rem; }
      .me__text { display: none; }
      .content { padding: 1rem; }
    }
    @media (prefers-reduced-motion: reduce) {
      .side { transition: none; }
    }
  `,
})
export class AdminLayout {
  protected readonly auth = inject(AuthStore);
  protected readonly site = inject(SiteStore);
  private readonly router = inject(Router);
  protected readonly navOpen = signal(false);

  protected readonly groups = computed(() =>
    NAV.map((g) => ({ ...g, items: g.items.filter((i) => this.auth.canAny(typeof i.permission === 'string' ? [i.permission] : i.permission)) })).filter((g) => g.items.length),
  );
  protected readonly role = computed(() => {
    const roles = this.auth.user()?.roles ?? [];
    return roles.length ? roles.map(roleLabel).join(', ') : 'Staff';
  });

  constructor() {
    void this.site.load();
    this.router.events
      .pipe(
        filter((e) => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.navOpen.set(false));
  }

  protected initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || 'A';
  }

  async logout() {
    await this.auth.logout();
    await this.router.navigateByUrl('/');
  }
}
