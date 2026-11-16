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

/** Shown whenever the app cannot reach the API server at all (not started, crashed, restarting). */
export const API_UNREACHABLE_MESSAGE =
  'Cannot connect to the server. The system may be starting up, restarting or offline. Wait a moment and try again; if this keeps happening, contact the system administrator.';

/**
 * True when a request failed because the API server could not be reached, rather than because the API
 * answered with an error. Covers:
 *  - status 0: the browser (or server-side rendering) could not connect at all;
 *  - the website server's own "API unreachable" reply (see proxyToApi in server.ts);
 *  - 500/502/503/504 with no JSON body: a proxy in front of the API (the dev server, nginx…) answering
 *    because the API itself did not. The API always answers errors with a JSON body.
 */
export function isApiUnreachable(err: unknown): boolean {
  const e = err as { status?: number; error?: unknown } | null;
  if (!e || typeof e.status !== 'number') return false;
  if (e.status === 0) return true;
  const body = e.error;
  if (body && typeof body === 'object' && (body as { code?: string }).code === 'API_UNREACHABLE') return true;
  return [500, 502, 503, 504].includes(e.status) && (body === null || body === undefined || typeof body === 'string');
}

/** Turns an API error response into a readable sentence. */
export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (isApiUnreachable(err)) return API_UNREACHABLE_MESSAGE;
  const body = (err as { error?: { message?: string | string[] } })?.error;
  const message = body?.message;
  if (Array.isArray(message)) return message.join(' ');
  return message || fallback;
}
