import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CmsModule } from '../cms/cms.module.js';
import { GalleryAlbum } from './entities/gallery-album.entity.js';
import { GalleryPhoto } from './entities/gallery-photo.entity.js';
import {
  AdminGalleryController,
  PublicGalleryController,
} from './gallery.controller.js';
import { GalleryService } from './gallery.service.js';

/** Photo albums on the website's Gallery page. */
@Module({
  imports: [TypeOrmModule.forFeature([GalleryAlbum, GalleryPhoto]), CmsModule],
  controllers: [AdminGalleryController, PublicGalleryController],
  providers: [GalleryService],
})
export class GalleryModule {}
