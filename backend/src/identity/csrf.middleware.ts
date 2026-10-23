import {
  ForbiddenException,
  Injectable,
  type NestMiddleware,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { authConfig, XSRF_COOKIE, XSRF_HEADER } from '../config/auth.config.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Double-submit CSRF protection, matching Angular's built-in HttpClient XSRF support:
 * the API sets a readable XSRF-TOKEN cookie; Angular echoes it in the X-XSRF-TOKEN header
 * on every state-changing request; other sites cannot read the cookie, so cannot forge the header.
 */
@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  private readonly secure = authConfig().secureCookies;

  use(req: Request, res: Response, next: NextFunction): void {
    let cookie: unknown = req.cookies?.[XSRF_COOKIE];
    if (typeof cookie !== 'string' || cookie.length < 32) {
      cookie = randomBytes(32).toString('base64url');
      res.cookie(XSRF_COOKIE, cookie, {
        sameSite: 'lax',
        secure: this.secure,
        httpOnly: false,
        path: '/',
      });
      // A brand-new cookie cannot have been echoed yet, so unsafe requests without one are rejected below.
      if (!SAFE_METHODS.has(req.method))
        throw new ForbiddenException({
          message: 'Security token missing. Reload the page and try again.',
          code: 'CSRF',
        });
    }

    if (!SAFE_METHODS.has(req.method)) {
      const header = req.header(XSRF_HEADER) ?? '';
      const a = Buffer.from(header);
      const b = Buffer.from(cookie as string);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        throw new ForbiddenException({
          message: 'Security token mismatch. Reload the page and try again.',
          code: 'CSRF',
        });
      }
    }
    next();
  }
}
