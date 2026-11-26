import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Not, type Repository } from 'typeorm';
import { z } from 'zod';
import { Media } from '../cms/entities/media.entity.js';
import { SiteSetting } from '../cms/entities/site-setting.entity.js';
import { MediaService, type MediaView } from '../cms/media/media.service.js';
import { isValidSlug, slugify } from '../cms/pages/page-paths.js';
import {
  readPageIntro,
  savePageIntro,
  type PageIntro,
} from '../cms/site/page-intro.js';
import { DownloadCategory } from './entities/download-category.entity.js';
import { Download } from './entities/download.entity.js';

const PAGE_KEY = 'downloads.page';
const PAGE_DEFAULT: PageIntro = {
  eyebrow: 'Documents',
  title: 'Downloads',
  intro: 'Tenders, job vacancies, forms and publications from the institute.',
};

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .default(null)
    .transform((v) => v || null);

export const categorySchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .max(90)
    .default('')
    .refine(
      (v) => v === '' || isValidSlug(v),
      'The web address may only use lower-case letters, numbers and dashes.',
    ),
  description: optionalText(300),
});

export const downloadSchema = z.object({
  categoryId: z.number().int().positive(),
  title: z.string().trim().min(3).max(200),
  reference: optionalText(80),
  summary: optionalText(1000),
  mediaId: z.number({ error: 'Upload or choose the file.' }).int().positive(),
  publishedOn: z
    .union([z.iso.date(), z.literal(''), z.null()])
    .default(null)
    .transform((v) => v || new Date().toISOString().slice(0, 10)),
  closesAt: z
    .union([z.iso.datetime({ offset: true }), z.literal(''), z.null()])
    .default(null)
    .transform((v) => (v ? new Date(v) : null)),
  isPublished: z.boolean().default(true),
  isPinned: z.boolean().default(false),
});

const orderSchema = z.object({
  ids: z.array(z.number().int().positive()).max(200),
});

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success)
    throw new BadRequestException({
      message: r.error.issues.map((i) => i.message).join(' '),
      issues: r.error.issues,
    });
  return r.data;
}

/** What visitors need to know about the file before downloading it. */
export interface DownloadFile {
  url: string;
  /** A tidy file name for the browser to save it as, e.g. "supply-of-lab-equipment.pdf". */
  saveAs: string;
  /** "PDF", "Word", "Excel", "PowerPoint" or "Image". */
  type: string;
  sizeBytes: number;
}

export interface PublicDownload {
  id: number;
  categoryId: number;
  title: string;
  reference: string | null;
  summary: string | null;
  publishedOn: string;
  closesAt: Date | null;
  isClosed: boolean;
  isPinned: boolean;
  file: DownloadFile;
}

const TYPE_NAMES: Record<string, string> = {
  pdf: 'PDF',
  docx: 'Word',
  xlsx: 'Excel',
  pptx: 'PowerPoint',
};

export function fileOf(title: string, m: MediaView): DownloadFile {
  const ext = (m.url.split('.').pop() ?? '').toLowerCase();
  return {
    url: m.url,
    saveAs: `${slugify(title).slice(0, 80) || 'document'}.${ext}`,
    type: TYPE_NAMES[ext] ?? (m.kind === 'image' ? 'Image' : ext.toUpperCase()),
    sizeBytes: m.sizeBytes,
  };
}

/** Pinned first, then newest. */
const ORDER = {
  isPinned: 'DESC',
  publishedOn: 'DESC',
  id: 'DESC',
} as const;

/** Tenders, job adverts, forms and other documents for the website's Downloads page. */
@Injectable()
export class DownloadsService {
  constructor(
    @InjectRepository(DownloadCategory)
    private readonly categories: Repository<DownloadCategory>,
    @InjectRepository(Download)
    private readonly downloads: Repository<Download>,
    @InjectRepository(Media) private readonly media: Repository<Media>,
    @InjectRepository(SiteSetting)
    private readonly settings: Repository<SiteSetting>,
    private readonly mediaService: MediaService,
    private readonly dataSource: DataSource,
  ) {}

  // ---------- Admin ----------

  async listAdmin() {
    const [categories, items] = await Promise.all([
      this.categories.find({ order: { sortOrder: 'ASC', id: 'ASC' } }),
      this.downloads.find({ order: ORDER }),
    ]);
    const files = await this.mediaService.getMany(items.map((d) => d.mediaId));
    const now = Date.now();
    return {
      page: await readPageIntro(this.settings, PAGE_KEY, PAGE_DEFAULT),
      categories,
      items: items.map((d) => ({
        ...d,
        isClosed: !!d.closesAt && d.closesAt.getTime() <= now,
        file: files.get(d.mediaId) ?? null,
      })),
    };
  }

  async saveCategory(id: number | null, body: unknown) {
    const data = parse(categorySchema, body);
    if (id && !(await this.categories.exists({ where: { id } })))
      throw new NotFoundException('Category not found.');
    const slug = data.slug || slugify(data.name).slice(0, 90) || `documents-${Date.now()}`;
    const clash = await this.categories.findOne({
      where: { slug, ...(id ? { id: Not(id) } : {}) },
    });
    if (clash)
      throw new ConflictException(
        `"${clash.name}" already uses the address /downloads/${slug}. Choose another name or web address.`,
      );
    if (id) return this.categories.save({ id, ...data, slug });
    const last = await this.categories.findOne({
      where: {},
      order: { sortOrder: 'DESC' },
    });
    return this.categories.save({
      ...data,
      slug,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    });
  }

  async removeCategory(id: number) {
    const category = await this.categories.findOneBy({ id });
    if (!category) throw new NotFoundException('Category not found.');
    const count = await this.downloads.countBy({ categoryId: id });
    if (count)
      throw new ConflictException(
        `"${category.name}" still has ${count} ${count === 1 ? 'document' : 'documents'}. Move or delete them first.`,
      );
    await this.categories.remove(category);
    return { name: category.name };
  }

  async orderCategories(body: unknown) {
    const { ids } = parse(orderSchema, body);
    await this.dataSource.transaction(async (em) => {
      for (const [i, id] of ids.entries())
        await em.update(DownloadCategory, { id }, { sortOrder: i });
    });
    return { ok: true };
  }

  async save(id: number | null, body: unknown) {
    const data = parse(downloadSchema, body);
    if (id && !(await this.downloads.exists({ where: { id } })))
      throw new NotFoundException('Document not found.');
    if (!(await this.categories.exists({ where: { id: data.categoryId } })))
      throw new BadRequestException('Choose a category for this document.');
    const file = await this.media.findOne({
      where: { id: data.mediaId, deletedAt: IsNull() },
      select: { id: true, mimeType: true },
    });
    if (!file || file.mimeType.startsWith('video/'))
      throw new BadRequestException(
        'The file is no longer in the media library. Upload it again.',
      );
    const saved = await this.downloads.save({
      ...(id ? { id } : {}),
      ...data,
      category: { id: data.categoryId },
    });
    // So the media library warns before a file used here is deleted.
    await this.mediaService.setUsages('download', String(saved.id), [
      { mediaId: data.mediaId, fieldPath: 'file' },
    ]);
    return saved;
  }

  async remove(id: number) {
    const item = await this.downloads.findOneBy({ id });
    if (!item) throw new NotFoundException('Document not found.');
    await this.downloads.remove(item);
    await this.mediaService.setUsages('download', String(id), []);
    return { title: item.title };
  }

  savePage(body: unknown, userId: number) {
    return savePageIntro(
      this.settings,
      PAGE_KEY,
      'Heading and introduction of the Downloads page (/downloads).',
      body,
      userId,
    );
  }

  // ---------- Website ----------

  /** The Downloads page: every category (with how many documents it has) and every published document. */
  async publicIndex() {
    const [categories, items] = await Promise.all([
      this.categories.find({ order: { sortOrder: 'ASC', id: 'ASC' } }),
      this.downloads.find({ where: { isPublished: true }, order: ORDER }),
    ]);
    const files = await this.mediaService.getMany(items.map((d) => d.mediaId));
    const now = Date.now();
    const shown: PublicDownload[] = items.flatMap((d) => {
      // Files removed from the media library are left out.
      const m = files.get(d.mediaId);
      if (!m || m.kind === 'video') return [];
      return [
        {
          id: d.id,
          categoryId: d.categoryId,
          title: d.title,
          reference: d.reference,
          summary: d.summary,
          publishedOn: d.publishedOn,
          closesAt: d.closesAt,
          isClosed: !!d.closesAt && d.closesAt.getTime() <= now,
          isPinned: d.isPinned,
          file: fileOf(d.title, m),
        },
      ];
    });
    return {
      page: await readPageIntro(this.settings, PAGE_KEY, PAGE_DEFAULT),
      categories: categories.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        description: c.description,
        count: shown.filter((d) => d.categoryId === c.id).length,
      })),
      items: shown,
    };
  }
}
