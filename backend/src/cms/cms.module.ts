import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Programme } from '../admissions/entities/programme.entity.js';
import { ShortCourse } from '../admissions/entities/short-course.entity.js';
import { ContentCacheService } from './content-cache.service.js';
import { MediaUsage } from './entities/media-usage.entity.js';
import { MediaVariant } from './entities/media-variant.entity.js';
import { Media } from './entities/media.entity.js';
import { MenuItem } from './entities/menu-item.entity.js';
import { Menu } from './entities/menu.entity.js';
import { PageBlock } from './entities/page-block.entity.js';
import { PageRevision } from './entities/page-revision.entity.js';
import { PageTranslation } from './entities/page-translation.entity.js';
import { Page } from './entities/page.entity.js';
import { Redirect } from './entities/redirect.entity.js';
import { SiteSetting } from './entities/site-setting.entity.js';
import { TextString } from './entities/text-string.entity.js';
import { MediaController } from './media/media.controller.js';
import { MediaService } from './media/media.service.js';
import { PageScheduler } from './pages/page-scheduler.js';
import { PageTranslationsService } from './pages/page-translations.service.js';
import { PagesController } from './pages/pages.controller.js';
import { PagesService } from './pages/pages.service.js';
import { PublicController } from './public/public.controller.js';
import { PublicService } from './public/public.service.js';
import { LanguagesService } from './site/languages.service.js';
import { SiteController } from './site/site.controller.js';
import { SiteService } from './site/site.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Page,
      PageBlock,
      PageRevision,
      PageTranslation,
      Media,
      MediaVariant,
      MediaUsage,
      Menu,
      MenuItem,
      SiteSetting,
      TextString,
      Redirect,
      // Read-only here: listed on pages by the Programmes and Short courses blocks.
      Programme,
      ShortCourse,
    ]),
  ],
  controllers: [
    PagesController,
    MediaController,
    SiteController,
    PublicController,
  ],
  providers: [
    ContentCacheService,
    MediaService,
    PagesService,
    PageTranslationsService,
    PageScheduler,
    SiteService,
    LanguagesService,
    PublicService,
  ],
  exports: [TypeOrmModule, MediaService, PagesService, ContentCacheService],
})
export class CmsModule {}
