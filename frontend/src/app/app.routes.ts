import { inject } from '@angular/core';
import { Router, type ActivatedRouteSnapshot, type RouterStateSnapshot, type Routes } from '@angular/router';
import { SiteStore } from './core/site';
import { CmsPage, cmsPageResolver } from './public/cms-page';
import { PreviewPage, previewResolver } from './public/preview-page';
import { PublicLayout } from './public/public-layout';
import { BlogList } from './public/blog/blog-list';
import { BlogPostPage } from './public/blog/blog-post';
import { blogListResolver, blogPostResolver } from './public/blog/blog-resolvers';

export const routes: Routes = [
  // Admin portal: loaded only when staff open /admin, so visitors never download it.
  { path: 'admin', loadChildren: () => import('./admin/admin.routes').then((m) => m.adminRoutes) },

  {
    path: '',
    component: PublicLayout,
    // First visit: show the site in the browser's language when it is one of the site's languages.
    canActivate: [
      async (_route: ActivatedRouteSnapshot, state: RouterStateSnapshot) => {
        const target = await inject(SiteStore).detect(state.url);
        return target ? inject(Router).parseUrl(target) : true;
      },
    ],
    // Re-run on every navigation so the header, footer and text follow the language in the address.
    resolve: { site: (_route: ActivatedRouteSnapshot, state: RouterStateSnapshot) => inject(SiteStore).loadFor(state.url) },
    runGuardsAndResolvers: 'always',
    children: [
      { path: 'preview/:token', component: PreviewPage, resolve: { preview: previewResolver } },
      { path: 'blog', component: BlogList, resolve: { result: blogListResolver } },
      { path: 'blog/:slug', component: BlogPostPage, resolve: { post: blogPostResolver } },
      // Applicant portal: apply, fill the form, follow the application.
      // Loaded only when someone opens /apply, so other visitors don't download it.
      { path: 'apply', loadComponent: () => import('./public/apply/apply-landing').then((m) => m.ApplyLanding) },
      // Published class timetables (by class, lecturer or room).
      { path: 'timetable', loadComponent: () => import('./public/timetable-page').then((m) => m.TimetablePage) },
      { path: 'apply/application', loadComponent: () => import('./public/apply/applicant-portal').then((m) => m.ApplicantPortal) },
      // Every other address is a CMS page looked up by its path.
      { path: '**', component: CmsPage, resolve: { result: cmsPageResolver }, runGuardsAndResolvers: 'always' },
    ],
  },
];
