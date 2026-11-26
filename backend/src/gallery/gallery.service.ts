import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Not, type Repository } from 'typeorm';
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
import { GalleryAlbum } from './entities/gallery-album.entity.js';
import { GalleryPhoto } from './entities/gallery-photo.entity.js';

const PAGE_KEY = 'gallery.page';
const PAGE_DEFAULT: PageIntro = {
  eyebrow: 'Life at the institute',
  title: 'Gallery',
  intro:
    'Moments from our classrooms, labs, field work, graduations and events.',
};
/** Most photos one album can hold. */
export const MAX_PHOTOS = 300;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .default(null)
    .transform((v) => v || null);

export const albumSchema = z.object({
  title: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .max(140)
    .default('')
    .refine(
      (v) => v === '' || isValidSlug(v),
      'The web address may only use lower-case letters, numbers and dashes.',
    ),
  description: optionalText(1000),
  category: optionalText(60),
  coverImageId: z.number().int().positive().nullable().default(null),
  takenOn: z
    .union([z.iso.date(), z.literal(''), z.null()])
    .default(null)
    .transform((v) => v || null),
  isPublished: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(9999).default(0),
  photos: z
    .array(
      z.object({
        mediaId: z.number().int().positive(),
        caption: optionalText(300),
      }),
    )
    .max(MAX_PHOTOS, `An album can hold up to ${MAX_PHOTOS} photos.`)
    .default([]),
});

export interface AlbumCard {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  category: string | null;
  takenOn: string | null;
  isFeatured: boolean;
  photoCount: number;
  cover: MediaView | null;
  /** A few more photos for the stacked-card look on the Gallery page. */
  preview: MediaView[];
}

/** Photo albums for the website's Gallery page. */
@Injectable()
export class GalleryService {
  constructor(
    @InjectRepository(GalleryAlbum)
    private readonly albums: Repository<GalleryAlbum>,
    @InjectRepository(GalleryPhoto)
    private readonly photos: Repository<GalleryPhoto>,
    @InjectRepository(Media) private readonly media: Repository<Media>,
    @InjectRepository(SiteSetting)
    private readonly settings: Repository<SiteSetting>,
    private readonly mediaService: MediaService,
    private readonly dataSource: DataSource,
  ) {}

  // ---------- Admin ----------

  async listAdmin() {
    const albums = await this.albums.find({
      order: {
        isFeatured: 'DESC',
        sortOrder: 'ASC',
        takenOn: 'DESC',
        id: 'DESC',
      },
    });
    const cards = await this.cards(albums, false);
    return {
      page: await readPageIntro(this.settings, PAGE_KEY, PAGE_DEFAULT),
      albums: albums.map((a, i) => ({
        ...cards[i],
        isPublished: a.isPublished,
        sortOrder: a.sortOrder,
        coverImageId: a.coverImageId,
        updatedAt: a.updatedAt,
      })),
    };
  }

  async getAdmin(id: number) {
    const album = await this.albums.findOneBy({ id });
    if (!album) throw new NotFoundException('Album not found.');
    const photos = await this.photos.find({
      where: { albumId: id },
      order: { sortOrder: 'ASC', id: 'ASC' },
    });
    const media = await this.mediaService.getMany([
      ...photos.map((p) => p.mediaId),
      ...(album.coverImageId ? [album.coverImageId] : []),
    ]);
    return {
      ...album,
      photos: photos.map((p) => ({
        mediaId: p.mediaId,
        caption: p.caption,
        media: media.get(p.mediaId) ?? null,
      })),
      cover: album.coverImageId
        ? (media.get(album.coverImageId) ?? null)
        : null,
    };
  }

  async save(id: number | null, body: unknown) {
    const r = albumSchema.safeParse(body);
    if (!r.success)
      throw new BadRequestException({
        message: r.error.issues.map((i) => i.message).join(' '),
        issues: r.error.issues,
      });
    const { photos, ...data } = r.data;
    if (id && !(await this.albums.exists({ where: { id } })))
      throw new NotFoundException('Album not found.');

    const slug = data.slug || slugify(data.title) || `album-${Date.now()}`;
    const clash = await this.albums.findOne({
      where: { slug, ...(id ? { id: Not(id) } : {}) },
    });
    if (clash)
      throw new ConflictException(
        `Another album ("${clash.title}") already uses the address /gallery/${slug}. Change the title or the web address.`,
      );

    const imageIds = [
      ...new Set([
        ...photos.map((p) => p.mediaId),
        ...(data.coverImageId ? [data.coverImageId] : []),
      ]),
    ];
    if (imageIds.length) {
      const found = await this.media.find({
        where: { id: In(imageIds), deletedAt: IsNull() },
        select: { id: true, mimeType: true },
      });
      const images = new Set(
        found.filter((m) => m.mimeType.startsWith('image/')).map((m) => m.id),
      );
      if (imageIds.some((mid) => !images.has(mid)))
        throw new BadRequestException(
          'One of the chosen photos is no longer in the media library (or is not an image). Remove it and save again.',
        );
    }

    const saved = await this.dataSource.transaction(async (em) => {
      const album = await em.save(GalleryAlbum, {
        ...(id ? { id } : {}),
        ...data,
        slug,
      });
      await em.delete(GalleryPhoto, { albumId: album.id });
      if (photos.length)
        await em.insert(
          GalleryPhoto,
          photos.map((p, i) => ({
            albumId: album.id,
            mediaId: p.mediaId,
            caption: p.caption,
            sortOrder: i,
          })),
        );
      return album;
    });
    // So the media library can warn before a photo used here is deleted.
    await this.mediaService.setUsages('gallery_album', String(saved.id), [
      ...(saved.coverImageId
        ? [{ mediaId: saved.coverImageId, fieldPath: 'cover' }]
        : []),
      ...photos.map((p, i) => ({
        mediaId: p.mediaId,
        fieldPath: `photos.${i}`,
      })),
    ]);
    return this.getAdmin(saved.id);
  }

  async remove(id: number) {
    const album = await this.albums.findOneBy({ id });
    if (!album) throw new NotFoundException('Album not found.');
    await this.albums.remove(album);
    await this.mediaService.setUsages('gallery_album', String(id), []);
    return { title: album.title };
  }

  savePage(body: unknown, userId: number) {
    return savePageIntro(
      this.settings,
      PAGE_KEY,
      'Heading and introduction of the Gallery page (/gallery).',
      body,
      userId,
    );
  }

  // ---------- Website ----------

  /** The Gallery page: its heading and every published album that has photos. */
  async publicIndex() {
    const albums = await this.albums.find({
      where: { isPublished: true },
      order: {
        isFeatured: 'DESC',
        sortOrder: 'ASC',
        takenOn: 'DESC',
        id: 'DESC',
      },
    });
    const cards = (await this.cards(albums, true)).filter(
      (c) => c.photoCount > 0,
    );
    const categories = [
      ...new Set(cards.flatMap((c) => (c.category ? [c.category] : []))),
    ].sort((a, b) => a.localeCompare(b));
    return {
      page: await readPageIntro(this.settings, PAGE_KEY, PAGE_DEFAULT),
      categories,
      albums: cards,
    };
  }

  /** One published album with all its photos. */
  async publicAlbum(slug: string) {
    const album = await this.albums.findOneBy({ slug, isPublished: true });
    if (!album) throw new NotFoundException('Album not found.');
    const photos = await this.photos.find({
      where: { albumId: album.id },
      order: { sortOrder: 'ASC', id: 'ASC' },
    });
    const media = await this.mediaService.getMany(photos.map((p) => p.mediaId));
    const shown = photos.filter((p) => media.get(p.mediaId)?.kind === 'image');
    if (!shown.length) throw new NotFoundException('Album not found.');
    const others = await this.albums.find({
      where: { isPublished: true, id: Not(album.id) },
      order: {
        isFeatured: 'DESC',
        sortOrder: 'ASC',
        takenOn: 'DESC',
        id: 'DESC',
      },
      take: 6,
    });
    const more = (await this.cards(others, true)).filter(
      (c) => c.photoCount > 0,
    );
    return {
      album: {
        id: album.id,
        slug: album.slug,
        title: album.title,
        description: album.description,
        category: album.category,
        takenOn: album.takenOn,
      },
      photos: shown.map((p) => ({
        mediaId: p.mediaId,
        caption: p.caption ?? '',
      })),
      media: Object.fromEntries(
        shown.map((p) => [String(p.mediaId), media.get(p.mediaId)!]),
      ),
      more: more.slice(0, 3),
    };
  }

  /** Album cards with their cover, photo count and a few preview photos. */
  private async cards(
    albums: GalleryAlbum[],
    live: boolean,
  ): Promise<AlbumCard[]> {
    if (!albums.length) return [];
    const photos = await this.photos.find({
      where: { albumId: In(albums.map((a) => a.id)) },
      order: { sortOrder: 'ASC', id: 'ASC' },
      select: { albumId: true, mediaId: true },
    });
    const byAlbum = new Map<number, number[]>();
    for (const p of photos) {
      const list = byAlbum.get(p.albumId) ?? [];
      list.push(p.mediaId);
      byAlbum.set(p.albumId, list);
    }
    const wanted = albums.flatMap((a) => [
      ...(a.coverImageId ? [a.coverImageId] : []),
      ...(byAlbum.get(a.id) ?? []).slice(0, 4),
    ]);
    const media = await this.mediaService.getMany(wanted);
    // Photos removed from the media library are left out on the website.
    const isImage = (mid: number) => media.get(mid)?.kind === 'image';
    return albums.map((a) => {
      const ids = byAlbum.get(a.id) ?? [];
      const coverId =
        a.coverImageId && isImage(a.coverImageId)
          ? a.coverImageId
          : ids.slice(0, 4).find(isImage);
      return {
        id: a.id,
        slug: a.slug,
        title: a.title,
        description: a.description,
        category: a.category,
        takenOn: a.takenOn,
        isFeatured: a.isFeatured,
        photoCount: live
          ? ids.filter((mid) => !media.has(mid) || isImage(mid)).length
          : ids.length,
        cover: coverId ? media.get(coverId)! : null,
        preview: ids
          .slice(0, 4)
          .filter((mid) => mid !== coverId && isImage(mid))
          .slice(0, 3)
          .map((mid) => media.get(mid)!),
      };
    });
  }
}
