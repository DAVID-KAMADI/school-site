import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CmsModule } from '../cms/cms.module.js';
import { Media } from '../cms/entities/media.entity.js';
import { MediaUsage } from '../cms/entities/media-usage.entity.js';
import { BlogPost } from './entities/blog-post.entity.js';
import {
  AdminBlogController,
  PublicBlogController,
} from './blog.controller.js';
import { BlogService } from './blog.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([BlogPost, Media, MediaUsage]), CmsModule],
  controllers: [AdminBlogController, PublicBlogController],
  providers: [BlogService],
})
export class BlogModule {}
