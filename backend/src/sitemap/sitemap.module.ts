import { Controller, Get, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BlogPost } from '../blog/entities/blog-post.entity.js';
import { CmsModule } from '../cms/cms.module.js';
import { DownloadCategory } from '../downloads/entities/download-category.entity.js';
import { GalleryAlbum } from '../gallery/entities/gallery-album.entity.js';
import { Public } from '../identity/decorators.js';
import { SitemapService } from './sitemap.service.js';

/** The addresses for /sitemap.xml, which the website server builds from this list. No sign-in needed. */
@Public()
@Controller('public/sitemap')
export class SitemapController {
  constructor(private readonly sitemap: SitemapService) {}

  @Get()
  async list() {
    return { entries: await this.sitemap.entries() };
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([BlogPost, GalleryAlbum, DownloadCategory]),
    CmsModule,
  ],
  controllers: [SitemapController],
  providers: [SitemapService],
})
export class SitemapModule {}
