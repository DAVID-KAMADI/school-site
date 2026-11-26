import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, type Repository } from 'typeorm';
import { z } from 'zod';
import { Media } from '../cms/entities/media.entity.js';
import { SiteSetting } from '../cms/entities/site-setting.entity.js';
import { MediaService } from '../cms/media/media.service.js';
import {
  readPageIntro,
  savePageIntro,
  type PageIntro,
} from '../cms/site/page-intro.js';
import { StaffLevel } from './entities/staff-level.entity.js';
import { StaffMember } from './entities/staff-member.entity.js';

const PAGE_KEY = 'staff.page';
const PAGE_DEFAULT: PageIntro = {
  eyebrow: 'Who we are',
  title: 'Our people',
  intro:
    'Meet the leadership, lecturers and staff who run the institute and support every student.',
};

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .default(null)
    .transform((v) => v || null);

export const levelSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: optionalText(300),
});

export const memberSchema = z.object({
  levelId: z.number().int().positive(),
  name: z.string().trim().min(2).max(120),
  position: z.string().trim().min(2).max(120),
  department: optionalText(120),
  photoId: z.number().int().positive().nullable().default(null),
  bio: optionalText(2000),
  email: z
    .union([z.email().max(160), z.literal(''), z.null()])
    .default(null)
    .transform((v) => v || null),
  phone: optionalText(40).refine(
    (v) => v === null || /^[+\d][\d\s()-]{5,}$/.test(v),
    'Enter a phone number with digits only, e.g. +254 712 345 678.',
  ),
  isPublished: z.boolean().default(true),
});

const orderSchema = z.object({
  ids: z.array(z.number().int().positive()).max(1000),
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

/** The institute's staff hierarchy for the website's Our people page. */
@Injectable()
export class StaffService {
  constructor(
    @InjectRepository(StaffLevel)
    private readonly levels: Repository<StaffLevel>,
    @InjectRepository(StaffMember)
    private readonly members: Repository<StaffMember>,
    @InjectRepository(Media) private readonly media: Repository<Media>,
    @InjectRepository(SiteSetting)
    private readonly settings: Repository<SiteSetting>,
    private readonly mediaService: MediaService,
    private readonly dataSource: DataSource,
  ) {}

  // ---------- Admin ----------

  async listAdmin() {
    const [levels, members] = await Promise.all([
      this.levels.find({ order: { sortOrder: 'ASC', id: 'ASC' } }),
      this.members.find({ order: { sortOrder: 'ASC', id: 'ASC' } }),
    ]);
    const photos = await this.mediaService.getMany(
      members.flatMap((m) => (m.photoId ? [m.photoId] : [])),
    );
    return {
      page: await readPageIntro(this.settings, PAGE_KEY, PAGE_DEFAULT),
      levels,
      members: members.map((m) => ({
        ...m,
        photo: (m.photoId && photos.get(m.photoId)) || null,
      })),
    };
  }

  async saveLevel(id: number | null, body: unknown) {
    const data = parse(levelSchema, body);
    if (id) {
      if (!(await this.levels.exists({ where: { id } })))
        throw new NotFoundException('Tier not found.');
      return this.levels.save({ id, ...data });
    }
    const last = await this.levels.findOne({
      where: {},
      order: { sortOrder: 'DESC' },
    });
    return this.levels.save({
      ...data,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    });
  }

  async removeLevel(id: number) {
    const level = await this.levels.findOneBy({ id });
    if (!level) throw new NotFoundException('Tier not found.');
    const count = await this.members.countBy({ levelId: id });
    if (count)
      throw new ConflictException(
        `"${level.name}" still has ${count} ${count === 1 ? 'person' : 'people'}. Move or remove them first.`,
      );
    await this.levels.remove(level);
    return { name: level.name };
  }

  async saveMember(id: number | null, body: unknown) {
    const data = parse(memberSchema, body);
    const existing = id ? await this.members.findOneBy({ id }) : null;
    if (id && !existing) throw new NotFoundException('Person not found.');
    if (!(await this.levels.exists({ where: { id: data.levelId } })))
      throw new BadRequestException('Choose a tier for this person.');
    if (data.photoId !== null) {
      const photo = await this.media.findOne({
        where: { id: data.photoId, deletedAt: IsNull() },
      });
      if (!photo || !photo.mimeType.startsWith('image/'))
        throw new BadRequestException('Choose an available photo.');
    }
    let sortOrder = existing?.sortOrder ?? 0;
    // New to this tier: goes to the end of it.
    if (!existing || existing.levelId !== data.levelId) {
      const last = await this.members.findOne({
        where: { levelId: data.levelId },
        order: { sortOrder: 'DESC' },
      });
      sortOrder = (last?.sortOrder ?? -1) + 1;
    }
    const saved = await this.members.save({
      ...(id ? { id } : {}),
      ...data,
      level: { id: data.levelId },
      sortOrder,
    });
    await this.mediaService.setUsages(
      'staff_member',
      String(saved.id),
      data.photoId ? [{ mediaId: data.photoId, fieldPath: 'photo' }] : [],
    );
    return saved;
  }

  async removeMember(id: number) {
    const member = await this.members.findOneBy({ id });
    if (!member) throw new NotFoundException('Person not found.');
    await this.members.remove(member);
    await this.mediaService.setUsages('staff_member', String(id), []);
    return { name: member.name };
  }

  /** Puts tiers (top first) or the people of one tier in the given order. */
  async reorder(kind: 'levels' | 'members', body: unknown) {
    const { ids } = parse(orderSchema, body);
    const entity = kind === 'levels' ? StaffLevel : StaffMember;
    await this.dataSource.transaction(async (em) => {
      for (const [i, id] of ids.entries())
        await em.update(entity, { id }, { sortOrder: i });
    });
    return { ok: true };
  }

  savePage(body: unknown, userId: number) {
    return savePageIntro(
      this.settings,
      PAGE_KEY,
      'Heading and introduction of the Our people page (/staff).',
      body,
      userId,
    );
  }

  // ---------- Website ----------

  /** The Our people page: tiers from the top down with their published people. Empty tiers are left out. */
  async publicHierarchy() {
    const [levels, members] = await Promise.all([
      this.levels.find({ order: { sortOrder: 'ASC', id: 'ASC' } }),
      this.members.find({
        where: { isPublished: true },
        order: { sortOrder: 'ASC', id: 'ASC' },
      }),
    ]);
    const photos = await this.mediaService.getMany(
      members.flatMap((m) => (m.photoId ? [m.photoId] : [])),
    );
    return {
      page: await readPageIntro(this.settings, PAGE_KEY, PAGE_DEFAULT),
      levels: levels
        .map((l) => ({
          id: l.id,
          name: l.name,
          description: l.description,
          members: members
            .filter((m) => m.levelId === l.id)
            .map((m) => {
              const photo = m.photoId ? photos.get(m.photoId) : undefined;
              return {
                id: m.id,
                name: m.name,
                position: m.position,
                department: m.department,
                bio: m.bio,
                email: m.email,
                phone: m.phone,
                photo: photo && photo.kind === 'image' ? photo : null,
              };
            }),
        }))
        .filter((l) => l.members.length),
    };
  }
}
