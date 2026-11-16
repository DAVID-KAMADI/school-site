import type { Routes } from '@angular/router';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import {
  ADMISSIONS_SETUP_PERMISSIONS,
  adminGuard,
  CONTENT_PERMISSIONS,
  notFound,
  permissionGuard,
  signingInGuard,
  signInLinkGuard,
} from '../core/auth';
import { PortalKeys } from './users/portal-keys';
import { Backups } from './system/backups';
import { MessagingSettingsPage } from './system/messaging-settings';
import { FollowUps } from './applications/follow-ups';
import { AuthStore } from '../core/auth';
import { Account } from './account';
import { ApplicantsList } from './applications/applicants-list';
import { AdmissionsSetup } from './applications/admissions-setup';
import { ApplicationDetail } from './applications/application-detail';
import { ApplicationsList } from './applications/applications-list';
import { AdminLayout } from './admin-layout';
import { Dashboard } from './dashboard/dashboard';
import { BlogEditor, blogUnsavedChangesGuard } from './blog/blog-editor';
import { BlogList } from './blog/blog-list';
import { AdminRoot } from './admin-root';
import { AdminLogin } from './login';
import { MediaLibrary } from './media/media-library';
import { PageEditor, unsavedChangesGuard } from './pages/page-editor';
import { PagesList } from './pages/pages-list';
import { AuditLog } from './site/audit-log';
import { LanguagesEditor } from './site/languages-editor';
import { MenusEditor } from './site/menus-editor';
import { RedirectsEditor } from './site/redirects-editor';
import { PopupsEditor } from './site/popups-editor';
import { SettingsEditor } from './site/settings-editor';
import { MaintenanceModeEditor } from './site/maintenance-mode';
import { TextEditor } from './site/text-editor';
import { TermWorkspace } from './timetable/term-workspace';
import { TimetableHome } from './timetable/timetable-home';
import { TwoStepSetup } from './two-step-setup';
import { AccessControl } from './users/access-control';
import { NoAccess } from './users/no-access';
import { UsersAdmin } from './users/users-admin';

/** Backups & restore, SMS & email: super administrators only (the API checks the same). */
const superAdminOnly = () =>
  inject(AuthStore).user()?.roles.includes('super_admin') || inject(Router).createUrlTree(['/admin/no-access']);

/** Lets in only people with at least one of these permissions. */
const only = (...anyOf: string[]) => ({ canActivate: [permissionGuard], data: { anyOf } });

export const adminRoutes: Routes = [
  {
    path: '',
    component: AdminRoot,
    children: [
      // The code step of sign-in, for someone who has already entered their password.
      { path: 'login', component: AdminLogin, canActivate: [signingInGuard] },
      { path: 'two-step-setup', component: TwoStepSetup, canActivate: [signingInGuard] },
      {
        path: '',
        component: AdminLayout,
        canActivate: [adminGuard],
        children: [
          { path: '', pathMatch: 'full', component: Dashboard },
          { path: 'dashboard', pathMatch: 'full', redirectTo: '' },
          { path: 'pages', component: PagesList, ...only(...CONTENT_PERMISSIONS) },
          { path: 'pages/:id', component: PageEditor, canDeactivate: [unsavedChangesGuard], ...only(...CONTENT_PERMISSIONS) },
          { path: 'blog', component: BlogList, ...only(...CONTENT_PERMISSIONS) },
          { path: 'blog/:id', component: BlogEditor, canDeactivate: [blogUnsavedChangesGuard], ...only(...CONTENT_PERMISSIONS) },
          { path: 'applications', component: ApplicationsList, ...only('applications.view') },
          { path: 'applications/:id', component: ApplicationDetail, ...only('applications.view') },
          { path: 'applicants', component: ApplicantsList, ...only('applicants.manage') },
          { path: 'follow-ups', component: FollowUps, ...only('applicants.manage') },
          { path: 'admissions-setup', component: AdmissionsSetup, ...only(...ADMISSIONS_SETUP_PERMISSIONS) },
          { path: 'timetable', component: TimetableHome, ...only('timetable.manage') },
          { path: 'timetable/:id', component: TermWorkspace, ...only('timetable.manage') },
          { path: 'media', component: MediaLibrary, ...only(...CONTENT_PERMISSIONS, 'media.upload', 'media.edit', 'media.delete') },
          { path: 'menus', component: MenusEditor, ...only('menus.edit') },
          { path: 'settings', component: SettingsEditor, ...only('settings.edit') },
          { path: 'languages', component: LanguagesEditor, ...only('settings.edit') },
          { path: 'text', component: TextEditor, ...only('text_strings.edit') },
          { path: 'popups', component: PopupsEditor, ...only('settings.edit') },
          { path: 'redirects', component: RedirectsEditor, ...only('redirects.edit') },
          { path: 'maintenance', component: MaintenanceModeEditor, ...only('settings.edit') },
          { path: 'users', component: UsersAdmin, ...only('users.manage') },
          { path: 'access-control', component: AccessControl, ...only('access.manage', 'users.manage') },
          { path: 'access-management', component: PortalKeys, ...only('portal_keys.manage') },
          { path: 'backups', component: Backups, canActivate: [superAdminOnly] },
          { path: 'messaging', component: MessagingSettingsPage, canActivate: [superAdminOnly] },
          { path: 'audit', component: AuditLog, ...only('audit.view') },
          { path: 'account', component: Account },
          { path: 'no-access', component: NoAccess },
        ],
      },
      // Staff sign-in, only through a personal sign-in link: /admin/<token>. Without one, /admin shows "page not found".
      { path: ':token', component: AdminLogin, canActivate: [signInLinkGuard] },
      { path: '**', component: AdminLogin, canActivate: [() => notFound(inject(Router))] },
    ],
  },
];
