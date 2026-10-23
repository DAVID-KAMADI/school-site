import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  In,
  IsNull,
  LessThanOrEqual,
  Not,
  type EntityManager,
  type Repository,
} from 'typeorm';
import { AuditService } from '../../audit/audit.service.js';
import { withDeadlockRetry } from '../../database/retry.js';
import { can, type AuthUser } from '../../identity/auth-user.js';
import {
  BlockValidationError,
  collectMediaRefs,
  validateBlocks,
  type ValidBlock,
} from '../blocks/block-schemas.js';
import { htmlToText } from '../blocks/rich-text.js';
import { ContentCacheService } from '../content-cache.service.js';
import { PageBlock } from '../entities/page-block.entity.js';
import {
  PageRevision,
  type PageSnapshot,
} from '../entities/page-revision.entity.js';
import {
  Page,
  PageStatus,
  PageTemplate,
  PageVisibility,
} from '../entities/page.entity.js';
import { PageTranslation } from '../entities/page-translation.entity.js';
import { Redirect } from '../entities/redirect.entity.js';
import { MediaService } from '../media/media.service.js';
import { LanguagesService } from '../site/languages.service.js';
import {
  RESERVED_TOP_LEVEL_SLUGS,
  isValidSlug,
  joinPath,
  originalPath,
  slugify,
  trashedPath,
} from './page-paths.js';

const LOCK_MINUTES = 2;
const TRASH_DAYS = 30;

export interface ContentInput {
  title: string;
  template?: PageTemplate;
  seoTitle?: string | null;
  metaDescription?: string | null;
  socialImageId?: number | null;
  blocks: { type: string; isHidden?: boolean; content: unknown }[];
  note?: string;
}

export interface SettingsInput {
  slug?: string;
  parentId?: number | null;
  visibility?: PageVisibility;
  publishAt?: Date | null;
  unpublishAt?: Date | null;
}

@Injectable()
export class PagesService {
  constructor(
    @InjectRepository(Page) private readonly pages: Repository<Page>,
    @InjectRepository(PageRevision)
    private readonly revisions: Repository<PageRevision>,
    @InjectRepository(Redirect)
    private readonly redirects: Repository<Redirect>,
    @InjectRepository(PageTranslation)
    private readonly translations: Repository<PageTranslation>,
    private readonly media: MediaService,
    private readonly languages: LanguagesService,
    private readonly audit: AuditService,
    private readonly cache: ContentCacheService,
    private readonly dataSource: DataSource,
  ) {}

  // ---------- Reading ----------

  /** All pages (not in trash) as a flat list the admin UI turns into a tree. */
  async tree(user: AuthUser) {
    const rows = await this.pages.find({
      relations: { parent: true, publishedRevision: true },
      order: { path: 'ASC' },
    });
    const latest = await this.latestRevisionIds(rows.map((p) => p.id));
    const lineage = this.lineageIndex(rows);
    return rows.map((p) => ({
      id: p.id,
      title: p.title,
      path: p.path,
      parentId: p.parent?.id ?? null,
      status: p.status,
      visibility: p.visibility,
      isLive: p.publishedRevision !== null,
      hasUnpublishedChanges:
        p.publishedRevision !== null &&
        latest.get(p.id) !== p.publishedRevision.id,
      publishAt: p.publishAt,
      unpublishAt: p.unpublishAt,
      updatedAt: p.updatedAt,
      canEdit: can(user, 'pages.edit', lineage(p.id)),
    }));
  }

  async detail(id: number, user: AuthUser) {
    const page = await this.pages.findOne({
      where: { id },
      relations: {
        parent: true,
        publishedRevision: true,
        socialImage: true,
        lockedBy: true,
        blocks: true,
      },
      order: { blocks: { sortOrder: 'ASC' } },
    });
    if (!page) throw new NotFoundException('Page not found.');
    const lineage = await this.lineage(id);
    if (!can(user, 'pages.edit', lineage))
      throw new ForbiddenException('You cannot edit this page.');

    const latest = await this.revisions.findOne({
      where: { page: { id } },
      order: { revisionNumber: 'DESC' },
    });
    const mediaIds = page.blocks.flatMap((b) =>
      collectMediaRefs(b.content).map((r) => r.mediaId),
    );
    if (page.socialImage) mediaIds.push(page.socialImage.id);
    const media = await this.media.getMany(mediaIds);
    const lockActive =
      page.lockedBy &&
      page.lockedAt &&
      Date.now() - page.lockedAt.getTime() < LOCK_MINUTES * 60_000;

    return {
      id: page.id,
      title: page.title,
      slug: page.slug,
      path: page.path,
      parentId: page.parent?.id ?? null,
      template: page.template,
      status: page.status,
      visibility: page.visibility,
      seoTitle: page.seoTitle,
      metaDescription: page.metaDescription,
      socialImageId: page.socialImage?.id ?? null,
      publishAt: page.publishAt,
      unpublishAt: page.unpublishAt,
      isHome: page.path === '/',
      isLive: page.publishedRevision !== null,
      latestRevision: latest?.revisionNumber ?? 0,
      publishedRevision: page.publishedRevision?.revisionNumber ?? null,
      hasUnpublishedChanges:
        page.publishedRevision !== null &&
        latest?.id !== page.publishedRevision.id,
      lockedBy:
        lockActive && page.lockedBy!.id !== user.id
          ? {
              id: page.lockedBy!.id,
              name: page.lockedBy!.fullName,
              since: page.lockedAt,
            }
          : null,
      blocks: page.blocks.map((b) => ({
        id: b.id,
        type: b.type,
        isHidden: b.isHidden,
        content: b.content,
      })),
      media: Object.fromEntries(media),
      canPublish: can(user, 'pages.publish', lineage),
      canDelete: can(user, 'pages.delete', lineage),
      updatedAt: page.updatedAt,
    };
  }

  // ---------- Creating and editing ----------

  async create(
    input: {
      title: string;
      slug?: string;
      parentId?: number | null;
      template?: PageTemplate;
      visibility?: PageVisibility;
    },
    user: AuthUser,
  ) {
    const parent = input.parentId
      ? await this.pages.findOneBy({ id: input.parentId })
      : null;
    if (input.parentId && !parent)
      throw new BadRequestException('Parent page not found.');
    if (
      !can(user, 'pages.create', parent ? await this.lineage(parent.id) : [])
    ) {
      throw new ForbiddenException(
        parent
          ? 'You cannot create pages in this section.'
          : 'You cannot create top-level pages.',
      );
    }

    const slug = await this.uniqueSlug(
      input.slug ? input.slug : slugify(input.title),
      parent,
      !!input.slug,
    );
    const page = await this.tx(async (em) => {
      const created = await em.save(
        em.create(Page, {
          title: input.title.trim(),
          slug,
          path: joinPath(parent?.path ?? null, slug),
          parent,
          template: input.template ?? PageTemplate.Standard,
          visibility: input.visibility ?? PageVisibility.Public,
          status: PageStatus.Draft,
          createdBy: { id: user.id },
          updatedBy: { id: user.id },
        }),
      );
      await this.writeRevision(em, created, [], user.id, 'Page created');
      return created;
    });
    await this.audit.record({
      action: 'page.create',
      userId: user.id,
      entityType: 'page',
      entityId: page.id,
      details: { path: page.path },
    });
    return this.detail(page.id, user);
  }

  /** Saves the editable content (title, SEO fields and blocks) as a new draft revision. Live content is unaffected until publish. */
  async saveContent(id: number, input: ContentInput, user: AuthUser) {
    const page = await this.editablePage(id, user, 'pages.edit');
    let blocks: ValidBlock[];
    try {
      blocks = validateBlocks(input.blocks);
    } catch (err) {
      if (err instanceof BlockValidationError) {
        throw new UnprocessableEntityException({
          message: err.message,
          code: 'INVALID_BLOCKS',
          issues: err.issues,
        });
      }
      throw err;
    }
    const refs = blocks.flatMap((b, i) =>
      collectMediaRefs(b.content, `blocks.${i}.content`),
    );
    if (input.socialImageId)
      refs.push({ mediaId: input.socialImageId, fieldPath: 'socialImage' });
    const missing = await this.media.missing(refs.map((r) => r.mediaId));
    if (missing.length)
      throw new UnprocessableEntityException({
        message: `Media not found: ${missing.join(', ')}`,
        code: 'MEDIA_MISSING',
      });

    await this.tx(async (em) => {
      await em.update(Page, id, {
        title: input.title.trim(),
        template: input.template ?? page.template,
        seoTitle: input.seoTitle?.trim() || null,
        metaDescription: input.metaDescription?.trim() || null,
        socialImage: input.socialImageId ? { id: input.socialImageId } : null,
        status:
          page.status === PageStatus.Archived
            ? PageStatus.Archived
            : PageStatus.Draft,
        updatedBy: { id: user.id },
        lockedBy: { id: user.id },
        lockedAt: new Date(),
      });
      await em.delete(PageBlock, { page: { id } });
      for (const [i, b] of blocks.entries()) {
        await em.save(
          em.create(PageBlock, {
            page: { id },
            type: b.type,
            sortOrder: i,
            isHidden: b.isHidden,
            content: b.content,
          }),
        );
      }
      const fresh = await em.findOneByOrFail(Page, { id });
      await this.writeRevision(
        em,
        fresh,
        blocks,
        user.id,
        input.note ?? null,
        input.socialImageId ?? null,
      );
    });
    await this.media.setUsages('page', String(id), refs);
    await this.audit.record({
      action: 'page.save',
      userId: user.id,
      entityType: 'page',
      entityId: id,
    });
    return this.detail(id, user);
  }

  /** Structural settings: URL, parent, visibility and schedule. */
  async updateSettings(id: number, input: SettingsInput, user: AuthUser) {
    const page = await this.editablePage(id, user, 'pages.edit');
    const lineage = await this.lineage(id);
    const scheduling =
      input.publishAt !== undefined || input.unpublishAt !== undefined;
    if (scheduling && !can(user, 'pages.publish', lineage))
      throw new ForbiddenException('Only publishers can schedule pages.');

    const moving =
      input.parentId !== undefined &&
      input.parentId !== (page.parent?.id ?? null);
    const renaming = input.slug !== undefined && input.slug !== page.slug;
    if ((moving || renaming) && page.path === '/')
      throw new BadRequestException('The home page address cannot change.');

    let newParent = page.parent;
    if (moving) {
      newParent = input.parentId
        ? await this.pages.findOne({ where: { id: input.parentId } })
        : null;
      if (input.parentId && !newParent)
        throw new BadRequestException('Parent page not found.');
      if (newParent && (await this.lineage(newParent.id)).includes(id))
        throw new BadRequestException('A page cannot be moved inside itself.');
      if (
        !can(
          user,
          'pages.create',
          newParent ? await this.lineage(newParent.id) : [],
        )
      ) {
        throw new ForbiddenException(
          'You cannot move pages into that section.',
        );
      }
    }

    const languageCodes = await this.languageCodes();
    if (moving && !newParent && languageCodes.has(page.slug))
      throw new BadRequestException(
        `"${page.slug}" is a language code, so it cannot be a top-level address. Change the address first.`,
      );
    await this.tx(async (em) => {
      if (moving || renaming) {
        const slug = renaming
          ? this.checkSlug(input.slug!, newParent, languageCodes)
          : page.slug;
        const newPath = joinPath(newParent?.path ?? null, slug);
        if (
          newPath !== page.path &&
          (await em.exists(Page, {
            where: { path: newPath },
            withDeleted: true,
          }))
        ) {
          throw new ConflictException(`Another page already uses ${newPath}.`);
        }
        await this.movePaths(em, page, newPath);
        await em.update(Page, id, {
          slug,
          parent: newParent ? { id: newParent.id } : null,
        });
      }
      await em.update(Page, id, {
        ...(input.visibility ? { visibility: input.visibility } : {}),
        ...(input.publishAt !== undefined
          ? { publishAt: input.publishAt }
          : {}),
        ...(input.unpublishAt !== undefined
          ? { unpublishAt: input.unpublishAt }
          : {}),
        updatedBy: { id: user.id },
      });
    });
    this.cache.invalidate();
    await this.audit.record({
      action: 'page.settings',
      userId: user.id,
      entityType: 'page',
      entityId: id,
      details: { ...input },
    });
    return this.detail(id, user);
  }

  /** Rewrites the path of a page and all its descendants, adding redirects for live pages. */
  private async movePaths(em: EntityManager, page: Page, newPath: string) {
    const oldPath = page.path;
    const subtree = await em
      .createQueryBuilder(Page, 'p')
      .leftJoinAndSelect('p.publishedRevision', 'r')
      .where('p.path = :old OR p.path LIKE :prefix', {
        old: oldPath,
        prefix: `${oldPath.replace(/[%_]/g, '\\$&')}/%`,
      })
      .getMany();
    for (const p of subtree) {
      const updated = newPath + p.path.slice(oldPath.length);
      if (updated.length > 500)
        throw new BadRequestException('The resulting address is too long.');
      await em.update(Page, p.id, { path: updated });
      await em.delete(Redirect, { fromPath: updated });
      if (p.publishedRevision) await this.addRedirect(em, p.path, updated);
    }
  }

  private async addRedirect(
    em: EntityManager,
    fromPath: string,
    toPath: string,
  ) {
    if (fromPath === toPath || fromPath.length > 191) return;
    await em.update(Redirect, { toPath: fromPath }, { toPath });
    await em.upsert(Redirect, { fromPath, toPath, statusCode: 301 }, [
      'fromPath',
    ]);
  }

  // ---------- Workflow ----------

  async submitForReview(id: number, user: AuthUser) {
    await this.editablePage(id, user, 'pages.edit');
    await this.pages.update(id, {
      status: PageStatus.InReview,
      updatedBy: { id: user.id },
    });
    await this.audit.record({
      action: 'page.submit',
      userId: user.id,
      entityType: 'page',
      entityId: id,
    });
    return this.detail(id, user);
  }

  /** Makes the latest revision live. Returns warnings (missing alt text, empty page) that do not block publishing. */
  async publish(id: number, user: AuthUser | null) {
    const page = user
      ? await this.editablePage(id, user, 'pages.publish')
      : await this.pages.findOneByOrFail({ id });
    const latest = await this.revisions.findOne({
      where: { page: { id } },
      order: { revisionNumber: 'DESC' },
    });
    if (!latest)
      throw new BadRequestException('This page has no content to publish.');

    const refs = latest.snapshot.blocks.flatMap((b) =>
      collectMediaRefs(b.content).map((r) => r.mediaId),
    );
    if (latest.snapshot.socialImageId) refs.push(latest.snapshot.socialImageId);
    const missing = await this.media.missing(refs);
    if (missing.length) {
      throw new UnprocessableEntityException({
        message:
          'Some images or files on this page were deleted. Replace them before publishing.',
        code: 'MEDIA_MISSING',
        mediaIds: missing,
      });
    }

    const warnings: string[] = [];
    const noAlt = await this.media.missingAltText(refs);
    if (noAlt.length)
      warnings.push(`${noAlt.length} image(s) have no alt text.`);
    const visible = latest.snapshot.blocks.filter((b) => !b.isHidden);
    if (!visible.length) warnings.push('The page has no visible content.');
    if (!latest.snapshot.metaDescription)
      warnings.push(
        'No meta description: search engines will pick their own summary.',
      );
    for (const b of visible) {
      if (
        b.type === 'rich_text' &&
        !htmlToText(typeof b.content.html === 'string' ? b.content.html : '')
      )
        warnings.push('A text block is empty.');
    }

    await this.pages.update(id, {
      publishedRevision: { id: latest.id },
      status: PageStatus.Published,
      publishAt:
        page.publishAt && page.publishAt.getTime() <= Date.now()
          ? null
          : page.publishAt,
      updatedBy: user ? { id: user.id } : undefined,
    });
    this.cache.invalidate();
    await this.audit.record({
      action: 'page.publish',
      userId: user?.id ?? null,
      entityType: 'page',
      entityId: id,
      details: { revision: latest.revisionNumber, warnings },
    });
    return { warnings, page: user ? await this.detail(id, user) : null };
  }

  async unpublish(id: number, user: AuthUser | null) {
    if (user) await this.editablePage(id, user, 'pages.publish');
    await this.pages.update(id, {
      publishedRevision: null,
      status: PageStatus.Draft,
      unpublishAt: null,
    });
    this.cache.invalidate();
    await this.audit.record({
      action: 'page.unpublish',
      userId: user?.id ?? null,
      entityType: 'page',
      entityId: id,
    });
    return user ? this.detail(id, user) : null;
  }

  // ---------- Revisions ----------

  async listRevisions(id: number, user: AuthUser) {
    const page = await this.editablePage(id, user, 'pages.edit');
    const rows = await this.revisions.find({
      where: { page: { id } },
      relations: { createdBy: true },
      order: { revisionNumber: 'DESC' },
      take: 200,
    });
    const publishedId = (
      await this.pages.findOne({
        where: { id: page.id },
        relations: { publishedRevision: true },
      })
    )?.publishedRevision?.id;
    return rows.map((r) => ({
      id: r.id,
      revisionNumber: r.revisionNumber,
      note: r.note,
      createdBy: r.createdBy?.fullName ?? null,
      createdAt: r.createdAt,
      isPublished: r.id === publishedId,
      blockCount: r.snapshot.blocks.length,
    }));
  }

  async getRevision(id: number, revisionId: number, user: AuthUser) {
    await this.editablePage(id, user, 'pages.edit');
    const rev = await this.revisions.findOne({
      where: { id: revisionId, page: { id } },
    });
    if (!rev) throw new NotFoundException('Revision not found.');
    return rev;
  }

  /** Copies an old revision back into the draft (as a new revision). Publish to make it live. */
  async restoreRevision(id: number, revisionId: number, user: AuthUser) {
    const rev = await this.getRevision(id, revisionId, user);
    const s = rev.snapshot;
    return this.saveContent(
      id,
      {
        title: s.title,
        template: s.template as PageTemplate,
        seoTitle: s.seoTitle,
        metaDescription: s.metaDescription,
        socialImageId: s.socialImageId,
        blocks: s.blocks,
        note: `Restored revision ${rev.revisionNumber}`,
      },
      user,
    );
  }

  // ---------- Copy, lock, trash ----------

  async duplicate(id: number, user: AuthUser) {
    const source = await this.pages.findOne({
      where: { id },
      relations: { parent: true, blocks: true, socialImage: true },
      order: { blocks: { sortOrder: 'ASC' } },
    });
    if (!source) throw new NotFoundException('Page not found.');
    const copy = await this.create(
      {
        title: `${source.title} (copy)`,
        parentId: source.parent?.id ?? null,
        template: source.template,
        visibility: source.visibility,
      },
      user,
    );
    return this.saveContent(
      copy.id,
      {
        title: copy.title,
        template: source.template,
        seoTitle: source.seoTitle,
        metaDescription: source.metaDescription,
        socialImageId: source.socialImage?.id ?? null,
        blocks: source.blocks.map((b) => ({
          type: b.type,
          isHidden: b.isHidden,
          content: b.content,
        })),
        note: `Copied from ${source.path}`,
      },
      user,
    );
  }

  /** Marks the page as being edited (call every minute while the editor is open). */
  async lock(id: number, user: AuthUser) {
    const page = await this.pages.findOne({
      where: { id },
      relations: { lockedBy: true },
    });
    if (!page) throw new NotFoundException('Page not found.');
    const heldByOther =
      page.lockedBy &&
      page.lockedBy.id !== user.id &&
      page.lockedAt &&
      Date.now() - page.lockedAt.getTime() < LOCK_MINUTES * 60_000;
    if (heldByOther)
      return {
        locked: false,
        lockedBy: {
          id: page.lockedBy!.id,
          name: page.lockedBy!.fullName,
          since: page.lockedAt,
        },
      };
    await this.pages.update(id, {
      lockedBy: { id: user.id },
      lockedAt: new Date(),
    });
    return { locked: true, lockedBy: null };
  }

  async unlock(id: number, user: AuthUser) {
    await this.pages.update(
      { id, lockedBy: { id: user.id } },
      { lockedBy: null, lockedAt: null },
    );
  }

  async trash(id: number, user: AuthUser) {
    const page = await this.editablePage(id, user, 'pages.delete');
    if (page.path === '/')
      throw new BadRequestException('The home page cannot be deleted.');
    if (await this.pages.exists({ where: { parent: { id } } })) {
      throw new ConflictException(
        'Move or delete the pages inside this page first.',
      );
    }
    await this.tx(async (em) => {
      if (page.publishedRevision)
        await this.addRedirect(em, page.path, page.parent?.path ?? '/');
      await em.update(Page, id, {
        path: trashedPath(page.path, id),
        publishedRevision: null,
        status: PageStatus.Draft,
      });
      await em.softDelete(Page, id);
    });
    await this.media.setUsages('page', String(id), []);
    for (const t of await this.translations.find({
      where: { page: { id } },
      select: { id: true, locale: true },
    }))
      await this.media.setUsages('page_translation', `${id}:${t.locale}`, []);
    this.cache.invalidate();
    await this.audit.record({
      action: 'page.trash',
      userId: user.id,
      entityType: 'page',
      entityId: id,
      details: { path: page.path },
    });
  }

  async listTrash() {
    const rows = await this.pages.find({
      where: { deletedAt: Not(IsNull()) },
      withDeleted: true,
      order: { deletedAt: 'DESC' },
    });
    return rows.map((p) => ({
      id: p.id,
      title: p.title,
      path: originalPath(p.path),
      deletedAt: p.deletedAt,
      purgeAfter: new Date(p.deletedAt!.getTime() + TRASH_DAYS * 86_400_000),
    }));
  }

  async restore(id: number, user: AuthUser) {
    const page = await this.pages.findOne({
      where: { id },
      withDeleted: true,
      relations: { parent: true },
    });
    if (!page?.deletedAt)
      throw new NotFoundException('Page is not in the trash.');
    if (page.parent?.deletedAt)
      throw new ConflictException('Restore the parent page first.');
    if (
      !can(
        user,
        'pages.delete',
        page.parent ? await this.lineage(page.parent.id) : [],
      )
    )
      throw new ForbiddenException('You cannot restore this page.');
    const path = originalPath(page.path);
    if (await this.pages.exists({ where: { path } }))
      throw new ConflictException(
        `Another page now uses ${path}. Rename it first.`,
      );
    await this.pages.restore(id);
    await this.pages.update(id, { path });
    await this.redirects.delete({ fromPath: path });
    await this.audit.record({
      action: 'page.restore',
      userId: user.id,
      entityType: 'page',
      entityId: id,
    });
    return this.detail(id, user);
  }

  // ---------- Scheduled jobs (called by PageScheduler) ----------

  async runSchedule(now = new Date()) {
    const due = await this.pages.find({
      where: { publishAt: LessThanOrEqual(now) },
    });
    for (const p of due) {
      await this.publish(p.id, null);
      await this.pages.update(p.id, { publishAt: null });
    }
    const expiring = await this.pages.find({
      where: {
        unpublishAt: LessThanOrEqual(now),
        publishedRevision: Not(IsNull()),
      },
    });
    for (const p of expiring) await this.unpublish(p.id, null);
    return { published: due.length, unpublished: expiring.length };
  }

  async purgeTrash(now = new Date()) {
    const cutoff = new Date(now.getTime() - TRASH_DAYS * 86_400_000);
    const old = await this.pages.find({
      where: { deletedAt: LessThanOrEqual(cutoff) },
      withDeleted: true,
      select: { id: true },
    });
    if (old.length) await this.pages.delete({ id: In(old.map((p) => p.id)) });
    return old.length;
  }

  // ---------- Helpers ----------

  /** Page id followed by its ancestors' ids, closest first. */
  async lineage(id: number): Promise<number[]> {
    const rows: { id: number; parent_id: number | null }[] =
      await this.dataSource.query(
        'SELECT id, parent_id FROM pages WHERE deleted_at IS NULL',
      );
    return this.lineageIndex(
      rows.map((r) => ({
        id: r.id,
        parent: r.parent_id ? { id: r.parent_id } : null,
      })),
    )(id);
  }

  private lineageIndex(rows: { id: number; parent: { id: number } | null }[]) {
    const parentOf = new Map(rows.map((r) => [r.id, r.parent?.id ?? null]));
    return (id: number) => {
      const chain: number[] = [];
      for (
        let cur: number | null | undefined = id;
        cur && chain.length < 50;
        cur = parentOf.get(cur)
      )
        chain.push(cur);
      return chain;
    };
  }

  private async editablePage(
    id: number,
    user: AuthUser,
    permission: string,
  ): Promise<Page> {
    const page = await this.pages.findOne({
      where: { id },
      relations: { parent: true, publishedRevision: true },
    });
    if (!page) throw new NotFoundException('Page not found.');
    if (!can(user, permission, await this.lineage(id)))
      throw new ForbiddenException(
        'You do not have permission to do this on this page.',
      );
    return page;
  }

  private checkSlug(
    slug: string,
    parent: Page | null,
    languageCodes: Set<string>,
  ): string {
    if (!isValidSlug(slug))
      throw new BadRequestException(
        'Use lowercase letters, numbers and single hyphens in the address (e.g. fees-and-funding).',
      );
    if (!parent && RESERVED_TOP_LEVEL_SLUGS.has(slug))
      throw new BadRequestException(
        `"${slug}" is reserved by the system. Choose another address.`,
      );
    if (!parent && languageCodes.has(slug))
      throw new BadRequestException(
        `"${slug}" is the code of a site language (/${slug} shows the site in that language). Choose another address.`,
      );
    return slug;
  }

  /** Codes of the enabled languages, which top-level pages may not use as their address. */
  private async languageCodes(): Promise<Set<string>> {
    return new Set((await this.languages.list()).map((l) => l.code));
  }

  /**
   * A free address based on `base`. An address typed by the editor must be allowed as is;
   * one made from the title just moves on to "-2" if the system or a language uses it.
   */
  private async uniqueSlug(
    base: string,
    parent: Page | null,
    typed = false,
  ): Promise<string> {
    const languageCodes = await this.languageCodes();
    const root = base || 'page';
    if (typed || !isValidSlug(root))
      this.checkSlug(root, parent, languageCodes);
    for (let n = 1; n < 100; n++) {
      const slug = n === 1 ? root : `${root}-${n}`;
      if (
        !parent &&
        (RESERVED_TOP_LEVEL_SLUGS.has(slug) || languageCodes.has(slug))
      )
        continue;
      if (
        !(await this.pages.exists({
          where: { path: joinPath(parent?.path ?? null, slug) },
          withDeleted: true,
        }))
      )
        return slug;
    }
    throw new ConflictException('Could not find a free address for this page.');
  }

  private async latestRevisionIds(
    pageIds: number[],
  ): Promise<Map<number, number>> {
    if (!pageIds.length) return new Map();
    const rows: { page_id: number; id: number }[] = await this.dataSource.query(
      `SELECT r.page_id, r.id FROM page_revisions r
         JOIN (SELECT page_id, MAX(revision_number) n FROM page_revisions GROUP BY page_id) m
           ON m.page_id = r.page_id AND m.n = r.revision_number`,
    );
    return new Map(rows.map((r) => [Number(r.page_id), Number(r.id)]));
  }

  private async writeRevision(
    em: EntityManager,
    page: Page,
    blocks: ValidBlock[],
    userId: number,
    note: string | null,
    socialImageId: number | null = null,
  ) {
    const { max } = (await em
      .createQueryBuilder(PageRevision, 'r')
      .select('MAX(r.revisionNumber)', 'max')
      .where('r.page_id = :id', { id: page.id })
      .getRawOne<{ max: number | null }>())!;
    const snapshot: PageSnapshot = {
      title: page.title,
      template: page.template,
      seoTitle: page.seoTitle,
      metaDescription: page.metaDescription,
      socialImageId,
      blocks: blocks.map((b) => ({
        type: b.type,
        isHidden: b.isHidden,
        content: b.content,
      })),
    };
    await em.save(
      em.create(PageRevision, {
        page: { id: page.id },
        revisionNumber: Number(max ?? 0) + 1,
        snapshot,
        note,
        createdBy: { id: userId },
      }),
    );
  }

  /** Transaction that is retried if MySQL reports a deadlock. */
  private tx<T>(work: (em: EntityManager) => Promise<T>): Promise<T> {
    return withDeadlockRetry(() => this.dataSource.transaction(work));
  }
}
