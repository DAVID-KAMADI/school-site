import {
  createParamDecorator,
  SetMetadata,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser, RequestAuth } from './auth-user.js';

export const IS_PUBLIC = 'isPublic';
export const ALLOW_PENDING_2FA = 'allowPending2fa';
export const OPTIONAL_SESSION = 'optionalSession';
export const REQUIRED_PERMISSIONS = 'requiredPermissions';
export const ANY_PERMISSION = 'anyPermission';

/** Route is open to visitors without signing in. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** On a @Public() route: attach the signed-in user when there is a valid session, without requiring one. */
export const OptionalSession = () => SetMetadata(OPTIONAL_SESSION, true);

/** Route is reachable after the password step but before the 2FA step (or before 2FA setup). */
export const AllowPendingTwoFactor = () => SetMetadata(ALLOW_PENDING_2FA, true);

/**
 * User must hold every listed permission somewhere (globally or on a section).
 * Section-limited permissions are then checked against the specific page in the service.
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);

/** Website content: pages and blog posts. */
export const CONTENT_PERMISSIONS = [
  'pages.create',
  'pages.edit',
  'pages.publish',
  'pages.delete',
];

/** Admissions setup, by area: each has create, edit and delete. */
export const SETUP_PERMISSIONS = {
  programmes: ['programmes.create', 'programmes.edit', 'programmes.delete'],
  shortCourses: [
    'short_courses.create',
    'short_courses.edit',
    'short_courses.delete',
  ],
  intakes: ['intakes.create', 'intakes.edit', 'intakes.delete'],
  documentTypes: [
    'document_types.create',
    'document_types.edit',
    'document_types.delete',
  ],
};

/** Any part of admissions setup. */
export const ADMISSIONS_SETUP_PERMISSIONS =
  Object.values(SETUP_PERMISSIONS).flat();

/** User must hold at least one of the listed permissions somewhere. Checked in addition to @RequirePermissions. */
export const RequireAnyPermission = (...permissions: string[]) =>
  SetMetadata(ANY_PERMISSION, permissions);

export type AuthedRequest = Request & {
  auth?: RequestAuth;
  /** Set when the session cookie belonged to a staff session replaced by a newer sign-in. */
  sessionReplaced?: boolean;
};

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (!req.auth)
      throw new Error('CurrentUser used on a route without authentication');
    return req.auth.user;
  },
);

export const CurrentAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestAuth => {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (!req.auth)
      throw new Error('CurrentAuth used on a route without authentication');
    return req.auth;
  },
);

export function clientIp(req: Request): string | null {
  return req.ip ?? null;
}
