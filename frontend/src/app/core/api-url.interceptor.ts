import { isPlatformServer } from '@angular/common';
import type { HttpInterceptorFn } from '@angular/common/http';
import { inject, PLATFORM_ID, REQUEST_CONTEXT } from '@angular/core';

/** The visitor's address and the shared secret proving it comes from the website server (see server.ts). */
export const VISITOR_IP_HEADER = 'x-visitor-ip';
export const WEBSITE_KEY_HEADER = 'x-website-server-key';

/**
 * In the browser, /api and /media are same-origin (proxied in development, routed by the web server in production).
 * During server-side rendering there is no browser origin, so calls go straight to the Node.js API,
 * carrying the visitor's address from the website server.
 */
export const apiUrlInterceptor: HttpInterceptorFn = (req, next) => {
  if (isPlatformServer(inject(PLATFORM_ID)) && (req.url.startsWith('/api/') || req.url.startsWith('/media/'))) {
    const origin = (typeof process !== 'undefined' && process.env['API_ORIGIN']) || 'http://localhost:3000';
    // Tells the API which visitor this page is for, so its rate limits count per visitor, not per website server.
    const context = inject(REQUEST_CONTEXT, { optional: true }) as { apiHeaders?: Record<string, string> } | null;
    return next(req.clone({ url: origin + req.url, setHeaders: context?.apiHeaders ?? {} }));
  }
  return next(req);
};

/** Turns an API error response into a readable sentence. */
export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const body = (err as { error?: { message?: string | string[] } })?.error;
  const message = body?.message;
  if (Array.isArray(message)) return message.join(' ');
  return message || fallback;
}
