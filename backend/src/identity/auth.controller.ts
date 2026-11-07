import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  authConfig,
  SESSION_COOKIE,
} from '../config/auth.config.js';
import { portalCookies } from './portal-access.controller.js';
import { AuthService, type RequestMeta } from './auth.service.js';
import { isStaff, type RequestAuth } from './auth-user.js';
import {
  AllowPendingTwoFactor,
  CurrentAuth,
  OptionalSession,
  Public,
  type AuthedRequest,
} from './decorators.js';
import { ChangePasswordDto, CodeDto, LoginDto } from './dto.js';
import { SessionsService } from './sessions.service.js';

const meta = (req: Request): RequestMeta => ({
  ip: req.ip ?? null,
  userAgent: req.header('user-agent') ?? null,
});

/** Stricter limit for endpoints that guess passwords or codes (per IP). */
const AUTH_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  private readonly config = authConfig();

  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
  ) {}

  /** Lets the front end obtain the XSRF cookie before its first POST. */
  @Public()
  @Get('csrf')
  csrf() {
    return { ok: true };
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(
      dto.email,
      dto.password,
      meta(req),
      portalCookies(req),
    );
    res.cookie(SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.secureCookies,
      path: '/',
      maxAge: this.config.maxSessionHours * 3_600_000,
    });
    return { user: result.user, twoFactorRequired: result.twoFactorRequired };
  }

  /** Who is signed in. Visitors get { user: null } rather than an error. */
  @Public()
  @OptionalSession()
  @Get('me')
  me(@Req() req: AuthedRequest) {
    const auth = req.auth;
    if (!auth)
      return {
        user: null,
        twoFactorPending: false,
        twoFactorSetupRequired: false,
        // Lets the sign-in page explain why a staff member was signed out.
        signedOutReason: req.sessionReplaced ? 'replaced' : null,
      };
    return {
      user: auth.user,
      twoFactorPending: auth.user.twoFactorEnabled && !auth.twoFactorVerified,
      twoFactorSetupRequired:
        this.config.requireStaffTwoFactor &&
        !auth.user.twoFactorEnabled &&
        isStaff(auth.user),
    };
  }

  @AllowPendingTwoFactor()
  @Throttle(AUTH_THROTTLE)
  @Post('2fa/verify')
  @HttpCode(200)
  async verify(
    @CurrentAuth() auth: RequestAuth,
    @Body() dto: CodeDto,
    @Req() req: Request,
  ) {
    await this.auth.verifyTwoFactor(auth, dto.code, meta(req));
    return { ok: true };
  }

  @AllowPendingTwoFactor()
  @Post('2fa/setup')
  @HttpCode(200)
  setup(@CurrentAuth() auth: RequestAuth) {
    return this.auth.beginTwoFactorSetup(auth.user);
  }

  @AllowPendingTwoFactor()
  @Throttle(AUTH_THROTTLE)
  @Post('2fa/enable')
  @HttpCode(200)
  async enable(
    @CurrentAuth() auth: RequestAuth,
    @Body() dto: CodeDto,
    @Req() req: Request,
  ) {
    await this.auth.enableTwoFactor(auth, dto.code, meta(req));
    return { ok: true };
  }

  @Throttle(AUTH_THROTTLE)
  @Post('change-password')
  @HttpCode(200)
  async changePassword(
    @CurrentAuth() auth: RequestAuth,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
  ) {
    await this.auth.changePassword(
      auth,
      dto.currentPassword,
      dto.newPassword,
      meta(req),
    );
    return { ok: true };
  }

  @AllowPendingTwoFactor()
  @Post('logout')
  @HttpCode(200)
  async logout(
    @CurrentAuth() auth: RequestAuth,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.sessions.revoke(auth.sessionId);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }

  /** "Log out of all devices" — useful after using a shared or cyber-café computer. */
  @Post('logout-all')
  @HttpCode(200)
  async logoutAll(
    @CurrentAuth() auth: RequestAuth,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.sessions.revokeAllForUser(auth.user.id);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }
}
