import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CmsModule } from '../cms/cms.module.js';
import { Media } from '../cms/entities/media.entity.js';
import { SiteSetting } from '../cms/entities/site-setting.entity.js';
import {
  AdminDownloadsController,
  PublicDownloadsController,
} from './downloads.controller.js';
import { DownloadsService } from './downloads.service.js';
import { DownloadCategory } from './entities/download-category.entity.js';
import { Download } from './entities/download.entity.js';

/** Tenders, job vacancies, forms and other documents on the website's Downloads page. */
@Module({
  imports: [
    TypeOrmModule.forFeature([DownloadCategory, Download, Media, SiteSetting]),
    CmsModule,
  ],
  controllers: [AdminDownloadsController, PublicDownloadsController],
  providers: [DownloadsService],
})
export class DownloadsModule {}
