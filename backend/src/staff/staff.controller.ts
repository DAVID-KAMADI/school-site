import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../identity/auth-user.js';
import {
  CONTENT_PERMISSIONS,
  CurrentUser,
  Public,
  RequireAnyPermission,
  RequirePermissions,
} from '../identity/decorators.js';
import { StaffService } from './staff.service.js';

/** Admin → Staff hierarchy. Same permissions as pages and blog posts. */
@Controller('admin/staff')
@RequirePermissions('admin.access')
@RequireAnyPermission(...CONTENT_PERMISSIONS)
export class AdminStaffController {
  constructor(
    private readonly staff: StaffService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list() {
    return this.staff.listAdmin();
  }

  // Declared before levels/:id and members/:id so "order" is not read as an id.
  @Put('levels/order')
  @RequirePermissions('pages.edit')
  orderLevels(@Body() body: unknown) {
    return this.staff.reorder('levels', body);
  }

  @Put('members/order')
  @RequirePermissions('pages.edit')
  orderMembers(@Body() body: unknown) {
    return this.staff.reorder('members', body);
  }

  @Post('levels')
  @RequirePermissions('pages.edit')
  async createLevel(
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const saved = await this.staff.saveLevel(null, body);
    await this.log(
      'staff_level.create',
      'staff_level',
      saved.id,
      { name: saved.name },
      user,
      req,
    );
    return saved;
  }

  @Put('levels/:id')
  @RequirePermissions('pages.edit')
  async updateLevel(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const saved = await this.staff.saveLevel(id, body);
    await this.log(
      'staff_level.update',
      'staff_level',
      id,
      { name: saved.name },
      user,
      req,
    );
    return saved;
  }

  @Delete('levels/:id')
  @RequirePermissions('pages.delete')
  async removeLevel(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const gone = await this.staff.removeLevel(id);
    await this.log('staff_level.delete', 'staff_level', id, gone, user, req);
    return { ok: true };
  }

  @Post('members')
  @RequirePermissions('pages.edit')
  async createMember(
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const saved = await this.staff.saveMember(null, body);
    await this.log(
      'staff_member.create',
      'staff_member',
      saved.id,
      { name: saved.name },
      user,
      req,
    );
    return saved;
  }

  @Put('members/:id')
  @RequirePermissions('pages.edit')
  async updateMember(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const saved = await this.staff.saveMember(id, body);
    await this.log(
      'staff_member.update',
      'staff_member',
      id,
      { name: saved.name, isPublished: saved.isPublished },
      user,
      req,
    );
    return saved;
  }

  @Delete('members/:id')
  @RequirePermissions('pages.delete')
  async removeMember(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const gone = await this.staff.removeMember(id);
    await this.log('staff_member.delete', 'staff_member', id, gone, user, req);
    return { ok: true };
  }

  /** The heading and introduction at the top of the Our people page. */
  @Put('page')
  @RequirePermissions('pages.edit')
  async savePage(
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const saved = await this.staff.savePage(body, user.id);
    await this.log(
      'staff_page.update',
      'site_setting',
      'staff.page',
      { title: saved.title },
      user,
      req,
    );
    return saved;
  }

  private log(
    action: string,
    entityType: string,
    entityId: number | string,
    details: Record<string, unknown>,
    user: AuthUser,
    req: Request,
  ) {
    return this.audit.record({
      action,
      userId: user.id,
      entityType,
      entityId,
      details,
      ipAddress: req.ip,
    });
  }
}

/** The website's Our people page. */
@Public()
@Controller('public/staff')
export class PublicStaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  hierarchy() {
    return this.staff.publicHierarchy();
  }
}
