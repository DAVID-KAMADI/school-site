import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from './auth-user.js';
import { CurrentUser, RequirePermissions } from './decorators.js';
import { CreateUserDto, SetRolesDto, UpdateUserDto } from './dto.js';
import { AccountType } from './entities/user.entity.js';
import { SessionsService } from './sessions.service.js';
import { UsersService } from './users.service.js';

/** Staff accounts. Applicant accounts are managed under Admissions → Applicants. */
@Controller('admin/users')
@RequirePermissions('users.manage')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly sessions: SessionsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list() {
    const users = await this.users.list();
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      phone: u.phone,
      status: u.status,
      twoFactorEnabled: u.twoFactorEnabledAt !== null,
      lockedUntil: u.lockedUntil,
      lastLoginAt: u.lastLoginAt,
      roles: u.roles.map((r) => ({
        roleKey: r.role.key,
        roleName: r.role.name,
        scopePageId: r.scopePage?.id ?? null,
      })),
    }));
  }

  @Get('roles')
  async roles() {
    const roles = await this.users.listRoles();
    return roles.map((r) => ({
      key: r.key,
      name: r.name,
      description: r.description,
      permissions: r.permissions.map((p) => p.key),
    }));
  }

  /** Creates a user. When no password is given, a temporary one is generated and shown once. */
  @Post()
  async create(
    @Body() dto: CreateUserDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ) {
    const temporaryPassword = dto.password
      ? undefined
      : this.users.generatePassword();
    const user = await this.users.create({
      ...dto,
      password: dto.password ?? temporaryPassword!,
    });
    await this.audit.record({
      action: 'user.create',
      userId: actor.id,
      entityType: 'user',
      entityId: user.id,
      ipAddress: req.ip,
    });
    return { id: user.id, email: user.email, temporaryPassword };
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ) {
    await this.users.findOfType(id, AccountType.Staff);
    const user = await this.users.update(id, dto);
    if (dto.status && dto.status !== 'active')
      await this.sessions.revokeAllForUser(id);
    await this.audit.record({
      action: 'user.update',
      userId: actor.id,
      entityType: 'user',
      entityId: id,
      details: { ...dto },
      ipAddress: req.ip,
    });
    return { id: user.id, status: user.status };
  }

  @Put(':id/roles')
  async setRoles(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetRolesDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ) {
    await this.users.findOfType(id, AccountType.Staff);
    await this.users.setRoles(id, dto.roles);
    await this.sessions.revokeAllForUser(id);
    await this.audit.record({
      action: 'user.roles_set',
      userId: actor.id,
      entityType: 'user',
      entityId: id,
      details: { roles: dto.roles },
      ipAddress: req.ip,
    });
    return { ok: true };
  }

  /** For a lost phone: clears the user's authenticator so they set it up again at next sign-in. */
  @Post(':id/reset-2fa')
  @HttpCode(200)
  async resetTwoFactor(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ) {
    await this.users.findOfType(id, AccountType.Staff);
    await this.users.resetTwoFactor(id);
    await this.sessions.revokeAllForUser(id);
    await this.audit.record({
      action: 'user.2fa_reset',
      userId: actor.id,
      entityType: 'user',
      entityId: id,
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
    await this.users.findOfType(id, AccountType.Staff);
    const temporaryPassword = this.users.generatePassword();
    await this.users.setPassword(id, temporaryPassword);
    await this.sessions.revokeAllForUser(id);
    await this.audit.record({
      action: 'user.password_reset',
      userId: actor.id,
      entityType: 'user',
      entityId: id,
      ipAddress: req.ip,
    });
    return { temporaryPassword };
  }
}
