import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import type { AuthUser } from '../../identity/auth-user.js';
import {
  CONTENT_PERMISSIONS,
  CurrentUser,
  RequireAnyPermission,
  RequirePermissions,
} from '../../identity/decorators.js';
import { BLOCK_TYPES } from '../blocks/block-schemas.js';
import {
  CreatePageDto,
  PageSettingsDto,
  PreviewLinkDto,
  SaveContentDto,
  SaveTranslationDto,
} from './dto.js';
import { PageTranslationsService } from './page-translations.service.js';
import { PagesService } from './pages.service.js';
import { createPreviewToken } from './preview-token.js';

/**
 * Admin page management. Permission checks that depend on the page's section
 * (e.g. a Library-only editor) happen in PagesService.
 */
@Controller('admin/pages')
@RequirePermissions('admin.access')
@RequireAnyPermission(...CONTENT_PERMISSIONS)
export class PagesController {
  constructor(
    private readonly pages: PagesService,
    private readonly translations: PageTranslationsService,
  ) {}

  /** Also used to choose pages for menus and for section-limited roles. */
  @Get()
  @RequireAnyPermission(
    ...CONTENT_PERMISSIONS,
    'menus.edit',
    'users.manage',
    'access.manage',
  )
  tree(@CurrentUser() user: AuthUser) {
    return this.pages.tree(user);
  }

  @Get('block-types')
  blockTypes() {
    return BLOCK_TYPES;
  }

  @Get('trash')
  @RequirePermissions('pages.delete')
  trash() {
    return this.pages.listTrash();
  }

  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.pages.detail(id, user);
  }

  @Post()
  @RequirePermissions('pages.create')
  create(@Body() dto: CreatePageDto, @CurrentUser() user: AuthUser) {
    return this.pages.create(dto, user);
  }

  @Put(':id/content')
  @RequirePermissions('pages.edit')
  saveContent(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveContentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.pages.saveContent(id, dto, user);
  }

  @Patch(':id/settings')
  @RequirePermissions('pages.edit')
  settings(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PageSettingsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.pages.updateSettings(id, dto, user);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermissions('pages.edit')
  submit(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.pages.submitForReview(id, user);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @RequirePermissions('pages.publish')
  publish(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.pages.publish(id, user);
  }

  @Post(':id/unpublish')
  @HttpCode(200)
  @RequirePermissions('pages.publish')
  unpublish(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.pages.unpublish(id, user);
  }

  @Get(':id/revisions')
  revisions(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.pages.listRevisions(id, user);
  }

  @Get(':id/revisions/:revisionId')
  revision(
    @Param('id', ParseIntPipe) id: number,
    @Param('revisionId', ParseIntPipe) revisionId: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.pages.getRevision(id, revisionId, user);
  }

  @Post(':id/revisions/:revisionId/restore')
  @HttpCode(200)
  @RequirePermissions('pages.edit')
  restoreRevision(
    @Param('id', ParseIntPipe) id: number,
    @Param('revisionId', ParseIntPipe) revisionId: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.pages.restoreRevision(id, revisionId, user);
  }

  @Post(':id/duplicate')
  @RequirePermissions('pages.create')
  duplicate(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.pages.duplicate(id, user);
  }

  @Post(':id/lock')
  @HttpCode(200)
  lock(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.pages.lock(id, user);
  }

  @Delete(':id/lock')
  async unlock(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
  ) {
    await this.pages.unlock(id, user);
    return { ok: true };
  }

  /** Shareable link to the latest draft, for reviewers without an account. */
  @Post(':id/preview-link')
  @HttpCode(200)
  async previewLink(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PreviewLinkDto,
    @CurrentUser() user: AuthUser,
  ) {
    const revisions = await this.pages.listRevisions(id, user);
    const hours = dto.hours ?? 48;
    const expiresAt = Date.now() + hours * 3_600_000;
    const token = createPreviewToken({
      pageId: id,
      revisionId: revisions[0].id,
      expiresAt,
    });
    return { url: `/preview/${token}`, expiresAt: new Date(expiresAt) };
  }

  @Delete(':id')
  @RequirePermissions('pages.delete')
  async trashPage(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
  ) {
    await this.pages.trash(id, user);
    return { ok: true };
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermissions('pages.delete')
  restore(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.pages.restore(id, user);
  }

  // ---------- Translations (the page in other languages) ----------

  @Get(':id/translations')
  translationList(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.translations.list(id, user);
  }

  @Get(':id/translations/:locale')
  translation(
    @Param('id', ParseIntPipe) id: number,
    @Param('locale') locale: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.translations.detail(id, locale, user);
  }

  @Put(':id/translations/:locale')
  @RequirePermissions('pages.edit')
  saveTranslation(
    @Param('id', ParseIntPipe) id: number,
    @Param('locale') locale: string,
    @Body() dto: SaveTranslationDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.translations.save(id, locale, dto, user);
  }

  @Post(':id/translations/:locale/publish')
  @HttpCode(200)
  @RequirePermissions('pages.publish')
  publishTranslation(
    @Param('id', ParseIntPipe) id: number,
    @Param('locale') locale: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.translations.publish(id, locale, user);
  }

  @Post(':id/translations/:locale/unpublish')
  @HttpCode(200)
  @RequirePermissions('pages.publish')
  unpublishTranslation(
    @Param('id', ParseIntPipe) id: number,
    @Param('locale') locale: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.translations.unpublish(id, locale, user);
  }

  @Delete(':id/translations/:locale')
  @RequirePermissions('pages.delete')
  async deleteTranslation(
    @Param('id', ParseIntPipe) id: number,
    @Param('locale') locale: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.translations.remove(id, locale, user);
    return { ok: true };
  }
}
