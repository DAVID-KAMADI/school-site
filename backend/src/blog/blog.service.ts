import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThanOrEqual, type Repository } from 'typeorm';
import type { AuthUser } from '../identity/auth-user.js';
import { Media } from '../cms/entities/media.entity.js';
import { MediaUsage } from '../cms/entities/media-usage.entity.js';
import { MediaService, type MediaView } from '../cms/media/media.service.js';
import { htmlToText, sanitizeRichText } from '../cms/blocks/rich-text.js';
import { BlogPost, BlogPostStatus } from './entities/blog-post.entity.js';
import type { UpdateBlogPostDto } from './blog.dto.js';

export interface BlogPostView {
  id: number;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  status: BlogPostStatus;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  author: string | null;
  coverImage: MediaView | null;
}

export type BlogPostSummary = Omit<BlogPostView, 'content'>;

@Injectable()
export class BlogService {
  constructor(
    @InjectRepository(BlogPost) private readonly posts: Repository<BlogPost>,
    @InjectRepository(Media) private readonly media: Repository<Media>,
    @InjectRepository(MediaUsage)
    private readonly mediaUsage: Repository<MediaUsage>,
    private readonly mediaService: MediaService,
  ) {}

  private view(post: BlogPost): BlogPostView {
    return {
      id: post.id,
      title: post.title,
      slug: post.slug,
      excerpt: post.excerpt,
      content: post.content,
      status: post.status,
      publishedAt: post.publishedAt,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      author: post.author?.fullName ?? null,
      coverImage: post.coverImage
        ? this.mediaService.view(post.coverImage)
        : null,
    };
  }

  async listAdmin(): Promise<BlogPostSummary[]> {
    const posts = await this.posts.find({
      relations: { coverImage: { variants: true }, author: true },
      order: { updatedAt: 'DESC' },
    });
    return posts.map((post) => this.summary(post));
  }

  async getAdmin(id: number): Promise<BlogPostView> {
    const post = await this.posts.findOne({
      where: { id },
      relations: { coverImage: { variants: true }, author: true },
    });
    if (!post) throw new NotFoundException('Blog post not found.');
    return this.view(post);
  }

  async create(title: string, user: AuthUser): Promise<BlogPostView> {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) throw new BadRequestException('A title is required.');
    const post = this.posts.create({
      title: normalizedTitle,
      slug: await this.uniqueSlug(normalizedTitle),
      excerpt: '',
      content: '',
      status: BlogPostStatus.Draft,
      author: { id: user.id },
    });
    return this.view(await this.posts.save(post));
  }

  async update(id: number, input: UpdateBlogPostDto): Promise<BlogPostView> {
    const post = await this.findPost(id);
    const title = input.title.trim();
    if (!title) throw new BadRequestException('A title is required.');

    const slug = await this.uniqueSlug(input.slug?.trim() || title, id);
    const coverImageId = input.coverImageId ?? null;
    let coverImage: Media | null = null;
    if (coverImageId !== null) {
      coverImage = await this.media.findOne({
        where: { id: coverImageId, deletedAt: IsNull() },
        relations: { variants: true },
      });
      if (!coverImage || !coverImage.mimeType.startsWith('image/'))
        throw new BadRequestException(
          'Choose an available image for the cover.',
        );
    }

    post.title = title;
    post.slug = slug;
    post.excerpt = input.excerpt?.trim() ?? '';
    post.content = sanitizeRichText(input.content);
    post.coverImage = coverImage;
    const saved = await this.posts.save(post);
    const existingUsage = await this.mediaUsage.findOne({
      where: {
        entityType: 'blog_post',
        entityId: String(id),
        fieldPath: 'coverImage',
      },
      relations: { media: true },
    });
    if (existingUsage && existingUsage.media.id !== coverImageId)
      await this.mediaUsage.remove(existingUsage);
    if (coverImageId !== null && existingUsage?.media.id !== coverImageId)
      await this.mediaUsage.save(
        this.mediaUsage.create({
          media: { id: coverImageId },
          entityType: 'blog_post',
          entityId: String(id),
          fieldPath: 'coverImage',
        }),
      );
    return this.view(saved);
  }

  async publish(id: number): Promise<BlogPostView> {
    const post = await this.findPost(id);
    if (!post.title.trim() || !htmlToText(post.content))
      throw new BadRequestException(
        'Add a title and article content before publishing.',
      );
    post.status = BlogPostStatus.Published;
    post.publishedAt = new Date();
    return this.view(await this.posts.save(post));
  }

  async unpublish(id: number): Promise<BlogPostView> {
    const post = await this.findPost(id);
    post.status = BlogPostStatus.Draft;
    post.publishedAt = null;
    return this.view(await this.posts.save(post));
  }

  async remove(id: number): Promise<void> {
    const post = await this.findPost(id);
    await this.posts.remove(post);
    await this.mediaUsage.delete({
      entityType: 'blog_post',
      entityId: String(id),
    });
  }

  async listPublished(): Promise<BlogPostSummary[]> {
    const posts = await this.posts.find({
      where: {
        status: BlogPostStatus.Published,
        publishedAt: LessThanOrEqual(new Date()),
      },
      relations: { coverImage: { variants: true }, author: true },
      order: { publishedAt: 'DESC' },
      take: 100,
    });
    return posts.map((post) => this.summary(post));
  }

  async getPublished(slug: string): Promise<BlogPostView> {
    const post = await this.posts.findOne({
      where: {
        slug,
        status: BlogPostStatus.Published,
        publishedAt: LessThanOrEqual(new Date()),
      },
      relations: { coverImage: { variants: true }, author: true },
    });
    if (!post) throw new NotFoundException('Blog post not found.');
    return this.view(post);
  }

  private async findPost(id: number): Promise<BlogPost> {
    const post = await this.posts.findOne({
      where: { id },
      relations: { coverImage: { variants: true }, author: true },
    });
    if (!post) throw new NotFoundException('Blog post not found.');
    return post;
  }

  private summary(post: BlogPost): BlogPostSummary {
    const { content: _content, ...summary } = this.view(post);
    return summary;
  }

  private async uniqueSlug(value: string, exceptId?: number): Promise<string> {
    const slug = value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 180)
      .replace(/-$/g, '');
    if (!slug) throw new BadRequestException('Enter a valid web address.');
    const existing = await this.posts.findOne({ where: { slug } });
    if (existing && existing.id !== exceptId)
      throw new ConflictException('That web address is already in use.');
    return slug;
  }
}
