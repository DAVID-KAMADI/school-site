import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, type Repository } from 'typeorm';
import { z } from 'zod';
import { Media } from '../entities/media.entity.js';
import { POPUP_KINDS, Popup } from '../entities/popup.entity.js';
import { MediaService } from '../media/media.service.js';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .default(null)
    .transform((v) => v || null);
const optionalDate = z
  .union([z.coerce.date(), z.literal(''), z.null()])
  .default(null)
  .transform((v) => (v instanceof Date ? v : null));

export const popupSchema = z
  .object({
    kind: z.enum(POPUP_KINDS).default('announcement'),
    label: optionalText(60),
    title: z.string().trim().min(3).max(120),
    details: z.string().trim().min(3).max(2000),
    imageId: z.number().int().positive().nullable().default(null),
    eventAt: optionalDate,
    buttonLabel: optionalText(40),
    buttonLink: optionalText(500).refine(
      (v) => v === null || /^(\/(?!\/)|https?:\/\/|mailto:|tel:)/i.test(v),
      'Use a site address starting with / or a full web address starting with https://',
    ),
    startsAt: optionalDate,
    endsAt: optionalDate,
    isActive: z.boolean().default(true),
    isPriority: z.boolean().default(false),
    sortOrder: z.number().int().min(0).max(9999).default(0),
  })
  .refine((p) => !p.buttonLabel === !p.buttonLink, {
    message: 'A button needs both its text and where it goes.',
    path: ['buttonLink'],
  })
  .refine((p) => !p.startsAt || !p.endsAt || p.endsAt > p.startsAt, {
    message: '"Show until" must be after "Show from".',
    path: ['endsAt'],
  });

/** Pop-ups for events, offers, new courses and news, made in Admin → Pop-ups. */
@Injectable()
export class PopupsService {
  constructor(
    @InjectRepository(Popup) private readonly popups: Repository<Popup>,
    @InjectRepository(Media) private readonly media: Repository<Media>,
    private readonly mediaService: MediaService,
  ) {}

  async list() {
    const rows = await this.popups.find({
      order: { isPriority: 'DESC', sortOrder: 'ASC', id: 'DESC' },
    });
    const images = await this.mediaService.getMany(
      rows.flatMap((r) => (r.imageId ? [r.imageId] : [])),
    );
    return rows.map((r) => ({
      ...r,
      image: (r.imageId && images.get(r.imageId)) || null,
    }));
  }

  async save(id: number | null, body: unknown) {
    const r = popupSchema.safeParse(body);
    if (!r.success)
      throw new BadRequestException({
        message: r.error.issues.map((i) => i.message).join(' '),
        issues: r.error.issues,
      });
    const data = r.data;
    if (id && !(await this.popups.exists({ where: { id } })))
      throw new NotFoundException('Pop-up not found.');
    if (data.imageId !== null) {
      const image = await this.media.findOne({
        where: { id: data.imageId, deletedAt: IsNull() },
      });
      if (!image || !image.mimeType.startsWith('image/'))
        throw new BadRequestException('Choose an available photo.');
    }
    return this.popups.save({ ...(id ? { id } : {}), ...data });
  }

  async remove(id: number) {
    const popup = await this.popups.findOneBy({ id });
    if (!popup) throw new NotFoundException('Pop-up not found.');
    await this.popups.remove(popup);
    return { title: popup.title };
  }

  /** Switched on, inside its "show from / until" window, and (for events with no end set) not yet happened. */
  async active() {
    const now = Date.now();
    const rows = (
      await this.popups.find({
        where: { isActive: true },
        order: { isPriority: 'DESC', sortOrder: 'ASC', id: 'DESC' },
      })
    ).filter(
      (p) =>
        (!p.startsAt || p.startsAt.getTime() <= now) &&
        (p.endsAt
          ? p.endsAt.getTime() >= now
          : !p.eventAt || p.eventAt.getTime() >= now),
    );
    const images = await this.mediaService.getMany(
      rows.flatMap((r) => (r.imageId ? [r.imageId] : [])),
    );
    return rows.map((p) => {
      const image = p.imageId ? images.get(p.imageId) : undefined;
      return {
        id: p.id,
        kind: p.kind,
        isPriority: p.isPriority,
        label: p.label,
        title: p.title,
        details: p.details,
        eventAt: p.eventAt,
        buttonLabel: p.buttonLabel,
        buttonLink: p.buttonLink,
        updatedAt: p.updatedAt,
        image: image && image.kind === 'image' ? image : null,
      };
    });
  }
}
