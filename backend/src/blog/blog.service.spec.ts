import { ConflictException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { Media } from '../cms/entities/media.entity.js';
import { MediaUsage } from '../cms/entities/media-usage.entity.js';
import type { MediaService } from '../cms/media/media.service.js';
import { BlogService } from './blog.service.js';
import { BlogPost, BlogPostStatus } from './entities/blog-post.entity.js';

describe('BlogService', () => {
  function setup() {
    const post: BlogPost = {
      id: 1,
      title: 'School news',
      slug: 'school-news',
      excerpt: '',
      content: '<p>Welcome</p>',
      status: BlogPostStatus.Draft,
      coverImage: null,
      author: null,
      publishedAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const posts = {
      create: vi.fn((value: Partial<BlogPost>) => value),
      find: vi.fn(async () => [post]),
      findOne: vi.fn(async (options: { where: Record<string, unknown> }) =>
        'slug' in options.where ? null : post,
      ),
      save: vi.fn(async (value: BlogPost) => value),
      remove: vi.fn(async () => post),
    };
    const media = { findOne: vi.fn() };
    const usage = {
      findOne: vi.fn(async () => null),
      save: vi.fn(),
      create: vi.fn(),
      remove: vi.fn(),
      delete: vi.fn(),
    };
    const mediaService = { view: vi.fn() };
    const blog = new BlogService(
      posts as unknown as Repository<BlogPost>,
      media as unknown as Repository<Media>,
      usage as unknown as Repository<MediaUsage>,
      mediaService as unknown as MediaService,
    );
    return { blog, posts, post };
  }

  it('sanitizes article HTML before publishing', async () => {
    const { blog, posts, post } = setup();
    post.content = '<p onclick="alert(1)">Welcome</p><script>alert(1)</script>';

    const saved = await blog.update(1, {
      title: post.title,
      slug: post.slug,
      excerpt: '',
      content: post.content,
      coverImageId: null,
    });
    const published = await blog.publish(1);

    expect(saved.content).toBe('<p>Welcome</p>');
    expect(published.status).toBe(BlogPostStatus.Published);
    expect(posts.save).toHaveBeenCalled();
  });

  it('does not expose article bodies in the public list response', async () => {
    const { blog, posts } = setup();

    const [summary] = await blog.listPublished();

    expect(summary.slug).toBe('school-news');
    expect(summary).not.toHaveProperty('content');
    expect(posts.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: BlogPostStatus.Published,
          publishedAt: expect.anything(),
        }),
      }),
    );
  });

  it('does not publish posts without readable content', async () => {
    const { blog, post } = setup();
    post.content = '<script>alert(1)</script>';

    await expect(blog.publish(1)).rejects.toThrow(
      'Add a title and article content before publishing.',
    );
  });

  it('rejects a duplicate post address', async () => {
    const { blog, posts } = setup();
    posts.findOne.mockResolvedValue({
      id: 9,
      slug: 'school-news',
    } as BlogPost);

    await expect(
      blog.create('School news', {
        id: 4,
        email: 'editor@example.test',
        fullName: 'Site Editor',
        roles: [],
        permissions: [],
        scopedPermissions: [],
        twoFactorEnabled: true,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
