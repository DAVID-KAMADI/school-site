import { inject } from '@angular/core';
import { Router, type ActivatedRouteSnapshot, type RouterStateSnapshot, type Routes, type UrlMatchResult, type UrlSegment } from '@angular/router';
import { SiteStore } from './core/site';
import { CmsPage, cmsPageResolver } from './public/cms-page';
import { PreviewPage, previewResolver } from './public/preview-page';
import { PublicLayout } from './public/public-layout';
import { BlogList } from './public/blog/blog-list';
import { BlogPostPage } from './public/blog/blog-post';
import { blogListResolver, blogPostResolver } from './public/blog/blog-resolvers';
import { albumResolver, downloadsResolver, galleryResolver, staffResolver } from './public/showcase-resolvers';

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
      // Photo albums and the staff hierarchy, edited in Admin → Gallery and Admin → Staff hierarchy.
      { path: 'gallery', loadComponent: () => import('./public/gallery/gallery-page').then((m) => m.GalleryPage), resolve: { result: galleryResolver } },
      { path: 'gallery/:slug', loadComponent: () => import('./public/gallery/album-page').then((m) => m.AlbumPage), resolve: { result: albumResolver } },
      { path: 'staff', loadComponent: () => import('./public/staff/staff-page').then((m) => m.StaffPage), resolve: { result: staffResolver } },
      // Tenders, job vacancies, forms and other documents (Admin → Downloads). /downloads and /downloads/<category>
      // share one route, so moving between categories keeps the page and only changes the list.
      { matcher: downloadsMatcher, loadComponent: () => import('./public/downloads/downloads-page').then((m) => m.DownloadsPage), resolve: { result: downloadsResolver } },
      // Applicant portal: apply, fill the form, follow the application.
      // Loaded only when someone opens /apply, so other visitors don't download it.
      { path: 'apply', loadComponent: () => import('./public/apply/apply-landing').then((m) => m.ApplyLanding) },
      // Published class timetables (by class, lecturer or room).
      { path: 'timetable', loadComponent: () => import('./public/timetable-page').then((m) => m.TimetablePage) },
      { path: 'apply/reset-password', loadComponent: () => import('./public/apply/reset-password').then((m) => m.ResetPasswordPage) },
      { path: 'apply/application', loadComponent: () => import('./public/apply/applicant-portal').then((m) => m.ApplicantPortal) },
      // Every other address is a CMS page looked up by its path.
      { path: '**', component: CmsPage, resolve: { result: cmsPageResolver }, runGuardsAndResolvers: 'always' },
    ],
  },
];

/** Matches /downloads and /downloads/<category>. */
export function downloadsMatcher(segments: UrlSegment[]): UrlMatchResult | null {
  if (!segments.length || segments[0].path !== 'downloads' || segments.length > 2) return null;
  return { consumed: segments, posParams: segments[1] ? { category: segments[1] } : {} };
}
