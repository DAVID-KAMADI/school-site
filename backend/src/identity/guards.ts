import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { authConfig, SESSION_COOKIE } from '../config/auth.config.js';
import { canAnywhere, isStaff } from './auth-user.js';
import {
  ALLOW_PENDING_2FA,
  ANY_PERMISSION,
  IS_PUBLIC,
  OPTIONAL_SESSION,
  REQUIRED_PERMISSIONS,
  type AuthedRequest,
} from './decorators.js';
import { SessionsService } from './sessions.service.js';
import { UsersService } from './users.service.js';

/**
 * Global guard: every route needs a valid session unless marked @Public().
 * Also enforces the 2FA step and, for staff, 2FA enrolment.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  private readonly config = authConfig();

  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionsService,
    private readonly users: UsersService,
  ) {}

  /** The user behind the session cookie, or null when there is no valid session. */
  private async resolve(req: AuthedRequest) {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    const result =
      typeof token === 'string' && token
        ? await this.sessions.validate(token)
        : null;
    if (result && 'replaced' in result) {
      req.sessionReplaced = true;
      return null;
    }
    const found = result;
    const user = found ? await this.users.loadAuthUser(found.userId) : null;
    return found && user
      ? {
          user,
          sessionId: found.session.id,
          twoFactorVerified: found.session.twoFactorVerified,
        }
      : null;
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) {
      if (
        this.reflector.getAllAndOverride<boolean>(OPTIONAL_SESSION, targets)
      ) {
        const signedIn = await this.resolve(req);
        if (signedIn) req.auth = signedIn;
      }
      return true;
    }

    const resolved = await this.resolve(req);
    const found = resolved
      ? {
          session: {
            id: resolved.sessionId,
            twoFactorVerified: resolved.twoFactorVerified,
          },
        }
      : null;
    const user = resolved?.user ?? null;
    if ((!found || !user) && req.sessionReplaced)
      throw new UnauthorizedException({
        message:
          'You were signed out because your account was used to sign in on another device. Sign in again to continue.',
        code: 'SESSION_REPLACED',
      });
    if (!found || !user)
      throw new UnauthorizedException({
        message: 'Please sign in.',
        code: 'NOT_SIGNED_IN',
      });

    req.auth = {
      user,
      sessionId: found.session.id,
      twoFactorVerified: found.session.twoFactorVerified,
    };
    if (this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_2FA, targets))
      return true;

    if (user.twoFactorEnabled && !found.session.twoFactorVerified) {
      throw new UnauthorizedException({
        message: 'Enter the code from your authenticator app.',
        code: 'TWO_FACTOR_REQUIRED',
      });
    }
    if (
      this.config.requireStaffTwoFactor &&
      isStaff(user) &&
      !user.twoFactorEnabled
    ) {
      throw new ForbiddenException({
        message: 'Set up two-step login to continue.',
        code: 'TWO_FACTOR_SETUP_REQUIRED',
      });
    }
    return true;
  }
}

/** Checks @RequirePermissions(...) and @RequireAnyPermission(...). Runs after SessionGuard. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const targets = [ctx.getHandler(), ctx.getClass()];
    // Public routes skip sign-in, so class-level permissions do not apply to them.
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets))
      return true;
    const required = this.reflector.getAllAndOverride<string[] | undefined>(
      REQUIRED_PERMISSIONS,
      targets,
    );
    const anyOf = this.reflector.getAllAndOverride<string[] | undefined>(
      ANY_PERMISSION,
      targets,
    );
    if (!required?.length && !anyOf?.length) return true;
    const user = ctx.switchToHttp().getRequest<AuthedRequest>().auth?.user;
    if (
      !user ||
      !(required ?? []).every((p) => canAnywhere(user, p)) ||
      (anyOf?.length && !anyOf.some((p) => canAnywhere(user, p)))
    ) {
      throw new ForbiddenException({
        message: 'You do not have permission to do this.',
        code: 'FORBIDDEN',
      });
    }
    return true;
  }
}
