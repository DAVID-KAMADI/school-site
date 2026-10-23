import { RenderMode, type ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  // The admin portal is private and interactive: render it in the browser only.
  { path: 'admin/**', renderMode: RenderMode.Client },
  { path: 'admin', renderMode: RenderMode.Client },
  // The applicant's own application is private and personal.
  { path: 'apply/application', renderMode: RenderMode.Client },
  // Public pages are rendered on the server for every request, so search engines and
  // link previews (WhatsApp, Facebook) see the full content as soon as it is published.
  { path: '**', renderMode: RenderMode.Server },
];
