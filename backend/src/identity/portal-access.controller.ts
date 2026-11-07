import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { IsDate, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import type { Request, Response } from 'express';
import {
  authConfig,
  PORTAL_COOKIE_PATH,
  PORTAL_PASS_COOKIE,
} from '../config/auth.config.js';
import type { AuthUser } from './auth-user.js';
import type { RequestMeta } from './auth.service.js';
import { type AuthedRequest, CurrentUser, OptionalSession, Public, RequirePermissions } from './decorators.js';
import { PASS_MINUTES, PortalAccessService, type PortalCookies } from './portal-access.service.js';

export const PORTAL_KEYS_PERMISSION = 'portal_keys.manage';
const MAX_KEY_DAYS = 365;

const meta = (req: Request): RequestMeta => ({
  ip: req.ip ?? null,
  userAgent: req.header('user-agent') ?? null,
});

export const portalCookies = (req: Request): PortalCookies => ({
  pass: req.cookies?.[PORTAL_PASS_COOKIE],
});

class VerifyKeyDto {
  @IsString()
  @MaxLength(64)
  key: string;
}

class CreateKeyDto {
  @IsString()
  @Length(1, 120)
  name: string;

  @Type(() => Date)
  @IsDate()
  expiresAt: Date;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  maxUses: number;

  /** Makes the link personal: only this staff member can sign in with it. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userId?: number;
}

/** Checks the token from a staff sign-in link (/admin/<token>). Open to visitors, but rate limited and logged. */
@Controller('auth/portal-access')
export class PortalAccessController {
  private readonly config = authConfig();

  constructor(private readonly portal: PortalAccessService) {}

  @Public()
  @OptionalSession()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  @HttpCode(200)
  async verify(
    @Body() dto: VerifyKeyDto,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, expiresAt } = await this.portal.verify(dto.key, meta(req), req.auth?.user.id ?? null);
    res.cookie(PORTAL_PASS_COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: this.config.secureCookies,
      path: PORTAL_COOKIE_PATH,
      maxAge: PASS_MINUTES * 60_000,
    });
    return { granted: true, expiresAt };
  }

  /** Whether this browser opened a valid sign-in link in the last few minutes. */
  @Public()
  @Get()
  status(@Req() req: Request) {
    return this.portal.status(portalCookies(req));
  }
}

/** Staff Portal Access Management: only for people holding portal_keys.manage (super administrators hold it). */
@Controller('admin/portal-access-keys')
@RequirePermissions(PORTAL_KEYS_PERMISSION)
export class PortalKeysController {
  constructor(private readonly portal: PortalAccessService) {}

  @Get()
  list() {
    return this.portal.list();
  }

  /** The response holds the key itself. It is never stored or shown again. */
  @Post()
  create(@Body() dto: CreateKeyDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    const now = Date.now();
    const expires = dto.expiresAt.getTime();
    if (expires <= now + 60_000 || expires > now + MAX_KEY_DAYS * 86_400_000)
      throw new BadRequestException(
        `Choose an expiry date in the future and no more than ${MAX_KEY_DAYS} days away.`,
      );
    return this.portal.create(dto, user.id, meta(req));
  }

  @Get('activity')
  allActivity() {
    return this.portal.activity();
  }

  @Get(':id/activity')
  activity(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.portal.activity(id);
  }

  @Post(':id/revoke')
  @HttpCode(200)
  revoke(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.portal.revoke(id, user.id, meta(req));
  }
}
