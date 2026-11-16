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
import { AuditService } from '../../audit/audit.service.js';
import type { AuthUser } from '../../identity/auth-user.js';
import {
  CurrentUser,
  Public,
  RequirePermissions,
} from '../../identity/decorators.js';
import { PopupsService } from './popups.service.js';

/** Admin → Pop-ups. Same permission as the site banners (Site settings). */
@Controller('admin/popups')
export class PopupsAdminController {
  constructor(
    private readonly popups: PopupsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions('settings.edit')
  list() {
    return this.popups.list();
  }

  @Post()
  @RequirePermissions('settings.edit')
  async create(
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const saved = await this.popups.save(null, body);
    await this.audit.record({
      action: 'popup.create',
      userId: user.id,
      entityType: 'popup',
      entityId: saved.id,
      details: { title: saved.title },
      ipAddress: req.ip,
    });
    return saved;
  }

  @Put(':id')
  @RequirePermissions('settings.edit')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const saved = await this.popups.save(id, body);
    await this.audit.record({
      action: 'popup.update',
      userId: user.id,
      entityType: 'popup',
      entityId: id,
      details: { title: saved.title, isActive: saved.isActive },
      ipAddress: req.ip,
    });
    return saved;
  }

  @Delete(':id')
  @RequirePermissions('settings.edit')
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const gone = await this.popups.remove(id);
    await this.audit.record({
      action: 'popup.delete',
      userId: user.id,
      entityType: 'popup',
      entityId: id,
      details: gone,
      ipAddress: req.ip,
    });
    return { ok: true };
  }
}

/** Pop-ups the website shows right now. */
@Public()
@Controller('public/popups')
export class PublicPopupsController {
  constructor(private readonly popups: PopupsService) {}

  @Get()
  active() {
    return this.popups.active();
  }
}
