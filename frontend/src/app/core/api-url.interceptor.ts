import { isPlatformServer } from '@angular/common';
import type { HttpInterceptorFn } from '@angular/common/http';
import { inject, PLATFORM_ID } from '@angular/core';

/**
 * In the browser, /api and /media are same-origin (proxied in development, routed by the web server in production).
 * During server-side rendering there is no browser origin, so calls go straight to the Node.js API.
 */
export const apiUrlInterceptor: HttpInterceptorFn = (req, next) => {
  if (isPlatformServer(inject(PLATFORM_ID)) && (req.url.startsWith('/api/') || req.url.startsWith('/media/'))) {
    const origin = (typeof process !== 'undefined' && process.env['API_ORIGIN']) || 'http://localhost:3000';
    return next(req.clone({ url: origin + req.url }));
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
