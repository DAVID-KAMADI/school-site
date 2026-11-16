import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  type NestMiddleware,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Equals, IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import type { NextFunction, Request, Response } from 'express';
import type { AuthUser } from '../identity/auth-user.js';
import { AuthService } from '../identity/auth.service.js';
import { type AuthedRequest, CurrentUser, RequirePermissions } from '../identity/decorators.js';
import { SUPER_ADMIN_ROLE } from '../identity/users.service.js';
import { BackupService } from './backup.service.js';

class CreateBackupDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

class ConfirmDto {
  @IsString()
  @MaxLength(200)
  password: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  code?: string;
}

class RestoreDto extends ConfirmDto {
  /** Typed by the person, so a restore never starts by accident. */
  @Equals('RESTORE', { message: 'Type RESTORE to confirm.' })
  confirm: string;

  @IsBoolean()
  includeFiles: boolean;
}

const label = (u: AuthUser) => `${u.fullName} (${u.email})`;

function superAdminOnly(user: AuthUser) {
  if (!user.roles.includes(SUPER_ADMIN_ROLE))
    throw new ForbiddenException('Only super administrators can manage backups.');
}

/** Backups & restore: super administrators only, on top of the admin portal permission. */
@Controller('admin/backups')
@RequirePermissions('admin.access')
export class BackupController {
  constructor(
    private readonly backups: BackupService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    superAdminOnly(user);
    return this.backups.list();
  }

  @Get('status')
  status(@CurrentUser() user: AuthUser) {
    superAdminOnly(user);
    return this.backups.status();
  }

  @Post()
  @HttpCode(202)
  create(@Body() dto: CreateBackupDto, @CurrentUser() user: AuthUser) {
    superAdminOnly(user);
    return this.backups.startBackup({ id: user.id, label: label(user) }, dto.note ?? null);
  }

  @Post(':name/restore')
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async restore(
    @Param('name') name: string,
    @Body() dto: RestoreDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    superAdminOnly(user);
    const meta = { ip: req.ip ?? null, userAgent: req.header('user-agent') ?? null };
    await this.auth.confirmIdentity(user.id, dto.password, dto.code, meta);
    return this.backups.startRestore(name, { id: user.id, label: label(user) }, {
      includeFiles: dto.includeFiles,
      ip: meta.ip,
    });
  }

  /** Emergency (e.g. a suspected breach): signs out every other session at once. */
  @Post('sign-out-everyone')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async signOutEveryone(@Body() dto: ConfirmDto, @CurrentUser() user: AuthUser, @Req() req: AuthedRequest) {
    superAdminOnly(user);
    const meta = { ip: req.ip ?? null, userAgent: req.header('user-agent') ?? null };
    await this.auth.confirmIdentity(user.id, dto.password, dto.code, meta);
    return this.backups.signOutEveryone(user.id, req.auth!.sessionId, meta.ip);
  }
}

/** While a restore replaces the database, every API request except these two is turned away. */
@Injectable()
export class MaintenanceMiddleware implements NestMiddleware {
  constructor(private readonly backups: BackupService) {}

  use(req: Request, res: Response, next: NextFunction) {
    if (!this.backups.restoring || /^\/api\/v1\/(maintenance|health)(\/|\?|$)/.test(req.originalUrl)) return next();
    res
      .status(503)
      .setHeader('Retry-After', '60')
      .json({ statusCode: 503, code: 'MAINTENANCE', message: 'The site is being restored from a backup. Please try again in a few minutes.' });
  }
}
