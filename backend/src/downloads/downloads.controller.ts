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
import { DownloadsService } from './downloads.service.js';

/** Admin → Downloads. Same permissions as pages and blog posts. */
@Controller('admin/downloads')
@RequirePermissions('admin.access')
@RequireAnyPermission(...CONTENT_PERMISSIONS)
export class AdminDownloadsController {
  constructor(
    private readonly downloads: DownloadsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list() {
    return this.downloads.listAdmin();
  }

  // Declared before categories/:id so "order" is not read as an id.
  @Put('categories/order')
  @RequirePermissions('pages.edit')
  orderCategories(@Body() body: unknown) {
    return this.downloads.orderCategories(body);
  }

  @Post('categories')
  @RequirePermissions('pages.edit')
  async createCategory(
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const saved = await this.downloads.saveCategory(null, body);
    await this.log('download_category.create', 'download_category', saved.id, { name: saved.name }, user, req);
    return saved;
  }

  @Put('categories/:id')
  @RequirePermissions('pages.edit')
  async updateCategory(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const saved = await this.downloads.saveCategory(id, body);
    await this.log('download_category.update', 'download_category', id, { name: saved.name }, user, req);
    return saved;
  }

  @Delete('categories/:id')
  @RequirePermissions('pages.delete')
  async removeCategory(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const gone = await this.downloads.removeCategory(id);
    await this.log('download_category.delete', 'download_category', id, gone, user, req);
    return { ok: true };
  }

  // Declared before :id so "page" is not read as an id.
  /** The heading and introduction at the top of the Downloads page. */
  @Put('page')
  @RequirePermissions('pages.edit')
  async savePage(
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const saved = await this.downloads.savePage(body, user.id);
    await this.log('downloads_page.update', 'site_setting', 'downloads.page', { title: saved.title }, user, req);
    return saved;
  }

  @Post()
  @RequirePermissions('pages.create')
  async create(
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const saved = await this.downloads.save(null, body);
    await this.log('download.create', 'download', saved.id, { title: saved.title }, user, req);
    return saved;
  }

  @Put(':id')
  @RequirePermissions('pages.edit')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const saved = await this.downloads.save(id, body);
    await this.log(
      'download.update',
      'download',
      id,
      { title: saved.title, isPublished: saved.isPublished },
      user,
      req,
    );
    return saved;
  }

  @Delete(':id')
  @RequirePermissions('pages.delete')
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const gone = await this.downloads.remove(id);
    await this.log('download.delete', 'download', id, gone, user, req);
    return { ok: true };
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

/** The website's Downloads page. */
@Public()
@Controller('public/downloads')
export class PublicDownloadsController {
  constructor(private readonly downloads: DownloadsService) {}

  @Get()
  index() {
    return this.downloads.publicIndex();
  }
}
