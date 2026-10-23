import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseBoolPipe,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { Request } from 'express';
import { AuditService } from '../../audit/audit.service.js';
import type { AuthUser } from '../../identity/auth-user.js';
import {
  CONTENT_PERMISSIONS,
  CurrentUser,
  RequireAnyPermission,
  RequirePermissions,
} from '../../identity/decorators.js';
import { MediaService, type UploadedFile as File } from './media.service.js';

const upload = FileInterceptor('file', {
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
});

class UploadDto {
  @IsOptional() @IsString() @MaxLength(300) altText?: string;
  @IsOptional() @IsString() @MaxLength(150) folder?: string;
}

class ListMediaQuery {
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsString() @MaxLength(150) folder?: string;
  @IsOptional() @IsIn(['image', 'document']) kind?: 'image' | 'document';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

class UpdateMediaDto {
  @IsOptional() @IsString() @MaxLength(300) altText?: string;
  @IsOptional() @IsString() @MaxLength(500) caption?: string;
  @IsOptional() @IsString() @MaxLength(200) credit?: string;
  @IsOptional() @IsBoolean() hasConsent?: boolean;
  @IsOptional() @IsString() @MaxLength(150) folder?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(1) focalX?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1) focalY?: number;
}

@Controller('admin/media')
@RequirePermissions('admin.access')
// Content editors, plus people who pick images elsewhere (course photos, the site logo).
@RequireAnyPermission(
  ...CONTENT_PERMISSIONS,
  'media.upload',
  'media.edit',
  'media.delete',
  'short_courses.create',
  'short_courses.edit',
  'settings.edit',
)
export class MediaController {
  constructor(
    private readonly media: MediaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@Query() q: ListMediaQuery) {
    return this.media.list(q);
  }

  @Get('folders')
  folders() {
    return this.media.folders();
  }

  @Get(':id')
  async get(@Param('id', ParseIntPipe) id: number) {
    return {
      ...(await this.media.get(id)),
      usages: await this.media.usages(id),
    };
  }

  @Post()
  @RequirePermissions('media.upload')
  @UseInterceptors(upload)
  async upload(
    @UploadedFile() file: File,
    @Body() dto: UploadDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const saved = await this.media.upload(file, dto, user.id);
    await this.audit.record({
      action: 'media.upload',
      userId: user.id,
      entityType: 'media',
      entityId: saved.id,
      ipAddress: req.ip,
    });
    return saved;
  }

  @Post(':id/replace')
  @HttpCode(200)
  @RequirePermissions('media.edit')
  @UseInterceptors(upload)
  async replace(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: File,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const saved = await this.media.replace(id, file);
    await this.audit.record({
      action: 'media.replace',
      userId: user.id,
      entityType: 'media',
      entityId: id,
      ipAddress: req.ip,
    });
    return saved;
  }

  @Patch(':id')
  @RequirePermissions('media.edit')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateMediaDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const saved = await this.media.update(id, dto);
    await this.audit.record({
      action: 'media.update',
      userId: user.id,
      entityType: 'media',
      entityId: id,
      details: { ...dto },
      ipAddress: req.ip,
    });
    return saved;
  }

  @Delete(':id')
  @RequirePermissions('media.delete')
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @Query('force', new ParseBoolPipe({ optional: true }))
    force: boolean | undefined,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    await this.media.remove(id, force ?? false);
    await this.audit.record({
      action: 'media.delete',
      userId: user.id,
      entityType: 'media',
      entityId: id,
      details: { force: !!force },
      ipAddress: req.ip,
    });
    return { ok: true };
  }
}
