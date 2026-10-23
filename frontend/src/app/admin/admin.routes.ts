import type { Routes } from '@angular/router';
import { ADMISSIONS_SETUP_PERMISSIONS, adminGuard, CONTENT_PERMISSIONS, permissionGuard } from '../core/auth';
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
import { SettingsEditor } from './site/settings-editor';
import { TextEditor } from './site/text-editor';
import { TermWorkspace } from './timetable/term-workspace';
import { TimetableHome } from './timetable/timetable-home';
import { TwoStepSetup } from './two-step-setup';
import { AccessControl } from './users/access-control';
import { NoAccess } from './users/no-access';
import { UsersAdmin } from './users/users-admin';

/** Lets in only people with at least one of these permissions. */
const only = (...anyOf: string[]) => ({ canActivate: [permissionGuard], data: { anyOf } });

export const adminRoutes: Routes = [
  {
    path: '',
    component: AdminRoot,
    children: [
      { path: 'login', component: AdminLogin },
      { path: 'two-step-setup', component: TwoStepSetup },
      {
        path: '',
        component: AdminLayout,
        canActivate: [adminGuard],
        children: [
          { path: '', pathMatch: 'full', component: Dashboard },
          { path: 'pages', component: PagesList, ...only(...CONTENT_PERMISSIONS) },
          { path: 'pages/:id', component: PageEditor, canDeactivate: [unsavedChangesGuard], ...only(...CONTENT_PERMISSIONS) },
          { path: 'blog', component: BlogList, ...only(...CONTENT_PERMISSIONS) },
          { path: 'blog/:id', component: BlogEditor, canDeactivate: [blogUnsavedChangesGuard], ...only(...CONTENT_PERMISSIONS) },
          { path: 'applications', component: ApplicationsList, ...only('applications.view') },
          { path: 'applications/:id', component: ApplicationDetail, ...only('applications.view') },
          { path: 'applicants', component: ApplicantsList, ...only('applicants.manage') },
          { path: 'admissions-setup', component: AdmissionsSetup, ...only(...ADMISSIONS_SETUP_PERMISSIONS) },
          { path: 'timetable', component: TimetableHome, ...only('timetable.manage') },
          { path: 'timetable/:id', component: TermWorkspace, ...only('timetable.manage') },
          { path: 'media', component: MediaLibrary, ...only(...CONTENT_PERMISSIONS, 'media.upload', 'media.edit', 'media.delete') },
          { path: 'menus', component: MenusEditor, ...only('menus.edit') },
          { path: 'settings', component: SettingsEditor, ...only('settings.edit') },
          { path: 'languages', component: LanguagesEditor, ...only('settings.edit') },
          { path: 'text', component: TextEditor, ...only('text_strings.edit') },
          { path: 'redirects', component: RedirectsEditor, ...only('redirects.edit') },
          { path: 'users', component: UsersAdmin, ...only('users.manage') },
          { path: 'access', component: AccessControl, ...only('access.manage', 'users.manage') },
          { path: 'audit', component: AuditLog, ...only('audit.view') },
          { path: 'account', component: Account },
          { path: 'no-access', component: NoAccess },
        ],
      },
    ],
  },
];
