import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import type { Request } from 'express';
import { AuditService } from '../audit/audit.service.js';
import { AccessService } from './access.service.js';
import type { AuthUser } from './auth-user.js';
import {
  CurrentUser,
  RequireAnyPermission,
  RequirePermissions,
} from './decorators.js';

class RolePermissionsDto {
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  permissions: string[];
}

class CreateRoleDto {
  @IsString()
  @Length(2, 100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string | null;

  /** Start with the same permissions as this role. */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  copyFrom?: string | null;
}

class UpdateRoleDto {
  @IsOptional()
  @IsString()
  @Length(2, 100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string | null;
}

/**
 * Admin → Access control. Anyone who manages users or access can see the matrix and the review;
 * only access managers can change roles. Every change goes in the audit log.
 */
@Controller('admin/access')
export class AccessController {
  constructor(
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  @Get('matrix')
  @RequireAnyPermission('access.manage', 'users.manage')
  matrix() {
    return this.access.matrix();
  }

  @Get('review')
  @RequireAnyPermission('access.manage', 'users.manage', 'audit.view')
  review() {
    return this.access.review();
  }

  @Put('roles/:key/permissions')
  @RequirePermissions('access.manage')
  async setPermissions(
    @Param('key') key: string,
    @Body() dto: RolePermissionsDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ) {
    const change = await this.access.setRolePermissions(key, dto.permissions);
    if (change.added.length || change.removed.length)
      await this.audit.record({
        action: 'role.permissions_set',
        userId: actor.id,
        entityType: 'role',
        entityId: key,
        details: change,
        ipAddress: req.ip,
      });
    return change;
  }

  @Post('roles')
  @RequirePermissions('access.manage')
  async create(
    @Body() dto: CreateRoleDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ) {
    const role = await this.access.createRole(dto);
    await this.audit.record({
      action: 'role.create',
      userId: actor.id,
      entityType: 'role',
      entityId: role.key,
      details: { name: role.name, copyFrom: dto.copyFrom ?? null },
      ipAddress: req.ip,
    });
    return role;
  }

  @Patch('roles/:key')
  @RequirePermissions('access.manage')
  async update(
    @Param('key') key: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ) {
    const role = await this.access.updateRole(key, dto);
    await this.audit.record({
      action: 'role.update',
      userId: actor.id,
      entityType: 'role',
      entityId: key,
      details: { ...dto },
      ipAddress: req.ip,
    });
    return role;
  }

  @Delete('roles/:key')
  @HttpCode(200)
  @RequirePermissions('access.manage')
  async remove(
    @Param('key') key: string,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ) {
    const role = await this.access.deleteRole(key);
    await this.audit.record({
      action: 'role.delete',
      userId: actor.id,
      entityType: 'role',
      entityId: key,
      details: role,
      ipAddress: req.ip,
    });
    return { ok: true };
  }
}
