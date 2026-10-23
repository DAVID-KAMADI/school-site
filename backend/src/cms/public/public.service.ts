import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, type Repository } from 'typeorm';
import { Programme } from '../../admissions/entities/programme.entity.js';
import { ShortCourse } from '../../admissions/entities/short-course.entity.js';
import { collectMediaRefs } from '../blocks/block-schemas.js';
import { ContentCacheService } from '../content-cache.service.js';
import type { PageSnapshot } from '../entities/page-revision.entity.js';
import { PageRevision } from '../entities/page-revision.entity.js';
import {
  PageTranslation,
  type TranslationSnapshot,
} from '../entities/page-translation.entity.js';
import { Page, PageStatus, PageVisibility } from '../entities/page.entity.js';
import { MediaService } from '../media/media.service.js';
import { readPreviewToken } from '../pages/preview-token.js';
import { LanguagesService, MAIN_LANGUAGE } from '../site/languages.service.js';
import { SiteService } from '../site/site.service.js';

export type PublicPageResult =
  | { kind: 'page'; body: unknown }
  | { kind: 'redirect'; to: string; statusCode: number }
  | { kind: 'restricted'; visibility: PageVisibility }
  | { kind: 'not_found' };

/** Builds what visitors see: only published revisions, with media and dynamic lists resolved. */
@Injectable()
export class PublicService {
  constructor(
    @InjectRepository(Page) private readonly pages: Repository<Page>,
    @InjectRepository(PageRevision)
    private readonly revisions: Repository<PageRevision>,
    @InjectRepository(PageTranslation)
    private readonly translations: Repository<PageTranslation>,
    @InjectRepository(Programme)
    private readonly programmes: Repository<Programme>,
    @InjectRepository(ShortCourse)
    private readonly shortCourses: Repository<ShortCourse>,
    private readonly media: MediaService,
    private readonly site: SiteService,
    private readonly languages: LanguagesService,
    private readonly cache: ContentCacheService,
  ) {}

  /**
   * The published page at a path. "/fr/admissions" is the French version of "/admissions":
   * its published translation, or the English page (marked `translated: false`) until one exists.
   */
  async pageByPath(fullPath: string): Promise<PublicPageResult> {
    return this.cache.getOrLoad(
      `page:${fullPath}`,
      async (): Promise<PublicPageResult> => {
        const { locale, path } = await this.languages.splitPath(fullPath);
        const page = await this.pages.findOne({
          where: {
            path,
            publishedRevision: Not(IsNull()),
            status: Not(PageStatus.Archived),
          },
          relations: { publishedRevision: true, parent: true },
        });
        if (!page) {
          const redirect = await this.site.findRedirect(path);
          return redirect
            ? {
                kind: 'redirect',
                to: redirect.toPath.startsWith('/')
                  ? LanguagesService.localize(locale, redirect.toPath)
                  : redirect.toPath,
                statusCode: redirect.statusCode,
              }
            : { kind: 'not_found' };
        }
        // Applicant/student-only pages are served by the portal once those areas exist.
        if (page.visibility !== PageVisibility.Public)
          return { kind: 'restricted', visibility: page.visibility };
        return {
          kind: 'page',
          body: await this.render(
            page,
            page.publishedRevision!.snapshot,
            locale,
          ),
        };
      },
    );
  }

  async preview(token: string) {
    const payload = readPreviewToken(token);
    if (!payload) return null;
    const rev = await this.revisions.findOne({
      where: { id: payload.revisionId, page: { id: payload.pageId } },
      relations: { page: { parent: true } },
    });
    if (!rev) return null;
    return {
      ...(await this.render(rev.page, rev.snapshot, MAIN_LANGUAGE)),
      preview: {
        revision: rev.revisionNumber,
        expiresAt: new Date(payload.expiresAt),
      },
    };
  }

  private async render(page: Page, english: PageSnapshot, locale: string) {
    const translation =
      locale === MAIN_LANGUAGE
        ? null
        : ((await this.publishedTranslations([page.id], locale)).get(page.id) ??
          null);
    const snapshot = translation
      ? { ...english, ...translation, socialImageId: english.socialImageId }
      : english;
    const blocks = snapshot.blocks.filter((b) => !b.isHidden);
    const mediaIds = blocks.flatMap((b) =>
      collectMediaRefs(b.content).map((r) => r.mediaId),
    );
    if (snapshot.socialImageId) mediaIds.push(snapshot.socialImageId);

    const rendered = [];
    for (const block of blocks) {
      if (block.type === 'child_pages') {
        const items = await this.childPages(
          page.id,
          Number(block.content.limit ?? 12),
          locale,
        );
        items.forEach((c) => c.mediaId && mediaIds.push(c.mediaId));
        rendered.push({
          type: block.type,
          content: { ...block.content, items },
        });
      } else if (block.type === 'programmes') {
        const levels = (block.content.levels as string[] | undefined) ?? [];
        const programmes = await this.activeProgrammes(levels);
        const shortCourses = block.content.showShortCourses
          ? await this.activeShortCourses('', 60)
          : [];
        shortCourses.forEach((c) => c.imageId && mediaIds.push(c.imageId));
        rendered.push({
          type: block.type,
          content: { ...block.content, programmes, shortCourses },
        });
      } else if (block.type === 'short_courses') {
        const items = await this.activeShortCourses(
          String(block.content.category ?? ''),
          Number(block.content.limit ?? 24),
        );
        items.forEach((c) => c.imageId && mediaIds.push(c.imageId));
        rendered.push({
          type: block.type,
          content: { ...block.content, items },
        });
      } else {
        rendered.push({ type: block.type, content: block.content });
      }
    }
    const media = await this.media.getMany(mediaIds);

    return {
      locale,
      /** False when the visitor chose a language this page has not been translated into yet. */
      translated: locale === MAIN_LANGUAGE || !!translation,
      /** The page's address in each language it is published in, for search engines. */
      alternates: await this.alternates(page),
      page: {
        id: page.id,
        path: LanguagesService.localize(locale, page.path),
        title: snapshot.title,
        template: snapshot.template,
        seoTitle: snapshot.seoTitle || snapshot.title,
        metaDescription: snapshot.metaDescription,
        socialImageId: snapshot.socialImageId,
      },
      breadcrumbs: await this.breadcrumbs(page, locale),
      blocks: rendered,
      /** Media referenced by mediaId anywhere in the blocks, keyed by id. */
      media: Object.fromEntries(media),
    };
  }

  /** Programmes applicants can choose, in the order set in Admissions setup. */
  private async activeProgrammes(levels: string[]) {
    const rows = await this.programmes.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
    return rows
      .filter((p) => !levels.length || levels.includes(p.level))
      .map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        level: p.level,
        school: p.school,
        duration: p.duration,
        studyModes: p.studyModes,
        minMeanGrade: p.minMeanGrade,
        description: p.description,
      }));
  }

  /** Short courses shown on the site; a start date already past is left out. */
  private async activeShortCourses(category: string, limit: number) {
    const rows = await this.shortCourses.find({
      where: { isActive: true, ...(category ? { category } : {}) },
      order: { sortOrder: 'ASC', title: 'ASC' },
      take: Math.min(limit, 60),
    });
    const today = new Date().toISOString().slice(0, 10);
    return rows.map((c) => ({
      id: c.id,
      title: c.title,
      category: c.category,
      summary: c.summary,
      duration: c.duration,
      fee: c.fee,
      delivery: c.delivery,
      schedule: c.schedule,
      nextStartOn:
        c.nextStartOn && c.nextStartOn >= today ? c.nextStartOn : null,
      imageId: c.imageId,
    }));
  }

  /** Live, public child pages, with a summary and image taken from their published content. */
  private async childPages(parentId: number, limit: number, locale: string) {
    const children = await this.pages.find({
      where: {
        parent: { id: parentId },
        publishedRevision: Not(IsNull()),
        visibility: PageVisibility.Public,
      },
      relations: { publishedRevision: true },
      order: { title: 'ASC' },
      take: Math.min(limit, 50),
    });
    const translated = await this.publishedTranslations(
      children.map((c) => c.id),
      locale,
    );
    return children.map((c) => {
      const s = c.publishedRevision!.snapshot;
      const t = translated.get(c.id);
      const firstImage =
        s.blocks.flatMap((b) => collectMediaRefs(b.content))[0]?.mediaId ??
        null;
      return {
        title: t?.title ?? s.title,
        path: LanguagesService.localize(locale, c.path),
        summary: (t ? t.metaDescription : s.metaDescription) ?? '',
        mediaId: s.socialImageId ?? firstImage,
      };
    });
  }

  private async breadcrumbs(page: Page, locale: string) {
    const crumbs: { id: number; title: string; path: string }[] = [];
    let cur: Page | null = page.parent ?? null;
    for (let i = 0; cur && i < 10; i++) {
      const parent: Page | null = await this.pages.findOne({
        where: { id: cur.id },
        relations: { parent: true },
      });
      if (!parent) break;
      crumbs.unshift({ id: parent.id, title: parent.title, path: parent.path });
      cur = parent.parent ?? null;
    }
    const translated = await this.publishedTranslations(
      crumbs.map((c) => c.id),
      locale,
    );
    return crumbs.map((c) => ({
      title: translated.get(c.id)?.title ?? c.title,
      path: LanguagesService.localize(locale, c.path),
    }));
  }

  /** Published translations of these pages into one language, by page id. */
  private async publishedTranslations(
    pageIds: number[],
    locale: string,
  ): Promise<Map<number, TranslationSnapshot>> {
    if (locale === MAIN_LANGUAGE || !pageIds.length) return new Map();
    const rows = await this.translations.find({
      where: { page: { id: In(pageIds) }, locale, published: Not(IsNull()) },
      relations: { page: true },
    });
    return new Map(rows.map((r) => [r.page.id, r.published!]));
  }

  private async alternates(page: Page) {
    const languages = await this.languages.list();
    const live = await this.translations.find({
      where: { page: { id: page.id }, published: Not(IsNull()) },
      select: { id: true, locale: true },
    });
    return languages
      .filter(
        (l) =>
          l.code === MAIN_LANGUAGE || live.some((t) => t.locale === l.code),
      )
      .map((l) => ({
        locale: l.code,
        path: LanguagesService.localize(l.code, page.path),
      }));
  }
}
