import { Body, Controller, Get, Put, Req } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsBoolean, IsDate, IsOptional, IsString, MaxLength } from 'class-validator';
import type { AuthUser } from '../identity/auth-user.js';
import { type AuthedRequest, CurrentUser, OptionalSession, Public, RequirePermissions } from '../identity/decorators.js';
import { MaintenanceService } from './maintenance.service.js';

class MaintenanceDto {
  @IsBoolean()
  enabled: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  message?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  endsAt?: Date | null;

  @IsOptional()
  @IsBoolean()
  autoEnd?: boolean;
}

/**
 * Whether visitors should see the maintenance page (maintenance mode, or a backup restore in progress).
 * Open to everyone: the maintenance page and the website server read it. Signed-in staff get bypass: true.
 */
@Public()
@OptionalSession()
@Controller('maintenance')
export class MaintenanceStatusController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Get()
  status(@Req() req: AuthedRequest) {
    return this.maintenance.publicStatus(req.auth);
  }
}

/** Admin → Site → Maintenance mode. */
@Controller('admin/maintenance')
@RequirePermissions('settings.edit')
export class MaintenanceAdminController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Get()
  get() {
    return this.maintenance.adminView();
  }

  @Put()
  save(@Body() dto: MaintenanceDto, @CurrentUser() user: AuthUser, @Req() req: AuthedRequest) {
    return this.maintenance.save(
      { ...dto, endsAt: dto.endsAt ? dto.endsAt.toISOString() : null },
      user,
      req.ip ?? null,
    );
  }
}
