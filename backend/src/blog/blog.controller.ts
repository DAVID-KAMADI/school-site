import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
} from '@nestjs/common';
import type { AuthUser } from '../identity/auth-user.js';
import {
  CONTENT_PERMISSIONS,
  CurrentUser,
  Public,
  RequireAnyPermission,
  RequirePermissions,
} from '../identity/decorators.js';
import { CreateBlogPostDto, UpdateBlogPostDto } from './blog.dto.js';
import { BlogService } from './blog.service.js';

@Controller('admin/blog')
@RequirePermissions('admin.access')
@RequireAnyPermission(...CONTENT_PERMISSIONS)
export class AdminBlogController {
  constructor(private readonly blog: BlogService) {}

  @Get()
  list() {
    return this.blog.listAdmin();
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.blog.getAdmin(id);
  }

  @Post()
  @RequirePermissions('pages.create')
  create(@Body() dto: CreateBlogPostDto, @CurrentUser() user: AuthUser) {
    return this.blog.create(dto.title, user);
  }

  @Put(':id')
  @RequirePermissions('pages.edit')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBlogPostDto,
  ) {
    return this.blog.update(id, dto);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @RequirePermissions('pages.publish')
  publish(@Param('id', ParseIntPipe) id: number) {
    return this.blog.publish(id);
  }

  @Post(':id/unpublish')
  @HttpCode(200)
  @RequirePermissions('pages.publish')
  unpublish(@Param('id', ParseIntPipe) id: number) {
    return this.blog.unpublish(id);
  }

  @Delete(':id')
  @RequirePermissions('pages.delete')
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.blog.remove(id);
    return { ok: true };
  }
}

@Public()
@Controller('public/blog')
export class PublicBlogController {
  constructor(private readonly blog: BlogService) {}

  @Get('posts')
  list() {
    return this.blog.listPublished();
  }

  @Get('posts/:slug')
  get(@Param('slug') slug: string) {
    return this.blog.getPublished(slug);
  }
}
