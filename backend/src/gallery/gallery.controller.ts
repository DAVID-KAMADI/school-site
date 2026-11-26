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
import { GalleryService } from './gallery.service.js';

/** Admin → Gallery. Same permissions as pages and blog posts. */
@Controller('admin/gallery')
@RequirePermissions('admin.access')
@RequireAnyPermission(...CONTENT_PERMISSIONS)
export class AdminGalleryController {
  constructor(
    private readonly gallery: GalleryService,
    private readonly audit: AuditService,
  ) {}

  @Get('albums')
  list() {
    return this.gallery.listAdmin();
  }

  @Get('albums/:id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.gallery.getAdmin(id);
  }

  @Post('albums')
  @RequirePermissions('pages.create')
  async create(
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const saved = await this.gallery.save(null, body);
    await this.audit.record({
      action: 'gallery_album.create',
      userId: user.id,
      entityType: 'gallery_album',
      entityId: saved.id,
      details: { title: saved.title, photos: saved.photos.length },
      ipAddress: req.ip,
    });
    return saved;
  }

  @Put('albums/:id')
  @RequirePermissions('pages.edit')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const saved = await this.gallery.save(id, body);
    await this.audit.record({
      action: 'gallery_album.update',
      userId: user.id,
      entityType: 'gallery_album',
      entityId: id,
      details: {
        title: saved.title,
        photos: saved.photos.length,
        isPublished: saved.isPublished,
      },
      ipAddress: req.ip,
    });
    return saved;
  }

  @Delete('albums/:id')
  @RequirePermissions('pages.delete')
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const gone = await this.gallery.remove(id);
    await this.audit.record({
      action: 'gallery_album.delete',
      userId: user.id,
      entityType: 'gallery_album',
      entityId: id,
      details: gone,
      ipAddress: req.ip,
    });
    return { ok: true };
  }

  /** The heading and introduction at the top of the Gallery page. */
  @Put('page')
  @RequirePermissions('pages.edit')
  async savePage(
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const saved = await this.gallery.savePage(body, user.id);
    await this.audit.record({
      action: 'gallery_page.update',
      userId: user.id,
      entityType: 'site_setting',
      entityId: 'gallery.page',
      details: { title: saved.title },
      ipAddress: req.ip,
    });
    return saved;
  }
}

/** The website's Gallery page. */
@Public()
@Controller('public/gallery')
export class PublicGalleryController {
  constructor(private readonly gallery: GalleryService) {}

  @Get()
  index() {
    return this.gallery.publicIndex();
  }

  @Get(':slug')
  album(@Param('slug') slug: string) {
    return this.gallery.publicAlbum(slug.slice(0, 140));
  }
}
