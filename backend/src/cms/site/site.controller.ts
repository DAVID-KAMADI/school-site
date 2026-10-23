import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  IsDefined,
  IsIn,
  IsString,
  Length,
  Matches,
  MaxLength,
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
import { normalizePath } from '../pages/page-paths.js';
import { LanguagesService } from './languages.service.js';
import { SiteService } from './site.service.js';

class SettingDto {
  @IsDefined() value: unknown;
}

class TextDto {
  @Matches(/^[a-z]{2}$/, {
    message: 'Use a two-letter language code such as en or sw.',
  })
  locale: string;
  @IsString() @MaxLength(5000) value: string;
}

class RedirectDto {
  @IsString()
  @Length(2, 191)
  @Matches(/^\//, { message: 'Must start with /' })
  fromPath: string;
  @IsString()
  @Length(1, 500)
  @Matches(/^(\/|https:\/\/)/, {
    message: 'Must be a site path or https:// link',
  })
  toPath: string;
  @IsIn([301, 302]) statusCode: 301 | 302;
}

@Controller('admin')
@RequirePermissions('admin.access')
export class SiteController {
  constructor(
    private readonly site: SiteService,
    private readonly audit: AuditService,
    private readonly languages: LanguagesService,
  ) {}

  /** Enabled languages, plus the settings that can be translated and their translations. */
  @Get('languages')
  @RequireAnyPermission(
    ...CONTENT_PERMISSIONS,
    'settings.edit',
    'menus.edit',
    'text_strings.edit',
  )
  async languageList() {
    return {
      languages: await this.languages.list(),
      translatableSettings: await this.site.translatableSettings(),
      settingTranslations: await this.languages.settingTranslations(),
    };
  }

  @Put('languages')
  @RequirePermissions('settings.edit')
  async saveLanguages(
    @Body() body: { languages: unknown },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const languages = await this.languages.save(body?.languages, user.id);
    await this.audit.record({
      action: 'languages.update',
      userId: user.id,
      entityType: 'setting',
      entityId: 'languages.enabled',
      details: { languages: languages.map((l) => l.code) },
      ipAddress: req.ip,
    });
    return languages;
  }

  @Put('languages/:locale/settings')
  @RequirePermissions('settings.edit')
  async saveSettingTranslations(
    @Param('locale') locale: string,
    @Body() body: { values: unknown },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const values = await this.languages.saveSettingTranslations(
      locale,
      body?.values,
      user.id,
    );
    await this.audit.record({
      action: 'settings.translate',
      userId: user.id,
      entityType: 'setting',
      entityId: `languages:${locale}`,
      details: { keys: Object.keys(values) },
      ipAddress: req.ip,
    });
    return values;
  }

  @Get('menus')
  @RequirePermissions('menus.edit')
  menus() {
    return this.site.adminMenus();
  }

  @Put('menus/:location')
  @RequirePermissions('menus.edit')
  async saveMenu(
    @Param('location') location: string,
    @Body() body: { items: unknown },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const menu = await this.site.saveMenu(location, body?.items);
    await this.audit.record({
      action: 'menu.save',
      userId: user.id,
      entityType: 'menu',
      entityId: location,
      ipAddress: req.ip,
    });
    return menu;
  }

  @Get('settings')
  @RequirePermissions('settings.edit')
  settings() {
    return this.site.adminSettings();
  }

  @Put('settings/:key')
  @RequirePermissions('settings.edit')
  async saveSetting(
    @Param('key') key: string,
    @Body() dto: SettingDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const saved = await this.site.saveSetting(key, dto.value, user.id);
    await this.audit.record({
      action: 'settings.update',
      userId: user.id,
      entityType: 'setting',
      entityId: key,
      details: { value: dto.value },
      ipAddress: req.ip,
    });
    return saved;
  }

  @Get('text-strings')
  @RequirePermissions('text_strings.edit')
  texts(@Query('locale') locale?: string) {
    return this.site.adminTexts(locale);
  }

  @Put('text-strings/:key')
  @RequirePermissions('text_strings.edit')
  async saveText(
    @Param('key') key: string,
    @Body() dto: TextDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const saved = await this.site.saveText(key, dto.locale, dto.value, user.id);
    await this.audit.record({
      action: 'text.update',
      userId: user.id,
      entityType: 'text_string',
      entityId: `${key}:${dto.locale}`,
      ipAddress: req.ip,
    });
    return saved;
  }

  @Get('redirects')
  @RequirePermissions('redirects.edit')
  redirects() {
    return this.site.listRedirects();
  }

  @Post('redirects')
  @RequirePermissions('redirects.edit')
  async saveRedirect(
    @Body() dto: RedirectDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const from = normalizePath(dto.fromPath);
    const saved = await this.site.saveRedirect(
      from,
      dto.toPath,
      dto.statusCode,
    );
    await this.audit.record({
      action: 'redirect.save',
      userId: user.id,
      entityType: 'redirect',
      entityId: from,
      details: { ...dto },
      ipAddress: req.ip,
    });
    return saved;
  }

  @Delete('redirects/:id')
  @RequirePermissions('redirects.edit')
  async deleteRedirect(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    await this.site.deleteRedirect(id);
    await this.audit.record({
      action: 'redirect.delete',
      userId: user.id,
      entityType: 'redirect',
      entityId: id,
      ipAddress: req.ip,
    });
    return { ok: true };
  }
}
