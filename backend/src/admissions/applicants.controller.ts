import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsEnum } from 'class-validator';
import type { Request } from 'express';
import { In, type Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../identity/auth-user.js';
import { CurrentUser, RequirePermissions } from '../identity/decorators.js';
import { AccountType, UserStatus } from '../identity/entities/user.entity.js';
import { SessionsService } from '../identity/sessions.service.js';
import { UsersService } from '../identity/users.service.js';
import { Application } from './entities/application.entity.js';

class ApplicantStatusDto {
  @IsEnum([UserStatus.Active, UserStatus.Disabled])
  status: UserStatus.Active | UserStatus.Disabled;
}

/**
 * Admissions → Applicants: the accounts people create to apply. Kept apart from staff users,
 * and limited to what admissions needs: see who has registered, disable an account, reset a password.
 */
@Controller('admin/applicants')
@RequirePermissions('applicants.manage')
export class ApplicantsController {
  constructor(
    private readonly users: UsersService,
    private readonly sessions: SessionsService,
    private readonly audit: AuditService,
    @InjectRepository(Application)
    private readonly applications: Repository<Application>,
  ) {}

  @Get()
  async list(@Query('search') search = '', @Query('page') pageRaw = '1') {
    const page = Math.max(1, Number(pageRaw) || 1);
    const pageSize = 25;
    const [users, total] = await this.users.listPortalAccounts(
      AccountType.Applicant,
      search.slice(0, 100),
      page,
      pageSize,
    );
    const apps = users.length
      ? await this.applications.find({
          where: { applicant: { id: In(users.map((u) => u.id)) } },
          relations: { applicant: true, programme: true },
          order: { id: 'DESC' },
        })
      : [];
    return {
      total,
      page,
      pageSize,
      items: users.map((u) => {
        const app = apps.find((a) => a.applicant.id === u.id) ?? null;
        return {
          id: u.id,
          fullName: u.fullName,
          email: u.email,
          phone: u.phone,
          status: u.status,
          lockedUntil: u.lockedUntil,
          lastLoginAt: u.lastLoginAt,
          createdAt: u.createdAt,
          application: app && {
            id: app.id,
            applicationNumber: app.applicationNumber,
            status: app.status,
            programme: app.programme?.name ?? null,
          },
        };
      }),
    };
  }

  @Patch(':id/status')
  async setStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ApplicantStatusDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ) {
    await this.users.findOfType(id, AccountType.Applicant);
    await this.users.update(id, { status: dto.status });
    if (dto.status !== UserStatus.Active)
      await this.sessions.revokeAllForUser(id);
    await this.audit.record({
      action: 'applicant.status',
      userId: actor.id,
      entityType: 'user',
      entityId: id,
      details: { status: dto.status },
      ipAddress: req.ip,
    });
    return { ok: true };
  }

  @Post(':id/reset-password')
  @HttpCode(200)
  async resetPassword(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ) {
    await this.users.findOfType(id, AccountType.Applicant);
    const temporaryPassword = this.users.generatePassword();
    await this.users.setPassword(id, temporaryPassword);
    await this.sessions.revokeAllForUser(id);
    await this.audit.record({
      action: 'applicant.password_reset',
      userId: actor.id,
      entityType: 'user',
      entityId: id,
      ipAddress: req.ip,
    });
    return { temporaryPassword };
  }
}
