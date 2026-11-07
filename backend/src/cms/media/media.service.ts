import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import sharp from 'sharp';
import { DataSource, In, Like, type Repository } from 'typeorm';
import { ContentCacheService } from '../content-cache.service.js';
import { MediaUsage } from '../entities/media-usage.entity.js';
import { MediaVariant } from '../entities/media-variant.entity.js';
import { Media } from '../entities/media.entity.js';
import { MediaStorage } from './storage.js';

/** Responsive widths generated for every image (only those smaller than the original). */
/**
 * Responsive widths generated for every image (only those smaller than the original).
 * Close steps mean phones download a size near what they display, which matters on mobile data.
 */
export const VARIANT_WIDTHS = [320, 480, 640, 800, 1024, 1366, 1920];
const LARGEST_VARIANT = VARIANT_WIDTHS[VARIANT_WIDTHS.length - 1];

type VariantData = {
  width: number;
  height: number;
  format: string;
  data: Buffer;
};

/** Resized WebP copies of an image at each responsive width. */
async function buildVariants(
  base: ReturnType<typeof sharp>,
  originalWidth: number,
): Promise<VariantData[]> {
  const widths = VARIANT_WIDTHS.filter((w) => w < originalWidth).concat(
    originalWidth <= LARGEST_VARIANT ? [originalWidth] : [],
  );
  const out: VariantData[] = [];
  for (const width of widths) {
    const r = await base
      .clone()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: width >= 1024 ? 76 : 80 })
      .toBuffer({ resolveWithObject: true });
    out.push({
      width: r.info.width,
      height: r.info.height,
      format: 'webp',
      data: r.data,
    });
  }
  return out;
}
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 60_000_000;

const IMAGE_FORMATS: Record<string, { mime: string; ext: string }> = {
  jpeg: { mime: 'image/jpeg', ext: 'jpg' },
  png: { mime: 'image/png', ext: 'png' },
  webp: { mime: 'image/webp', ext: 'webp' },
  avif: { mime: 'image/avif', ext: 'avif' },
  heif: { mime: 'image/avif', ext: 'avif' },
  gif: { mime: 'image/gif', ext: 'gif' },
};

const DOCUMENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/** Short clips for hero backgrounds. Stored as uploaded (no transcoding), so keep them small. */
const VIDEO_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
};
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;

export type MediaKind = 'image' | 'document' | 'video';

export function mediaKind(mimeType: string): MediaKind {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  return 'document';
}

export interface UploadedFile {
  originalname: string;
  buffer: Buffer;
  size: number;
}

export interface MediaView {
  id: number;
  url: string;
  kind: MediaKind;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  altText: string | null;
  caption: string | null;
  credit: string | null;
  hasConsent: boolean;
  focalX: number;
  focalY: number;
  folder: string | null;
  srcset: { url: string; width: number; format: string }[];
  updatedAt: Date;
}

@Injectable()
export class MediaService {
  readonly storage = new MediaStorage();

  constructor(
    @InjectRepository(Media) private readonly media: Repository<Media>,
    @InjectRepository(MediaVariant)
    private readonly variants: Repository<MediaVariant>,
    @InjectRepository(MediaUsage)
    private readonly usage: Repository<MediaUsage>,
    private readonly dataSource: DataSource,
    private readonly cache: ContentCacheService,
  ) {}

  view(m: Media): MediaView {
    const kind = mediaKind(m.mimeType);
    return {
      id: m.id,
      url: this.storage.url(m.storageKey),
      kind,
      originalName: m.originalName,
      mimeType: m.mimeType,
      sizeBytes: m.sizeBytes,
      width: m.width,
      height: m.height,
      altText: m.altText,
      caption: m.caption,
      credit: m.credit,
      hasConsent: m.hasConsent,
      focalX: Number(m.focalX),
      focalY: Number(m.focalY),
      folder: m.folder,
      srcset: (m.variants ?? [])
        .sort((a, b) => a.width - b.width)
        .map((v) => ({
          url: this.storage.url(v.storageKey),
          width: v.width,
          format: v.format,
        })),
      updatedAt: m.updatedAt,
    };
  }

  /** Checks the real file contents (not the browser-supplied type) and processes it for storage. */
  private async process(file: UploadedFile) {
    if (!file?.buffer?.length)
      throw new BadRequestException('No file received.');
    const ext = extname(file.originalname).slice(1).toLowerCase();

    if (VIDEO_TYPES[ext]) {
      if (file.size > MAX_VIDEO_BYTES)
        throw new PayloadTooLargeException('Videos must be 25 MB or smaller.');
      const b = file.buffer;
      const ok =
        ext === 'mp4'
          ? b.subarray(4, 8).toString('latin1') === 'ftyp'
          : b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
      if (!ok)
        throw new BadRequestException(
          'The file content does not match its type.',
        );
      return {
        kind: 'video' as const,
        mime: VIDEO_TYPES[ext],
        ext,
        data: file.buffer,
        width: null,
        height: null,
        variants: [],
      };
    }

    if (DOCUMENT_TYPES[ext]) {
      if (file.size > MAX_DOCUMENT_BYTES)
        throw new PayloadTooLargeException(
          'Documents must be 25 MB or smaller.',
        );
      const head = file.buffer.subarray(0, 4).toString('latin1');
      const ok = ext === 'pdf' ? head === '%PDF' : head === 'PK\u0003\u0004';
      if (!ok)
        throw new BadRequestException(
          'The file content does not match its type.',
        );
      return {
        kind: 'document' as const,
        mime: DOCUMENT_TYPES[ext],
        ext,
        data: file.buffer,
        width: null,
        height: null,
        variants: [],
      };
    }

    if (file.size > MAX_IMAGE_BYTES)
      throw new PayloadTooLargeException('Images must be 15 MB or smaller.');
    let meta: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
    try {
      meta = await sharp(file.buffer, {
        limitInputPixels: MAX_IMAGE_PIXELS,
      }).metadata();
    } catch {
      throw new BadRequestException(
        'Upload a JPG, PNG, WebP, AVIF or GIF image, or a PDF/Word/Excel/PowerPoint document.',
      );
    }
    const format = IMAGE_FORMATS[meta.format ?? ''];
    if (!format)
      throw new BadRequestException(
        'Unsupported image format. SVG files are not accepted.',
      );

    // Re-encoding applies EXIF rotation and strips metadata such as GPS location from phone photos.
    const animated = meta.format === 'gif';
    const base = sharp(file.buffer, {
      limitInputPixels: MAX_IMAGE_PIXELS,
      animated,
    }).rotate();
    const { data, info } = await base
      .clone()
      .toBuffer({ resolveWithObject: true });

    const variants = animated ? [] : await buildVariants(base, info.width);
    return {
      kind: 'image' as const,
      mime: format.mime,
      ext: format.ext,
      data,
      width: info.width,
      height: info.height,
      variants,
    };
  }

  private async writeFiles(
    processed: Awaited<ReturnType<MediaService['process']>>,
  ) {
    const now = new Date();
    const dir = MediaStorage.key(
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, '0'),
    );
    const id = randomUUID();
    const storageKey = MediaStorage.key(dir, `${id}.${processed.ext}`);
    await this.storage.put(storageKey, processed.data);
    const variants: Partial<MediaVariant>[] = [];
    for (const v of processed.variants) {
      const key = MediaStorage.key(dir, `${id}-${v.width}.${v.format}`);
      await this.storage.put(key, v.data);
      variants.push({
        width: v.width,
        height: v.height,
        format: v.format,
        storageKey: key,
        sizeBytes: v.data.length,
      });
    }
    return { storageKey, variants };
  }

  /**
   * Rebuilds the resized copies of an existing image (after VARIANT_WIDTHS changes).
   * The media id, original file, alt text and every page that uses it stay the same.
   * New copies get new file names, because the old ones are cached by browsers for a year.
   */
  async regenerateVariants(id: number): Promise<number> {
    const m = await this.media.findOne({
      where: { id },
      relations: { variants: true },
    });
    if (!m || !m.mimeType.startsWith('image/') || m.mimeType === 'image/gif')
      return 0;
    const original = await readFile(
      resolve(this.storage.publicRoot, m.storageKey),
    );
    const built = await buildVariants(
      sharp(original, { limitInputPixels: MAX_IMAGE_PIXELS }),
      m.width ?? Number.MAX_SAFE_INTEGER,
    );
    const stem = m.storageKey.replace(/\.[a-z0-9]+$/i, '');
    const tag = randomUUID().slice(0, 8);
    const rows: Partial<MediaVariant>[] = [];
    for (const v of built) {
      const key = `${stem}-${tag}-${v.width}.${v.format}`;
      await this.storage.put(key, v.data);
      rows.push({
        width: v.width,
        height: v.height,
        format: v.format,
        storageKey: key,
        sizeBytes: v.data.length,
      });
    }
    const oldKeys = m.variants.map((v) => v.storageKey);
    await this.dataSource.transaction(async (em) => {
      await em.delete(MediaVariant, { media: { id } });
      for (const r of rows)
        await em.save(em.create(MediaVariant, { ...r, media: { id } }));
    });
    await Promise.all(oldKeys.map((k) => this.storage.remove(k)));
    this.cache.invalidate();
    return rows.length;
  }

  async upload(
    file: UploadedFile,
    details: { altText?: string; folder?: string },
    userId: number,
  ): Promise<MediaView> {
    const processed = await this.process(file);
    const { storageKey, variants } = await this.writeFiles(processed);
    const saved = await this.dataSource.transaction(async (em) => {
      const m = await em.save(
        em.create(Media, {
          originalName: file.originalname.slice(0, 255),
          storageKey,
          mimeType: processed.mime,
          sizeBytes: processed.data.length,
          width: processed.width,
          height: processed.height,
          altText: details.altText?.trim() || null,
          folder: details.folder?.trim() || null,
          uploadedBy: { id: userId },
        }),
      );
      for (const v of variants)
        await em.save(em.create(MediaVariant, { ...v, media: m }));
      return m;
    });
    return this.get(saved.id);
  }

  /** Swaps the file but keeps the id, so every page using it shows the new file. */
  async replace(id: number, file: UploadedFile): Promise<MediaView> {
    const existing = await this.media.findOne({
      where: { id },
      relations: { variants: true },
    });
    if (!existing) throw new NotFoundException('Media not found.');
    const processed = await this.process(file);
    if (
      processed.kind !== mediaKind(existing.mimeType)
    ) {
      throw new BadRequestException(
        'Replace a file with one of the same kind (image, document or video).',
      );
    }
    const { storageKey, variants } = await this.writeFiles(processed);
    const oldKeys = [
      existing.storageKey,
      ...existing.variants.map((v) => v.storageKey),
    ];
    await this.dataSource.transaction(async (em) => {
      await em.delete(MediaVariant, { media: { id } });
      await em.update(Media, id, {
        storageKey,
        mimeType: processed.mime,
        sizeBytes: processed.data.length,
        width: processed.width,
        height: processed.height,
        originalName: file.originalname.slice(0, 255),
      });
      for (const v of variants)
        await em.save(em.create(MediaVariant, { ...v, media: { id } }));
    });
    await Promise.all(oldKeys.map((k) => this.storage.remove(k)));
    this.cache.invalidate();
    return this.get(id);
  }

  async get(id: number): Promise<MediaView> {
    const m = await this.media.findOne({
      where: { id },
      relations: { variants: true },
    });
    if (!m) throw new NotFoundException('Media not found.');
    return this.view(m);
  }

  async getMany(ids: number[]): Promise<Map<number, MediaView>> {
    if (!ids.length) return new Map();
    const rows = await this.media.find({
      where: { id: In([...new Set(ids)]) },
      relations: { variants: true },
    });
    return new Map(rows.map((m) => [m.id, this.view(m)]));
  }

  async list(q: {
    search?: string;
    folder?: string;
    kind?: MediaKind;
    page?: number;
    pageSize?: number;
  }) {
    const pageSize = Math.min(q.pageSize ?? 40, 100);
    const page = Math.max(q.page ?? 1, 1);
    const qb = this.media
      .createQueryBuilder('m')
      .leftJoinAndSelect('m.variants', 'v')
      .orderBy('m.updatedAt', 'DESC');
    if (q.search)
      qb.andWhere(
        '(m.originalName LIKE :s OR m.altText LIKE :s OR m.caption LIKE :s)',
        { s: `%${q.search}%` },
      );
    if (q.folder) qb.andWhere('m.folder = :folder', { folder: q.folder });
    if (q.kind === 'image') qb.andWhere("m.mimeType LIKE 'image/%'");
    if (q.kind === 'video') qb.andWhere("m.mimeType LIKE 'video/%'");
    if (q.kind === 'document')
      qb.andWhere(
        "m.mimeType NOT LIKE 'image/%' AND m.mimeType NOT LIKE 'video/%'",
      );
    const [rows, total] = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    return { items: rows.map((m) => this.view(m)), total, page, pageSize };
  }

  async folders(): Promise<string[]> {
    const rows: { folder: string }[] = await this.media
      .createQueryBuilder('m')
      .select('DISTINCT m.folder', 'folder')
      .where('m.folder IS NOT NULL')
      .orderBy('folder')
      .getRawMany();
    return rows.map((r) => r.folder);
  }

  async update(
    id: number,
    changes: Partial<
      Pick<Media, 'altText' | 'caption' | 'credit' | 'hasConsent' | 'folder'>
    > & { focalX?: number; focalY?: number },
  ) {
    if (!(await this.media.exists({ where: { id } })))
      throw new NotFoundException('Media not found.');
    const { focalX, focalY, ...rest } = changes;
    await this.media.update(id, {
      ...rest,
      ...(focalX !== undefined ? { focalX: focalX.toFixed(3) } : {}),
      ...(focalY !== undefined ? { focalY: focalY.toFixed(3) } : {}),
    });
    this.cache.invalidate();
    return this.get(id);
  }

  async usages(id: number) {
    return this.usage.find({
      where: { media: { id } },
      order: { entityType: 'ASC', entityId: 'ASC' },
    });
  }

  /** Moves media to trash. Refuses while it is still used unless force is set. */
  async remove(id: number, force: boolean): Promise<void> {
    if (!(await this.media.exists({ where: { id } })))
      throw new NotFoundException('Media not found.');
    const used = await this.usages(id);
    if (used.length && !force) {
      throw new ConflictException({
        message: `This file is used in ${used.length} place(s). Remove it there first, or delete anyway.`,
        code: 'MEDIA_IN_USE',
        usages: used,
      });
    }
    await this.media.softDelete(id);
    this.cache.invalidate();
  }

  /** Replaces the recorded usages for one entity (e.g. all blocks of a page). */
  async setUsages(
    entityType: string,
    entityId: string,
    refs: { mediaId: number; fieldPath: string }[],
  ): Promise<void> {
    await this.dataSource.transaction(async (em) => {
      await em.delete(MediaUsage, { entityType, entityId });
      const known = refs.length
        ? await em.find(Media, {
            where: { id: In(refs.map((r) => r.mediaId)) },
            select: { id: true },
          })
        : [];
      const ids = new Set(known.map((m) => m.id));
      const seen = new Set<string>();
      for (const r of refs) {
        const key = `${r.mediaId}:${r.fieldPath}`;
        if (!ids.has(r.mediaId) || seen.has(key)) continue;
        seen.add(key);
        await em.insert(MediaUsage, {
          media: { id: r.mediaId },
          entityType,
          entityId,
          fieldPath: r.fieldPath.slice(0, 150),
        });
      }
    });
  }

  /** Ids from `ids` that do not exist (or are in trash). */
  async missing(ids: number[]): Promise<number[]> {
    const unique = [...new Set(ids)];
    if (!unique.length) return [];
    const found = await this.media.find({
      where: { id: In(unique) },
      select: { id: true },
    });
    const set = new Set(found.map((m) => m.id));
    return unique.filter((id) => !set.has(id));
  }

  /** Ids from `ids` that are images without alt text. */
  async missingAltText(ids: number[]): Promise<number[]> {
    const unique = [...new Set(ids)];
    if (!unique.length) return [];
    const rows = await this.media.find({
      where: { id: In(unique), mimeType: Like('image/%') },
      select: { id: true, altText: true },
    });
    return rows.filter((m) => !m.altText?.trim()).map((m) => m.id);
  }
}
