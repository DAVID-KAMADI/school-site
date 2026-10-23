import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { AuditService } from '../../audit/audit.service.js';
import { can, type AuthUser } from '../../identity/auth-user.js';
import {
  BlockValidationError,
  collectMediaRefs,
  validateBlocks,
} from '../blocks/block-schemas.js';
import { ContentCacheService } from '../content-cache.service.js';
import { PageRevision } from '../entities/page-revision.entity.js';
import {
  PageTranslation,
  type TranslatedBlock,
  type TranslationSnapshot,
} from '../entities/page-translation.entity.js';
import { Page } from '../entities/page.entity.js';
import { MediaService } from '../media/media.service.js';
import { LanguagesService } from '../site/languages.service.js';
import { PagesService } from './pages.service.js';

export interface TranslationInput {
  title: string;
  seoTitle?: string | null;
  metaDescription?: string | null;
  blocks: { type: string; isHidden?: boolean; content: unknown }[];
}

/**
 * Pages in other languages. A translation starts as a copy of the English blocks, is saved as
 * a draft, and goes live when published. It uses the same permissions as its English page.
 */
@Injectable()
export class PageTranslationsService {
  constructor(
    @InjectRepository(Page) private readonly pages: Repository<Page>,
    @InjectRepository(PageTranslation)
    private readonly translations: Repository<PageTranslation>,
    @InjectRepository(PageRevision)
    private readonly revisions: Repository<PageRevision>,
    private readonly pagesService: PagesService,
    private readonly languages: LanguagesService,
    private readonly media: MediaService,
    private readonly audit: AuditService,
    private readonly cache: ContentCacheService,
  ) {}

  /** Every enabled language and how far this page's translation into it has got. */
  async list(id: number, user: AuthUser) {
    await this.pageFor(id, user, 'pages.edit');
    const [langs, rows, latest] = await Promise.all([
      this.languages.list(),
      this.translations.find({ where: { page: { id } } }),
      this.latestRevision(id),
    ]);
    return langs
      .filter((l) => l.code !== 'en')
      .map((l) => {
        const t = rows.find((r) => r.locale === l.code);
        return {
          locale: l.code,
          name: l.name,
          exists: !!t,
          ...(t ? this.status(t, latest) : this.status(null, latest)),
        };
      });
  }

  /** The translation draft, or a fresh copy of the English content when none exists yet. */
  async detail(id: number, locale: string, user: AuthUser) {
    const lang = await this.languages.requireTranslation(locale);
    const page = await this.pageFor(id, user, 'pages.edit');
    const t = await this.translations.findOne({
      where: { page: { id }, locale },
    });
    const latest = await this.latestRevision(id);
    const source = t
      ? {
          title: t.title,
          seoTitle: t.seoTitle,
          metaDescription: t.metaDescription,
          blocks: t.blocks,
        }
      : {
          title: page.title,
          seoTitle: page.seoTitle,
          metaDescription: page.metaDescription,
          blocks: page.blocks.map((b) => ({
            type: b.type,
            isHidden: b.isHidden,
            content: b.content,
          })),
        };
    const media = await this.media.getMany(
      source.blocks.flatMap((b) =>
        collectMediaRefs(b.content).map((r) => r.mediaId),
      ),
    );
    return {
      locale,
      name: lang.name,
      exists: !!t,
      ...this.status(t, latest),
      ...source,
      path: LanguagesService.localize(locale, page.path),
      media: Object.fromEntries(media),
      canPublish: can(
        user,
        'pages.publish',
        await this.pagesService.lineage(id),
      ),
    };
  }

  /** Saves the translation draft. Visitors keep seeing the published translation until it is published again. */
  async save(
    id: number,
    locale: string,
    input: TranslationInput,
    user: AuthUser,
  ) {
    await this.languages.requireTranslation(locale);
    await this.pageFor(id, user, 'pages.edit');
    let blocks: TranslatedBlock[];
    try {
      blocks = validateBlocks(input.blocks);
    } catch (err) {
      if (err instanceof BlockValidationError)
        throw new UnprocessableEntityException({
          message: err.message,
          code: 'INVALID_BLOCKS',
          issues: err.issues,
        });
      throw err;
    }
    const refs = blocks.flatMap((b, i) =>
      collectMediaRefs(b.content, `blocks.${i}.content`),
    );
    const missing = await this.media.missing(refs.map((r) => r.mediaId));
    if (missing.length)
      throw new UnprocessableEntityException({
        message: `Media not found: ${missing.join(', ')}`,
        code: 'MEDIA_MISSING',
      });

    const t =
      (await this.translations.findOne({ where: { page: { id }, locale } })) ??
      this.translations.create({
        page: { id },
        locale,
        published: null,
        publishedAt: null,
      });
    Object.assign(t, {
      title: input.title.trim(),
      seoTitle: input.seoTitle?.trim() || null,
      metaDescription: input.metaDescription?.trim() || null,
      blocks,
      sourceRevision: await this.latestRevision(id),
      updatedBy: { id: user.id },
    });
    await this.translations.save(t);
    await this.media.setUsages('page_translation', `${id}:${locale}`, refs);
    await this.audit.record({
      action: 'page.translation.save',
      userId: user.id,
      entityType: 'page',
      entityId: id,
      details: { locale },
    });
    return this.detail(id, locale, user);
  }

  async publish(id: number, locale: string, user: AuthUser) {
    await this.languages.requireTranslation(locale);
    const page = await this.pageFor(id, user, 'pages.publish');
    const t = await this.translations.findOne({
      where: { page: { id }, locale },
    });
    if (!t)
      throw new BadRequestException('Save the translation before publishing.');
    const ids = t.blocks.flatMap((b) =>
      collectMediaRefs(b.content).map((r) => r.mediaId),
    );
    if ((await this.media.missing(ids)).length)
      throw new UnprocessableEntityException({
        message:
          'Some images or files in this translation were deleted. Replace them before publishing.',
        code: 'MEDIA_MISSING',
      });
    const published: TranslationSnapshot = {
      title: t.title,
      seoTitle: t.seoTitle,
      metaDescription: t.metaDescription,
      blocks: t.blocks,
    };
    Object.assign(t, {
      published,
      publishedAt: new Date(),
      updatedBy: { id: user.id },
    });
    await this.translations.save(t);
    this.cache.invalidate();
    await this.audit.record({
      action: 'page.translation.publish',
      userId: user.id,
      entityType: 'page',
      entityId: id,
      details: { locale },
    });
    const warnings = page.publishedRevision
      ? []
      : [
          'The English page is not published, so visitors cannot see this translation yet.',
        ];
    return { warnings, translation: await this.detail(id, locale, user) };
  }

  async unpublish(id: number, locale: string, user: AuthUser) {
    await this.pageFor(id, user, 'pages.publish');
    await this.translations.update(
      { page: { id }, locale },
      { published: null, publishedAt: null, updatedBy: { id: user.id } },
    );
    this.cache.invalidate();
    await this.audit.record({
      action: 'page.translation.unpublish',
      userId: user.id,
      entityType: 'page',
      entityId: id,
      details: { locale },
    });
    return this.detail(id, locale, user);
  }

  /** Deletes a translation; visitors to that language see the English page again. */
  async remove(id: number, locale: string, user: AuthUser) {
    await this.pageFor(id, user, 'pages.delete');
    await this.translations.delete({ page: { id }, locale });
    await this.media.setUsages('page_translation', `${id}:${locale}`, []);
    this.cache.invalidate();
    await this.audit.record({
      action: 'page.translation.delete',
      userId: user.id,
      entityType: 'page',
      entityId: id,
      details: { locale },
    });
  }

  private status(t: PageTranslation | null, latestEnglish: number) {
    if (!t)
      return {
        isLive: false,
        hasUnpublishedChanges: false,
        englishChanged: false,
        updatedAt: null,
        publishedAt: null,
      };
    const draft = JSON.stringify([
      t.title,
      t.seoTitle,
      t.metaDescription,
      t.blocks,
    ]);
    const live = t.published
      ? JSON.stringify([
          t.published.title,
          t.published.seoTitle,
          t.published.metaDescription,
          t.published.blocks,
        ])
      : null;
    return {
      isLive: !!t.published,
      hasUnpublishedChanges: live !== null && live !== draft,
      /** The English page was saved again after this translation was last saved. */
      englishChanged:
        t.sourceRevision !== null && latestEnglish > t.sourceRevision,
      updatedAt: t.updatedAt,
      publishedAt: t.publishedAt,
    };
  }

  private async latestRevision(pageId: number): Promise<number> {
    const latest = await this.revisions.findOne({
      where: { page: { id: pageId } },
      order: { revisionNumber: 'DESC' },
      select: { id: true, revisionNumber: true },
    });
    return latest?.revisionNumber ?? 0;
  }

  private async pageFor(id: number, user: AuthUser, permission: string) {
    const page = await this.pages.findOne({
      where: { id },
      relations: { blocks: true, publishedRevision: true },
      order: { blocks: { sortOrder: 'ASC' } },
    });
    if (!page) throw new NotFoundException('Page not found.');
    if (!can(user, permission, await this.pagesService.lineage(id)))
      throw new ForbiddenException(
        'You do not have permission to do this on this page.',
      );
    return page;
  }
}
