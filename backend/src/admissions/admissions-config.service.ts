import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  IsNull,
  LessThanOrEqual,
  MoreThanOrEqual,
  type Repository,
} from 'typeorm';
import { z } from 'zod';
import { ContentCacheService } from '../cms/content-cache.service.js';
import { Media } from '../cms/entities/media.entity.js';
import { SiteSetting } from '../cms/entities/site-setting.entity.js';
import { MediaService } from '../cms/media/media.service.js';
import { KCSE_GRADES, STUDY_MODES } from './application-schemas.js';
import { DocumentType } from './entities/document-type.entity.js';
import { ApplicationDocument } from './entities/application-document.entity.js';
import { Application } from './entities/application.entity.js';
import { Intake } from './entities/intake.entity.js';
import { Programme, ProgrammeLevel } from './entities/programme.entity.js';
import { CourseDelivery, ShortCourse } from './entities/short-course.entity.js';

export const programmeSchema = z.object({
  code: z.string().trim().min(2).max(30),
  name: z.string().trim().min(3).max(200),
  level: z.enum(ProgrammeLevel),
  school: z.string().trim().min(2).max(150),
  duration: z.string().trim().max(60).nullable().default(null),
  studyModes: z.array(z.enum(STUDY_MODES)).min(1),
  minMeanGrade: z.enum(KCSE_GRADES).nullable().default(null),
  description: z.string().trim().max(2000).nullable().default(null),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});

export const intakeSchema = z
  .object({
    name: z.string().trim().min(3).max(100),
    opensAt: z.coerce.date(),
    closesAt: z.coerce.date(),
    startsOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .default(null),
    isActive: z.boolean().default(true),
  })
  .refine((i) => i.closesAt > i.opensAt, {
    message: 'The closing date must be after the opening date.',
    path: ['closesAt'],
  });

export const documentTypeSchema = z.object({
  name: z.string().trim().min(2).max(150),
  description: z.string().trim().max(500).nullable().default(null),
  isRequired: z.boolean().default(true),
  accepts: z.enum(['image', 'pdf', 'any']).default('any'),
  maxSizeMb: z.number().int().min(1).max(20).default(5),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .default(null)
    .transform((v) => v || null);

export const shortCourseSchema = z.object({
  title: z.string().trim().min(3).max(200),
  category: z.string().trim().max(100).default(''),
  summary: z.string().trim().max(500).default(''),
  duration: optionalText(60),
  fee: optionalText(60),
  delivery: z.enum(CourseDelivery).default(CourseDelivery.InPerson),
  schedule: optionalText(150),
  nextStartOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
  imageId: z.number().int().positive().nullable().default(null),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) {
    throw new BadRequestException({
      message: r.error.issues
        .map((i) => `${i.path.join('.') || 'value'}: ${i.message}`)
        .join('; '),
      issues: r.error.issues,
    });
  }
  return r.data;
}

/** Programmes, intakes, document types and admissions settings: all editable in the admin. */
@Injectable()
export class AdmissionsConfigService {
  constructor(
    @InjectRepository(Programme)
    private readonly programmes: Repository<Programme>,
    @InjectRepository(Intake) private readonly intakes: Repository<Intake>,
    @InjectRepository(DocumentType)
    private readonly docTypes: Repository<DocumentType>,
    @InjectRepository(ShortCourse)
    private readonly shortCourses: Repository<ShortCourse>,
    @InjectRepository(Application)
    private readonly applications: Repository<Application>,
    @InjectRepository(ApplicationDocument)
    private readonly appDocuments: Repository<ApplicationDocument>,
    @InjectRepository(Media) private readonly media: Repository<Media>,
    @InjectRepository(SiteSetting)
    private readonly settings: Repository<SiteSetting>,
    private readonly mediaService: MediaService,
    private readonly cache: ContentCacheService,
  ) {}

  /** Everything the application form needs, for applicants and the public /apply page. */
  async options() {
    const now = new Date();
    const [programmes, intakes, documentTypes, settings] = await Promise.all([
      this.programmes.find({
        where: { isActive: true },
        order: { sortOrder: 'ASC', name: 'ASC' },
      }),
      this.intakes.find({
        where: {
          isActive: true,
          opensAt: LessThanOrEqual(now),
          closesAt: MoreThanOrEqual(now),
        },
        order: { closesAt: 'ASC' },
      }),
      this.docTypes.find({
        where: { isActive: true },
        order: { sortOrder: 'ASC', id: 'ASC' },
      }),
      this.settings.find({
        where: [{ groupName: 'admissions' }, { key: 'payments.mpesa_paybill' }],
      }),
    ]);
    return {
      programmes: programmes.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        level: p.level,
        school: p.school,
        duration: p.duration,
        studyModes: p.studyModes,
        minMeanGrade: p.minMeanGrade,
        description: p.description,
      })),
      intakes: intakes.map((i) => ({
        id: i.id,
        name: i.name,
        closesAt: i.closesAt,
        startsOn: i.startsOn,
      })),
      documentTypes: documentTypes.map((d) => ({
        id: d.id,
        name: d.name,
        description: d.description,
        isRequired: d.isRequired,
        accepts: d.accepts,
        maxSizeMb: d.maxSizeMb,
      })),
      settings: Object.fromEntries(settings.map((s) => [s.key, s.value])),
    };
  }

  async isIntakeOpen(intakeId: number): Promise<boolean> {
    const now = new Date();
    return this.intakes.exists({
      where: {
        id: intakeId,
        isActive: true,
        opensAt: LessThanOrEqual(now),
        closesAt: MoreThanOrEqual(now),
      },
    });
  }

  async setting<T>(key: string, fallback: T): Promise<T> {
    const row = await this.settings.findOneBy({ key });
    return (row?.value as T) ?? fallback;
  }

  // ---------- Admin CRUD ----------

  listProgrammes() {
    return this.programmes.find({ order: { sortOrder: 'ASC', name: 'ASC' } });
  }

  async saveProgramme(id: number | null, body: unknown) {
    const data = parse(programmeSchema, body);
    const clash = await this.programmes.findOneBy({ code: data.code });
    if (clash && clash.id !== id)
      throw new ConflictException(
        `Another programme already uses the code ${data.code}.`,
      );
    if (id && !(await this.programmes.exists({ where: { id } })))
      throw new NotFoundException('Programme not found.');
    const saved = await this.programmes.save({
      ...(id ? { id } : {}),
      ...data,
    });
    // The website's programme lists come from here.
    this.cache.invalidate();
    return saved;
  }

  /** Only while no application uses it: applications keep the programme they were made for. */
  async deleteProgramme(id: number) {
    const programme = await this.programmes.findOneBy({ id });
    if (!programme) throw new NotFoundException('Programme not found.');
    const used = await this.applications.count({
      where: { programme: { id } },
    });
    if (used)
      throw new BadRequestException(
        `${used} application${used === 1 ? ' uses' : 's use'} this programme, so it cannot be deleted. Hide it from applicants instead.`,
      );
    await this.programmes.remove(programme);
    this.cache.invalidate();
    return { name: programme.name };
  }

  listIntakes() {
    return this.intakes.find({ order: { opensAt: 'DESC' } });
  }

  async saveIntake(id: number | null, body: unknown) {
    const data = parse(intakeSchema, body);
    if (id && !(await this.intakes.exists({ where: { id } })))
      throw new NotFoundException('Intake not found.');
    return this.intakes.save({ ...(id ? { id } : {}), ...data });
  }

  async deleteIntake(id: number) {
    const intake = await this.intakes.findOneBy({ id });
    if (!intake) throw new NotFoundException('Intake not found.');
    const used = await this.applications.count({ where: { intake: { id } } });
    if (used)
      throw new BadRequestException(
        `${used} application${used === 1 ? ' is' : 's are'} for this intake, so it cannot be deleted. Hide it instead.`,
      );
    await this.intakes.remove(intake);
    return { name: intake.name };
  }

  listDocumentTypes() {
    return this.docTypes.find({ order: { sortOrder: 'ASC', id: 'ASC' } });
  }

  async saveDocumentType(id: number | null, body: unknown) {
    const data = parse(documentTypeSchema, body);
    if (id && !(await this.docTypes.exists({ where: { id } })))
      throw new NotFoundException('Document type not found.');
    return this.docTypes.save({ ...(id ? { id } : {}), ...data });
  }

  async deleteDocumentType(id: number) {
    const docType = await this.docTypes.findOneBy({ id });
    if (!docType) throw new NotFoundException('Document type not found.');
    const used = await this.appDocuments.count({
      where: { documentType: { id } },
    });
    if (used)
      throw new BadRequestException(
        `Applicants have uploaded ${used} file${used === 1 ? '' : 's'} for this document, so it cannot be deleted. Stop asking for it instead.`,
      );
    await this.docTypes.remove(docType);
    return { name: docType.name };
  }

  /** All short courses, with their photo for the admin list. */
  async listShortCourses() {
    const rows = await this.shortCourses.find({
      order: { sortOrder: 'ASC', title: 'ASC' },
    });
    const images = await this.mediaService.getMany(
      rows.flatMap((r) => (r.imageId ? [r.imageId] : [])),
    );
    return rows.map((r) => ({
      ...r,
      image: (r.imageId && images.get(r.imageId)) || null,
    }));
  }

  async saveShortCourse(id: number | null, body: unknown) {
    const data = parse(shortCourseSchema, body);
    if (id && !(await this.shortCourses.exists({ where: { id } })))
      throw new NotFoundException('Short course not found.');
    if (data.imageId !== null) {
      const image = await this.media.findOne({
        where: { id: data.imageId, deletedAt: IsNull() },
      });
      if (!image || !image.mimeType.startsWith('image/'))
        throw new BadRequestException('Choose an available image.');
    }
    const saved = await this.shortCourses.save({
      ...(id ? { id } : {}),
      ...data,
    });
    this.cache.invalidate();
    return saved;
  }

  async deleteShortCourse(id: number) {
    const result = await this.shortCourses.delete({ id });
    if (!result.affected)
      throw new NotFoundException('Short course not found.');
    this.cache.invalidate();
  }
}
