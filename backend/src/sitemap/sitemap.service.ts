import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThanOrEqual, Not, type Repository } from 'typeorm';
import { BlogPost, BlogPostStatus } from '../blog/entities/blog-post.entity.js';
import { ContentCacheService } from '../cms/content-cache.service.js';
import { PageTranslation } from '../cms/entities/page-translation.entity.js';
import {
  Page,
  PageStatus,
  PageVisibility,
} from '../cms/entities/page.entity.js';
import { LanguagesService, MAIN_LANGUAGE } from '../cms/site/languages.service.js';
import { DownloadCategory } from '../downloads/entities/download-category.entity.js';
import { GalleryAlbum } from '../gallery/entities/gallery-album.entity.js';

/** One address in the sitemap. `alternates` lists the same page in each language it is published in. */
export interface SitemapEntry {
  path: string;
  lastModified: string | null;
  alternates?: { locale: string; path: string }[];
}

/** Built-in public pages that are not CMS pages. Staff, admin, applicant and preview pages are left out. */
const FIXED_PAGES = ['/blog', '/gallery', '/staff', '/downloads', '/timetable', '/apply'];

/**
 * Every address search engines may index: published public CMS pages (with their published
 * translations), published blog posts and photo albums, download categories and the built-in pages.
 * The website server turns this into /sitemap.xml.
 */
@Injectable()
export class SitemapService {
  constructor(
    @InjectRepository(Page) private readonly pages: Repository<Page>,
    @InjectRepository(PageTranslation)
    private readonly translations: Repository<PageTranslation>,
    @InjectRepository(BlogPost) private readonly posts: Repository<BlogPost>,
    @InjectRepository(GalleryAlbum)
    private readonly albums: Repository<GalleryAlbum>,
    @InjectRepository(DownloadCategory)
    private readonly categories: Repository<DownloadCategory>,
    private readonly languages: LanguagesService,
    private readonly cache: ContentCacheService,
  ) {}

  entries(): Promise<SitemapEntry[]> {
    return this.cache.getOrLoad('sitemap', () => this.build());
  }

  private async build(): Promise<SitemapEntry[]> {
    const [pages, translations, posts, albums, categories, languages] =
      await Promise.all([
        this.pages.find({
          where: {
            publishedRevision: Not(IsNull()),
            status: Not(PageStatus.Archived),
            visibility: PageVisibility.Public,
          },
          relations: { publishedRevision: true },
          order: { path: 'ASC' },
        }),
        this.translations.find({
          where: { published: Not(IsNull()) },
          relations: { page: true },
          select: { id: true, locale: true, publishedAt: true, page: { id: true } },
        }),
        this.posts.find({
          where: {
            status: BlogPostStatus.Published,
            publishedAt: LessThanOrEqual(new Date()),
          },
          select: { slug: true, publishedAt: true, updatedAt: true },
          order: { publishedAt: 'DESC' },
        }),
        this.albums.find({
          where: { isPublished: true },
          select: { slug: true, updatedAt: true },
        }),
        this.categories.find({ order: { sortOrder: 'ASC', id: 'ASC' } }),
        this.languages.list(),
      ]);

    const enabled = new Set(languages.map((l) => l.code));
    const entries: SitemapEntry[] = [];

    for (const page of pages) {
      const live = translations.filter(
        (t) => t.page.id === page.id && t.locale !== MAIN_LANGUAGE && enabled.has(t.locale),
      );
      const alternates = [
        { locale: MAIN_LANGUAGE, path: page.path },
        ...live.map((t) => ({
          locale: t.locale,
          path: LanguagesService.localize(t.locale, page.path),
        })),
      ];
      const published = page.publishedRevision?.createdAt ?? page.updatedAt;
      entries.push({
        path: page.path,
        lastModified: iso(published),
        ...(live.length ? { alternates } : {}),
      });
      for (const t of live)
        entries.push({
          path: LanguagesService.localize(t.locale, page.path),
          lastModified: iso(t.publishedAt ?? published),
          alternates,
        });
    }

    const newestPost = posts[0]?.publishedAt ?? null;
    for (const path of FIXED_PAGES)
      entries.push({ path, lastModified: path === '/blog' ? iso(newestPost) : null });
    for (const post of posts)
      entries.push({
        path: `/blog/${post.slug}`,
        lastModified: iso(post.updatedAt ?? post.publishedAt),
      });
    for (const album of albums)
      entries.push({ path: `/gallery/${album.slug}`, lastModified: iso(album.updatedAt) });
    for (const category of categories)
      entries.push({ path: `/downloads/${category.slug}`, lastModified: null });

    // A CMS page at the same address as a built-in page is listed once.
    const seen = new Set<string>();
    return entries.filter((e) => !seen.has(e.path) && seen.add(e.path));
  }
}

function iso(date: Date | null | undefined): string | null {
  return date ? new Date(date).toISOString() : null;
}
