import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, type EntityManager, type Repository } from 'typeorm';
import { z } from 'zod';
import { Programme } from '../admissions/entities/programme.entity.js';
import { AuditService } from '../audit/audit.service.js';
import { withDeadlockRetry } from '../database/retry.js';
import {
  ConflictError,
  DAY_NAMES,
  Timetable,
  type Model,
  type Placement,
} from './engine.js';
import {
  ROOM_TYPES,
  TtClass,
  TtLecturer,
  TtRoom,
  TtUnit,
} from './entities/resources.entity.js';
import {
  TermStatus,
  TtLesson,
  TtPeriod,
  TtSession,
  TtSlot,
  TtTerm,
} from './entities/term.entity.js';

const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM, e.g. 08:00');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const days = z
  .array(z.number().int().min(1).max(7))
  .min(1, 'Choose at least one teaching day.')
  .transform((d) => [...new Set(d)].sort((a, b) => a - b));

const roomSchema = z.object({
  name: z.string().trim().min(1).max(100),
  capacity: z.number().int().min(1).max(5000),
  type: z.enum(ROOM_TYPES).default('classroom'),
  notes: z.string().trim().max(300).nullable().default(null),
  isActive: z.boolean().default(true),
});
const lecturerSchema = z.object({
  name: z.string().trim().min(2).max(150),
  email: z.email().max(255).nullable().default(null),
  department: z.string().trim().max(150).nullable().default(null),
  maxPeriodsPerDay: z.number().int().min(1).max(20).nullable().default(null),
  unavailable: z
    .array(
      z
        .object({ day: z.number().int().min(1).max(7), from: time, to: time })
        .refine(
          (u) => u.from < u.to,
          'The end time must be after the start time.',
        ),
    )
    .max(50)
    .default([]),
  isActive: z.boolean().default(true),
});
const classSchema = z.object({
  name: z.string().trim().min(2).max(150),
  programmeId: z.number().int().positive().nullable().default(null),
  size: z.number().int().min(1).max(5000),
  isActive: z.boolean().default(true),
});
const unitSchema = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(2).max(200),
  roomType: z.enum(ROOM_TYPES).nullable().default(null),
  isActive: z.boolean().default(true),
});
const termSchema = z
  .object({
    name: z.string().trim().min(2).max(150),
    startsOn: date,
    endsOn: date,
    days: days.default([1, 2, 3, 4, 5]),
    copyFromTermId: z.number().int().positive().nullable().default(null),
  })
  .refine((t) => t.endsOn > t.startsOn, {
    message: 'The term must end after it starts.',
    path: ['endsOn'],
  });
const periodsSchema = z
  .array(
    z.object({
      id: z.number().int().positive().optional(),
      startsAt: time,
      endsAt: time,
      isBreak: z.boolean().default(false),
      label: z.string().trim().max(50).nullable().default(null),
    }),
  )
  .min(1)
  .max(30)
  .superRefine((list, ctx) => {
    list.forEach((p, i) => {
      if (p.startsAt >= p.endsAt)
        ctx.addIssue({
          code: 'custom',
          path: [i, 'endsAt'],
          message: `Period ${i + 1} must end after it starts.`,
        });
      if (i > 0 && p.startsAt < list[i - 1].endsAt)
        ctx.addIssue({
          code: 'custom',
          path: [i, 'startsAt'],
          message: `Period ${i + 1} starts before period ${i} ends.`,
        });
    });
    if (list.every((p) => p.isBreak))
      ctx.addIssue({
        code: 'custom',
        path: [],
        message: 'At least one period must be for teaching.',
      });
  });
const lessonSchema = z.object({
  unitId: z.number().int().positive(),
  lecturerId: z.number().int().positive(),
  classIds: z
    .array(z.number().int().positive())
    .min(1, 'Choose at least one class.')
    .max(10),
  sessionsPerWeek: z.number().int().min(1).max(15),
  length: z.number().int().min(1).max(6).default(1),
  roomType: z.enum(ROOM_TYPES).nullable().default(null),
  notes: z.string().trim().max(300).nullable().default(null),
});
const placeSchema = z.object({
  day: z.number().int().min(1).max(7),
  periodId: z.number().int().positive(),
  roomId: z.number().int().positive(),
});

/** A sensible starting day: 08:00–17:00 with a tea break and lunch. Editable per term. */
const DEFAULT_PERIODS = [
  ['08:00', '09:00', false, null],
  ['09:00', '10:00', false, null],
  ['10:00', '10:30', true, 'Tea break'],
  ['10:30', '11:30', false, null],
  ['11:30', '12:30', false, null],
  ['12:30', '13:30', true, 'Lunch'],
  ['13:30', '14:30', false, null],
  ['14:30', '15:30', false, null],
  ['15:30', '16:30', false, null],
] as const;

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success)
    throw new BadRequestException({
      message: r.error.issues.map((i) => i.message).join(' '),
      issues: r.error.issues,
    });
  return r.data;
}

/**
 * Rooms, lecturers, classes and units (shared by all terms), and each term's periods, lessons and
 * timetable. Every change to the timetable goes through the engine's rules, and the tt_slots unique
 * index rejects anything that slips past them (e.g. two people saving at once).
 */
@Injectable()
export class TimetableService {
  constructor(
    @InjectRepository(TtRoom) private readonly rooms: Repository<TtRoom>,
    @InjectRepository(TtLecturer)
    private readonly lecturers: Repository<TtLecturer>,
    @InjectRepository(TtClass) private readonly classes: Repository<TtClass>,
    @InjectRepository(TtUnit) private readonly units: Repository<TtUnit>,
    @InjectRepository(TtTerm) private readonly terms: Repository<TtTerm>,
    @InjectRepository(TtPeriod) private readonly periods: Repository<TtPeriod>,
    @InjectRepository(TtLesson) private readonly lessons: Repository<TtLesson>,
    @InjectRepository(TtSession)
    private readonly sessions: Repository<TtSession>,
    @InjectRepository(Programme)
    private readonly programmes: Repository<Programme>,
    private readonly audit: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  // ================================================================ shared resources

  async resources() {
    const [rooms, lecturers, classes, units, programmes] = await Promise.all([
      this.rooms.find({ order: { name: 'ASC' } }),
      this.lecturers.find({ order: { name: 'ASC' } }),
      this.classes.find({
        relations: { programme: true },
        order: { name: 'ASC' },
      }),
      this.units.find({ order: { code: 'ASC' } }),
      this.programmes.find({
        order: { name: 'ASC' },
        select: { id: true, code: true, name: true },
      }),
    ]);
    return {
      rooms,
      lecturers,
      classes: classes.map(({ programme, ...c }) => ({
        ...c,
        programmeId: programme?.id ?? null,
      })),
      units,
      programmes,
    };
  }

  async saveRoom(id: number | null, body: unknown, userId: number) {
    const data = parse(roomSchema, body);
    await this.unique(
      this.rooms,
      'name',
      data.name,
      id,
      `Another room is called ${data.name}.`,
    );
    return this.saveResource(this.rooms, 'room', id, data, userId);
  }

  async saveLecturer(id: number | null, body: unknown, userId: number) {
    const data = parse(lecturerSchema, body);
    return this.saveResource(this.lecturers, 'lecturer', id, data, userId);
  }

  async saveClass(id: number | null, body: unknown, userId: number) {
    const { programmeId, ...data } = parse(classSchema, body);
    await this.unique(
      this.classes,
      'name',
      data.name,
      id,
      `Another class is called ${data.name}.`,
    );
    if (
      programmeId &&
      !(await this.programmes.exists({ where: { id: programmeId } }))
    )
      throw new BadRequestException('Programme not found.');
    return this.saveResource(
      this.classes,
      'class',
      id,
      { ...data, programme: programmeId ? { id: programmeId } : null },
      userId,
    );
  }

  async saveUnit(id: number | null, body: unknown, userId: number) {
    const data = parse(unitSchema, body);
    await this.unique(
      this.units,
      'code',
      data.code,
      id,
      `Another unit uses the code ${data.code}.`,
    );
    return this.saveResource(this.units, 'unit', id, data, userId);
  }

  // ================================================================ terms and periods

  async listTerms() {
    const terms = await this.terms.find({ order: { startsOn: 'DESC' } });
    const counts: { term_id: number; total: string; placed: string }[] =
      await this.dataSource.query(
        'SELECT term_id, COUNT(*) total, SUM(day IS NOT NULL) placed FROM tt_sessions GROUP BY term_id',
      );
    return terms.map((t) => {
      const c = counts.find((x) => Number(x.term_id) === t.id);
      return {
        ...t,
        sessions: Number(c?.total ?? 0),
        placed: Number(c?.placed ?? 0),
      };
    });
  }

  /** A new term, starting from the default day or from a copy of another term (periods, lessons and placements). */
  async createTerm(body: unknown, userId: number) {
    const data = parse(termSchema, body);
    const source = data.copyFromTermId
      ? await this.term(data.copyFromTermId)
      : null;
    const term = await this.tx(async (em) => {
      const created = await em.save(
        em.create(TtTerm, {
          name: data.name,
          startsOn: data.startsOn,
          endsOn: data.endsOn,
          days: data.days,
          status: TermStatus.Draft,
        }),
      );
      const periodMap = new Map<number, number>();
      if (source) {
        const old = await em.find(TtPeriod, {
          where: { term: { id: source.id } },
          order: { sortOrder: 'ASC' },
        });
        for (const p of old) {
          const copy = await em.save(
            em.create(TtPeriod, {
              term: created,
              sortOrder: p.sortOrder,
              startsAt: p.startsAt,
              endsAt: p.endsAt,
              isBreak: p.isBreak,
              label: p.label,
            }),
          );
          periodMap.set(p.id, copy.id);
        }
        const lessons = await em.find(TtLesson, {
          where: { term: { id: source.id } },
          relations: { unit: true, lecturer: true, classes: true },
        });
        for (const l of lessons) {
          const copy = await em.save(
            em.create(TtLesson, {
              term: created,
              unit: l.unit,
              lecturer: l.lecturer,
              classes: l.classes,
              sessionsPerWeek: l.sessionsPerWeek,
              length: l.length,
              roomType: l.roomType,
              notes: l.notes,
            }),
          );
          const old = await em.find(TtSession, {
            where: { lesson: { id: l.id } },
            relations: { startPeriod: true, room: true },
            order: { id: 'ASC' },
          });
          for (const s of old)
            await em.save(
              em.create(TtSession, {
                lesson: copy,
                term: created,
                day: s.day,
                startPeriod: s.startPeriod
                  ? { id: periodMap.get(s.startPeriod.id)! }
                  : null,
                room: s.room,
                locked: s.locked,
              }),
            );
        }
      } else {
        for (const [
          i,
          [startsAt, endsAt, isBreak, label],
        ] of DEFAULT_PERIODS.entries())
          await em.save(
            em.create(TtPeriod, {
              term: created,
              sortOrder: i,
              startsAt,
              endsAt,
              isBreak,
              label,
            }),
          );
      }
      return created;
    });
    // Copied placements are re-checked against the new term's rules and written to the slot table.
    if (source) await this.reconcile(term.id, []);
    await this.record('timetable.term.create', userId, term.id, {
      copiedFrom: source?.id ?? null,
    });
    return term;
  }

  async updateTerm(id: number, body: unknown, userId: number) {
    const { copyFromTermId: _ignored, ...data } = parse(termSchema, body);
    await this.term(id);
    await this.terms.update(id, data);
    const report = await this.reconcile(id, []);
    await this.record('timetable.term.update', userId, id, data);
    return { term: await this.term(id), unplaced: report };
  }

  async deleteTerm(id: number, userId: number) {
    const term = await this.term(id);
    if (term.status === TermStatus.Published)
      throw new BadRequestException(
        'Unpublish the timetable before deleting the term.',
      );
    await this.terms.delete(id);
    await this.record('timetable.term.delete', userId, id, { name: term.name });
  }

  /** Replaces the day's periods. Sessions that no longer fit (e.g. a period became a break) are unplaced. */
  async savePeriods(termId: number, body: unknown, userId: number) {
    const list = parse(periodsSchema, body);
    await this.term(termId);
    await this.tx(async (em) => {
      const existing = await em.find(TtPeriod, {
        where: { term: { id: termId } },
      });
      const keep = new Set(list.map((p) => p.id).filter(Boolean));
      const removed = existing.filter((p) => !keep.has(p.id)).map((p) => p.id);
      if (removed.length) {
        await em.update(
          TtSession,
          { startPeriod: { id: In(removed) } },
          { day: null, startPeriod: null, room: null },
        );
        await em.delete(TtPeriod, { id: In(removed) });
      }
      for (const [i, p] of list.entries()) {
        if (p.id && !existing.some((e) => e.id === p.id))
          throw new BadRequestException('A period belongs to another term.');
        const values = {
          sortOrder: i,
          startsAt: p.startsAt,
          endsAt: p.endsAt,
          isBreak: p.isBreak,
          label: p.label,
        };
        if (p.id) await em.update(TtPeriod, p.id, values);
        else
          await em.save(
            em.create(TtPeriod, { term: { id: termId }, ...values }),
          );
      }
    });
    const unplaced = await this.reconcile(termId, []);
    await this.record('timetable.periods.update', userId, termId, {
      periods: list.length,
    });
    return { unplaced };
  }

  async setStatus(id: number, status: TermStatus, userId: number) {
    await this.term(id);
    await this.terms.update(id, {
      status,
      publishedAt: status === TermStatus.Published ? new Date() : null,
    });
    await this.record(
      status === TermStatus.Published
        ? 'timetable.publish'
        : 'timetable.unpublish',
      userId,
      id,
    );
    return this.term(id);
  }

  // ================================================================ lessons

  async saveLesson(
    termId: number,
    id: number | null,
    body: unknown,
    userId: number,
  ) {
    const data = parse(lessonSchema, body);
    await this.term(termId);
    const [unit, lecturer, classes, periods] = await Promise.all([
      this.units.findOneBy({ id: data.unitId }),
      this.lecturers.findOneBy({ id: data.lecturerId }),
      this.classes.findBy({ id: In(data.classIds) }),
      this.periods.find({ where: { term: { id: termId } } }),
    ]);
    if (!unit) throw new BadRequestException('Unit not found.');
    if (!lecturer) throw new BadRequestException('Lecturer not found.');
    if (classes.length !== new Set(data.classIds).size)
      throw new BadRequestException('Class not found.');
    const teaching = periods.filter((p) => !p.isBreak).length;
    if (data.length > teaching)
      throw new BadRequestException(
        `A day has only ${teaching} teaching periods.`,
      );

    const lessonId = await this.tx(async (em) => {
      let lesson: TtLesson;
      if (id) {
        const found = await em.findOne(TtLesson, {
          where: { id, term: { id: termId } },
        });
        if (!found) throw new NotFoundException('Lesson not found.');
        lesson = found;
      } else lesson = em.create(TtLesson, { term: { id: termId } });
      Object.assign(lesson, {
        unit,
        lecturer,
        classes,
        sessionsPerWeek: data.sessionsPerWeek,
        length: data.length,
        roomType: data.roomType,
        notes: data.notes,
      });
      lesson = await em.save(lesson);
      // Match the number of sessions to sessionsPerWeek: add unplaced ones, or remove unplaced ones first.
      const sessions = await em.find(TtSession, {
        where: { lesson: { id: lesson.id } },
        order: { id: 'ASC' },
      });
      for (let i = sessions.length; i < data.sessionsPerWeek; i++)
        await em.save(em.create(TtSession, { lesson, term: { id: termId } }));
      if (sessions.length > data.sessionsPerWeek) {
        const extra = [...sessions]
          .sort(
            (a, b) =>
              Number(a.day !== null) - Number(b.day !== null) || b.id - a.id,
          )
          .slice(0, sessions.length - data.sessionsPerWeek);
        await em.delete(TtSession, { id: In(extra.map((s) => s.id)) });
      }
      return lesson.id;
    });
    // Its placed sessions keep their slots only if they still follow every rule (new lecturer, bigger class…).
    const unplaced = await this.reconcile(termId, [lessonId]);
    await this.record(
      id ? 'timetable.lesson.update' : 'timetable.lesson.create',
      userId,
      termId,
      { lessonId },
    );
    return { lessonId, unplaced };
  }

  async deleteLesson(termId: number, id: number, userId: number) {
    const lesson = await this.lessons.findOne({
      where: { id, term: { id: termId } },
    });
    if (!lesson) throw new NotFoundException('Lesson not found.');
    await this.lessons.delete(id);
    await this.record('timetable.lesson.delete', userId, termId, {
      lessonId: id,
    });
  }

  // ================================================================ the timetable

  /** Everything the timetable editor needs for one term. */
  async board(termId: number) {
    const term = await this.term(termId);
    const { model, lessons } = await this.load(termId);
    const tt = new Timetable(model);
    const res = await this.resources();
    return {
      term,
      periods: model.periods,
      ...res,
      lessons: lessons.map((l) => ({
        id: l.id,
        unitId: l.unit.id,
        lecturerId: l.lecturer.id,
        classIds: l.classes.map((c) => c.id),
        sessionsPerWeek: l.sessionsPerWeek,
        length: l.length,
        roomType: l.roomType,
        effectiveRoomType: l.roomType ?? l.unit.roomType,
        notes: l.notes,
      })),
      sessions: [...tt.sessions.values()],
      issues: tt.audit().map((i) => ({
        sessionId: i.sessionId,
        problems: i.conflicts.map((c) => c.message),
      })),
    };
  }

  /** Where a session can go: each day and period, the free rooms or the reasons it is blocked. */
  async options(termId: number, sessionId: number) {
    const { model } = await this.load(termId);
    const tt = new Timetable(model);
    if (!tt.sessions.has(sessionId))
      throw new NotFoundException('Session not found.');
    return tt.options(sessionId);
  }

  async place(
    termId: number,
    sessionId: number,
    body: unknown,
    userId: number,
  ) {
    const at = parse(placeSchema, body);
    const { model } = await this.load(termId);
    const tt = new Timetable(model);
    if (!tt.sessions.has(sessionId))
      throw new NotFoundException('Session not found.');
    try {
      tt.place(sessionId, {
        day: at.day,
        startPeriodId: at.periodId,
        roomId: at.roomId,
      });
    } catch (err) {
      if (err instanceof ConflictError)
        throw new ConflictException({
          message: err.message,
          code: 'TIMETABLE_CLASH',
          conflicts: err.conflicts.map((c) => c.message),
        });
      throw err;
    }
    await this.persist(termId, tt, [sessionId]);
    await this.record('timetable.session.place', userId, termId, {
      sessionId,
      day: DAY_NAMES[at.day],
      periodId: at.periodId,
      roomId: at.roomId,
    });
    return {
      warnings: tt.warnings(tt.sessions.get(sessionId)!, {
        day: at.day,
        startPeriodId: at.periodId,
        roomId: at.roomId,
      }),
    };
  }

  async unplace(termId: number, sessionId: number, userId: number) {
    const { model } = await this.load(termId);
    const tt = new Timetable(model);
    if (!tt.sessions.has(sessionId))
      throw new NotFoundException('Session not found.');
    tt.unplace(sessionId);
    await this.persist(termId, tt, [sessionId]);
    await this.record('timetable.session.unplace', userId, termId, {
      sessionId,
    });
  }

  async lock(termId: number, sessionId: number, locked: boolean) {
    const s = await this.sessions.findOne({
      where: { id: sessionId, term: { id: termId } },
    });
    if (!s) throw new NotFoundException('Session not found.');
    await this.sessions.update(sessionId, { locked });
  }

  /** Fills the timetable automatically. `rebuild` re-places every unlocked session; otherwise only unplaced ones. */
  async generate(termId: number, rebuild: boolean, userId: number) {
    const { model } = await this.load(termId);
    const tt = new Timetable(model);
    const started = Date.now();
    const result = tt.generate({ rebuild, timeLimitMs: 6000 });
    await this.persist(termId, tt, [...result.positions.keys()]);
    await this.record('timetable.generate', userId, termId, {
      rebuild,
      placed: result.placed,
      unplaced: result.unplaced.length,
    });
    return {
      placed: result.placed,
      unplaced: result.unplaced,
      seconds: Math.round((Date.now() - started) / 100) / 10,
    };
  }

  // ================================================================ public view

  /** Published timetables, for the public /timetable page. */
  async publicTerms() {
    const terms = await this.terms.find({
      where: { status: TermStatus.Published },
      order: { startsOn: 'DESC' },
    });
    return terms.map(({ id, name, startsOn, endsOn }) => ({
      id,
      name,
      startsOn,
      endsOn,
    }));
  }

  /** A published timetable with only what visitors need: no notes, emails or availability. */
  async publicTimetable(termId: number) {
    const term = await this.terms.findOneBy({
      id: termId,
      status: TermStatus.Published,
    });
    if (!term) throw new NotFoundException('Timetable not found.');
    const { model, lessons } = await this.load(termId);
    const placed = model.sessions.filter((s) => s.day !== null);
    const used = (pick: (l: TtLesson) => number[]) =>
      new Set(
        placed.flatMap((s) => pick(lessons.find((l) => l.id === s.lessonId)!)),
      );
    const classIds = used((l) => l.classes.map((c) => c.id));
    const lecturerIds = used((l) => [l.lecturer.id]);
    const roomIds = new Set(placed.map((s) => s.roomId!));
    return {
      term: {
        id: term.id,
        name: term.name,
        startsOn: term.startsOn,
        endsOn: term.endsOn,
        days: term.days,
        publishedAt: term.publishedAt,
      },
      periods: model.periods,
      classes: model.classes
        .filter((c) => classIds.has(c.id))
        .map(({ id, name }) => ({ id, name })),
      lecturers: model.lecturers
        .filter((l) => lecturerIds.has(l.id))
        .map(({ id, name }) => ({ id, name })),
      rooms: model.rooms
        .filter((r) => roomIds.has(r.id))
        .map(({ id, name }) => ({ id, name })),
      sessions: placed.map((s) => {
        const l = lessons.find((x) => x.id === s.lessonId)!;
        return {
          day: s.day,
          startPeriodId: s.startPeriodId,
          length: l.length,
          unitCode: l.unit.code,
          unitName: l.unit.name,
          lecturerId: l.lecturer.id,
          classIds: l.classes.map((c) => c.id),
          roomId: s.roomId,
        };
      }),
    };
  }

  // ================================================================ internals

  private async term(id: number) {
    const term = await this.terms.findOneBy({ id });
    if (!term) throw new NotFoundException('Term not found.');
    return term;
  }

  /** The term as an engine model, plus the lesson rows (for names). */
  private async load(
    termId: number,
  ): Promise<{ model: Model; lessons: TtLesson[] }> {
    const term = await this.term(termId);
    const [periods, rooms, lecturers, classes, lessons, sessions] =
      await Promise.all([
        this.periods.find({
          where: { term: { id: termId } },
          order: { sortOrder: 'ASC' },
        }),
        this.rooms.find(),
        this.lecturers.find(),
        this.classes.find(),
        this.lessons.find({
          where: { term: { id: termId } },
          relations: { unit: true, lecturer: true, classes: true },
          order: { id: 'ASC' },
        }),
        this.sessions.find({
          where: { term: { id: termId } },
          relations: { lesson: true, startPeriod: true, room: true },
          order: { id: 'ASC' },
        }),
      ]);
    const model: Model = {
      days: term.days,
      periods: periods.map(({ id, startsAt, endsAt, isBreak, label }) => ({
        id,
        startsAt,
        endsAt,
        isBreak,
        label,
      })),
      rooms,
      lecturers,
      classes,
      lessons: lessons.map((l) => ({
        id: l.id,
        label: `${l.unit.code} (${l.classes.map((c) => c.name).join(', ')})`,
        roomType: l.roomType ?? l.unit.roomType,
        lecturerId: l.lecturer.id,
        classIds: l.classes.map((c) => c.id),
        length: l.length,
      })),
      sessions: sessions.map((s) => ({
        id: s.id,
        lessonId: s.lesson.id,
        day: s.startPeriod && s.room ? s.day : null,
        startPeriodId:
          s.day !== null && s.room ? (s.startPeriod?.id ?? null) : null,
        roomId: s.day !== null && s.startPeriod ? (s.room?.id ?? null) : null,
        locked: s.locked,
      })),
    };
    return { model, lessons };
  }

  /**
   * Re-checks every placed session after the rules changed (periods, days, a lesson's details).
   * Sessions are re-placed one by one, others first and `last` (the edited lessons) at the end, so the
   * edited lesson gives way. Anything that no longer fits becomes unplaced. Returns those sessions.
   */
  private async reconcile(termId: number, last: number[]) {
    const { model } = await this.load(termId);
    const before = new Map(model.sessions.map((s) => [s.id, { ...s }]));
    const empty = new Timetable({
      ...model,
      sessions: model.sessions.map((s) => ({
        ...s,
        day: null,
        startPeriodId: null,
        roomId: null,
      })),
    });
    const order = [...before.values()]
      .filter((s) => s.day !== null)
      .sort(
        (a, b) =>
          Number(last.includes(a.lessonId)) -
            Number(last.includes(b.lessonId)) || a.id - b.id,
      );
    const lost: { sessionId: number; reason: string }[] = [];
    for (const s of order) {
      const at: Placement = {
        day: s.day!,
        startPeriodId: s.startPeriodId!,
        roomId: s.roomId!,
      };
      const c = empty.conflicts(empty.sessions.get(s.id)!, at);
      if (c.length)
        lost.push({
          sessionId: s.id,
          reason: c.map((x) => x.message).join(' '),
        });
      else empty.place(s.id, at);
    }
    await this.persist(termId, empty, [...before.keys()]);
    return lost;
  }

  /** Writes the given sessions' positions and their occupancy rows in one transaction. */
  private async persist(termId: number, tt: Timetable, sessionIds: number[]) {
    if (!sessionIds.length) return;
    try {
      await this.tx(async (em) => {
        await em.delete(TtSlot, { session: { id: In(sessionIds) } });
        const rows: Partial<TtSlot>[] = [];
        for (const id of sessionIds) {
          const s = tt.sessions.get(id)!;
          await em.update(TtSession, id, {
            day: s.day,
            startPeriod: s.startPeriodId ? { id: s.startPeriodId } : null,
            room: s.roomId ? { id: s.roomId } : null,
          });
          for (const slot of tt.slotsOf(id))
            rows.push({
              term: { id: termId } as TtTerm,
              session: { id } as TtSession,
              day: slot.day,
              period: { id: slot.periodId } as TtPeriod,
              kind: slot.kind,
              resourceId: slot.resourceId,
            });
        }
        for (let i = 0; i < rows.length; i += 500)
          await em.insert(TtSlot, rows.slice(i, i + 500));
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'ER_DUP_ENTRY')
        throw new ConflictException({
          message:
            'Someone else changed the timetable at the same moment. Reload and try again.',
          code: 'TIMETABLE_CLASH',
        });
      throw err;
    }
  }

  private async saveResource<T extends { id: number }>(
    repo: Repository<T>,
    kind: string,
    id: number | null,
    data: object,
    userId: number,
  ) {
    if (id && !(await repo.exists({ where: { id } as never })))
      throw new NotFoundException(`The ${kind} was not found.`);
    const saved = (await repo.save({
      ...(id ? { id } : {}),
      ...data,
    } as never)) as unknown as T;
    await this.record(
      `timetable.${kind}.${id ? 'update' : 'create'}`,
      userId,
      null,
      {
        id: saved.id,
      },
    );
    return saved;
  }

  private async unique<T extends { id: number }>(
    repo: Repository<T>,
    field: string,
    value: string,
    id: number | null,
    message: string,
  ) {
    const clash = await repo.findOne({ where: { [field]: value } as never });
    if (clash && clash.id !== id) throw new ConflictException(message);
  }

  private record(
    action: string,
    userId: number,
    termId: number | null,
    details?: object,
  ) {
    return this.audit.record({
      action,
      userId,
      entityType: 'timetable',
      entityId: termId ?? undefined,
      details: details as Record<string, unknown> | undefined,
    });
  }

  private tx<T>(work: (em: EntityManager) => Promise<T>): Promise<T> {
    return withDeadlockRetry(() => this.dataSource.transaction(work));
  }
}
