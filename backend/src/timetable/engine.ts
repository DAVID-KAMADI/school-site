/**
 * Timetable rules and automatic scheduling, independent of the database.
 *
 * Hard rules (never broken, by hand or by the generator):
 *  - a room, a lecturer and a class are each in at most one place per period;
 *  - a session lies on a teaching day, inside the day, and never runs across a break;
 *  - the room holds all students of the lesson and is of the kind the unit needs;
 *  - the lecturer is available and within their daily limit.
 * Soft preferences (the generator works towards them): a unit's sessions on different days,
 * compact days for classes, an even load across the week, the best-fitting room, earlier periods.
 *
 * The generator is a constructive heuristic, the usual approach for course timetabling:
 * hardest sessions first, each placed at its cheapest legal slot, a repair pass that moves one
 * blocking session to make room, and several attempts with different orderings, keeping the best.
 */
import type { RoomType, Unavailability } from './entities/resources.entity.js';

export interface EPeriod {
  id: number;
  startsAt: string;
  endsAt: string;
  isBreak: boolean;
  label?: string | null;
}
export interface ERoom {
  id: number;
  name: string;
  capacity: number;
  type: RoomType;
  isActive: boolean;
}
export interface ELecturer {
  id: number;
  name: string;
  maxPeriodsPerDay: number | null;
  unavailable: Unavailability[];
  isActive: boolean;
}
export interface EClass {
  id: number;
  name: string;
  size: number;
  isActive: boolean;
}
export interface ELesson {
  id: number;
  label: string;
  /** Room type the lesson needs; null = an ordinary classroom. */
  roomType: RoomType | null;
  lecturerId: number;
  classIds: number[];
  length: number;
}
export interface ESession {
  id: number;
  lessonId: number;
  day: number | null;
  startPeriodId: number | null;
  roomId: number | null;
  locked: boolean;
}
export interface Model {
  days: number[];
  /** In order through the day, breaks included. */
  periods: EPeriod[];
  rooms: ERoom[];
  lecturers: ELecturer[];
  classes: EClass[];
  lessons: ELesson[];
  sessions: ESession[];
}

export type ConflictCode =
  | 'day'
  | 'span'
  | 'room-busy'
  | 'room-capacity'
  | 'room-type'
  | 'room-inactive'
  | 'lecturer-busy'
  | 'lecturer-unavailable'
  | 'lecturer-max'
  | 'lecturer-inactive'
  | 'class-busy'
  | 'class-inactive';

export interface Conflict {
  code: ConflictCode;
  message: string;
  /** Sessions in the way (for "busy" conflicts). */
  sessionIds?: number[];
}

export interface Placement {
  day: number;
  startPeriodId: number;
  roomId: number;
}

export interface SlotOption {
  day: number;
  periodId: number;
  /** Rooms the session can use here, best fit first. Empty = the slot is blocked. */
  roomIds: number[];
  /** Why the slot cannot be used (when roomIds is empty). */
  reasons: string[];
  /** Allowed but not ideal, e.g. the unit already meets that day. */
  warnings: string[];
}

export interface GenerateResult {
  placed: number;
  unplaced: { sessionId: number; reason: string }[];
  /** Every movable session's final position (null = could not be placed). */
  positions: Map<number, Placement | null>;
}

export const DAY_NAMES = [
  '',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

type Kind = 'room' | 'lecturer' | 'class';
const key = (kind: Kind, id: number, day: number, periodId: number) =>
  `${kind}:${id}:${day}:${periodId}`;

/** Live state of one term's timetable: who is where, and the rules for changing it. */
export class Timetable {
  private readonly periodIndex = new Map<number, number>();
  private readonly rooms = new Map<number, ERoom>();
  private readonly lecturers = new Map<number, ELecturer>();
  private readonly classes = new Map<number, EClass>();
  private readonly lessons = new Map<number, ELesson>();
  readonly sessions = new Map<number, ESession>();
  /** "kind:id:day:period" -> session occupying it. */
  private occupancy = new Map<string, number>();

  constructor(readonly model: Model) {
    model.periods.forEach((p, i) => this.periodIndex.set(p.id, i));
    for (const r of model.rooms) this.rooms.set(r.id, r);
    for (const l of model.lecturers) this.lecturers.set(l.id, l);
    for (const c of model.classes) this.classes.set(c.id, c);
    for (const l of model.lessons) this.lessons.set(l.id, l);
    for (const s of model.sessions) {
      this.sessions.set(s.id, { ...s });
      if (s.day !== null && s.startPeriodId !== null && s.roomId !== null) {
        const span = this.span(s.startPeriodId, this.lesson(s).length);
        if (span) this.mark(s, s.day, span, s.roomId);
      }
    }
  }

  // ------------------------------------------------------------ rules

  lesson(s: ESession): ELesson {
    return this.lessons.get(s.lessonId)!;
  }

  /** Students in a lesson (all its classes together). */
  size(lesson: ELesson): number {
    return lesson.classIds.reduce(
      (n, id) => n + (this.classes.get(id)?.size ?? 0),
      0,
    );
  }

  /** The periods a session starting at `startPeriodId` covers, or null if it would cross a break or the day's end. */
  span(startPeriodId: number, length: number): EPeriod[] | null {
    const start = this.periodIndex.get(startPeriodId);
    if (start === undefined) return null;
    const out = this.model.periods.slice(start, start + length);
    if (out.length < length || out.some((p) => p.isBreak)) return null;
    return out;
  }

  /** Rooms of the right kind and size for a lesson, smallest first. */
  suitableRooms(lesson: ELesson): ERoom[] {
    const need = this.size(lesson);
    const type = lesson.roomType ?? 'classroom';
    return [...this.rooms.values()]
      .filter((r) => r.isActive && r.type === type && r.capacity >= need)
      .sort((a, b) => a.capacity - b.capacity || a.id - b.id);
  }

  /**
   * Every hard rule a placement would break. Sessions in `ignore` are treated as absent
   * (always including the session itself, so it can be moved).
   */
  conflicts(
    s: ESession,
    at: Placement,
    ignore: Set<number> = new Set(),
  ): Conflict[] {
    const lesson = this.lesson(s);
    const out: Conflict[] = [];
    const skip = new Set(ignore).add(s.id);
    if (!this.model.days.includes(at.day))
      return [
        { code: 'day', message: `${DAY_NAMES[at.day]} is not a teaching day.` },
      ];
    const span = this.span(at.startPeriodId, lesson.length);
    if (!span)
      return [
        {
          code: 'span',
          message:
            lesson.length > 1
              ? `A ${lesson.length}-period session starting here would run into a break or past the end of the day.`
              : 'This period is a break.',
        },
      ];

    const room = this.rooms.get(at.roomId);
    if (!room || !room.isActive)
      out.push({ code: 'room-inactive', message: 'This room is not in use.' });
    else {
      const need = this.size(lesson);
      if (room.capacity < need)
        out.push({
          code: 'room-capacity',
          message: `${room.name} holds ${room.capacity}; this lesson has ${need} students.`,
        });
      const type = lesson.roomType ?? 'classroom';
      if (room.type !== type)
        out.push({
          code: 'room-type',
          message: `${lesson.label} needs a ${type.replace('_', ' ')}; ${room.name} is a ${room.type.replace('_', ' ')}.`,
        });
    }

    const busy = (kind: Kind, id: number) => {
      const ids = new Set<number>();
      for (const p of span) {
        const other = this.occupancy.get(key(kind, id, at.day, p.id));
        if (other !== undefined && !skip.has(other)) ids.add(other);
      }
      return [...ids];
    };
    const describe = (ids: number[]) =>
      ids.map((id) => this.lesson(this.sessions.get(id)!).label).join(', ');

    const inRoom = busy('room', at.roomId);
    if (inRoom.length)
      out.push({
        code: 'room-busy',
        message: `${room?.name ?? 'The room'} is already used by ${describe(inRoom)}.`,
        sessionIds: inRoom,
      });

    const lecturer = this.lecturers.get(lesson.lecturerId);
    if (!lecturer?.isActive)
      out.push({
        code: 'lecturer-inactive',
        message: `${lecturer?.name ?? 'The lecturer'} is marked as not teaching.`,
      });
    const lecturerBusy = busy('lecturer', lesson.lecturerId);
    if (lecturerBusy.length)
      out.push({
        code: 'lecturer-busy',
        message: `${lecturer?.name ?? 'The lecturer'} is already teaching ${describe(lecturerBusy)}.`,
        sessionIds: lecturerBusy,
      });
    if (lecturer) {
      const clash = lecturer.unavailable.find(
        (u) =>
          u.day === at.day &&
          span.some((p) => p.startsAt < u.to && p.endsAt > u.from),
      );
      if (clash)
        out.push({
          code: 'lecturer-unavailable',
          message: `${lecturer.name} is not available on ${DAY_NAMES[at.day]} ${clash.from}–${clash.to}.`,
        });
      if (lecturer.maxPeriodsPerDay !== null) {
        const already = this.load('lecturer', lecturer.id, at.day, skip);
        if (already + span.length > lecturer.maxPeriodsPerDay)
          out.push({
            code: 'lecturer-max',
            message: `${lecturer.name} would teach ${already + span.length} periods on ${DAY_NAMES[at.day]} (limit ${lecturer.maxPeriodsPerDay}).`,
          });
      }
    }

    for (const classId of lesson.classIds) {
      const cls = this.classes.get(classId);
      if (!cls?.isActive)
        out.push({
          code: 'class-inactive',
          message: `${cls?.name ?? 'A class'} is marked as not active.`,
        });
      const ids = busy('class', classId);
      if (ids.length)
        out.push({
          code: 'class-busy',
          message: `${cls?.name ?? 'The class'} already has ${describe(ids)} at this time.`,
          sessionIds: ids,
        });
    }
    return out;
  }

  /** Allowed but not ideal: the unit already meets that day. */
  warnings(s: ESession, at: Placement): string[] {
    const twin = [...this.sessions.values()].find(
      (o) => o.id !== s.id && o.lessonId === s.lessonId && o.day === at.day,
    );
    return twin
      ? [`${this.lesson(s).label} already meets on ${DAY_NAMES[at.day]}.`]
      : [];
  }

  /** For each day and starting period: can the session go there, in which rooms, and if not, why. */
  options(sessionId: number): SlotOption[] {
    const s = this.sessions.get(sessionId)!;
    const rooms = this.suitableRooms(this.lesson(s));
    const all = [...this.rooms.values()].filter((r) => r.isActive);
    const out: SlotOption[] = [];
    for (const day of this.model.days) {
      for (const p of this.model.periods) {
        if (p.isBreak) continue;
        const ok: number[] = [];
        let firstReasons: string[] | null = null;
        // Rooms that fit first; then the rest, only to explain why nothing fits.
        for (const room of rooms) {
          const c = this.conflicts(s, {
            day,
            startPeriodId: p.id,
            roomId: room.id,
          });
          if (!c.length) ok.push(room.id);
          else firstReasons ??= c.map((x) => x.message);
        }
        let reasons: string[] = [];
        if (!ok.length) {
          if (!rooms.length)
            reasons = [
              `No active ${(this.lesson(s).roomType ?? 'classroom').replace('_', ' ')} holds ${this.size(this.lesson(s))} students.`,
            ];
          else {
            // Prefer reasons that are not about rooms (lecturer/class), which no room can fix.
            const probe = this.conflicts(s, {
              day,
              startPeriodId: p.id,
              roomId: rooms[0]?.id ?? all[0]?.id ?? 0,
            }).filter((c) => !c.code.startsWith('room'));
            reasons = probe.length
              ? probe.map((c) => c.message)
              : rooms.length === 1
                ? (firstReasons ?? [])
                : ['Every suitable room is already in use.'];
          }
        }
        out.push({
          day,
          periodId: p.id,
          roomIds: ok,
          reasons,
          warnings: ok.length
            ? this.warnings(s, { day, startPeriodId: p.id, roomId: ok[0] })
            : [],
        });
      }
    }
    return out;
  }

  // ------------------------------------------------------------ changes

  /** Places (or moves) a session. Throws if any hard rule would break. */
  place(sessionId: number, at: Placement): void {
    const s = this.sessions.get(sessionId)!;
    const c = this.conflicts(s, at);
    if (c.length) throw new ConflictError(c);
    this.unplace(sessionId);
    this.mark(
      s,
      at.day,
      this.span(at.startPeriodId, this.lesson(s).length)!,
      at.roomId,
    );
    Object.assign(s, at);
  }

  unplace(sessionId: number): void {
    const s = this.sessions.get(sessionId)!;
    if (s.day === null || s.startPeriodId === null || s.roomId === null) return;
    for (const [k, v] of this.occupancy)
      if (v === sessionId) this.occupancy.delete(k);
    s.day = s.startPeriodId = s.roomId = null;
  }

  isPlaced(s: ESession): boolean {
    return s.day !== null && s.startPeriodId !== null && s.roomId !== null;
  }

  /** Rows for the occupancy table: room, lecturer and every class, for each period the session covers. */
  slotsOf(
    sessionId: number,
  ): { day: number; periodId: number; kind: Kind; resourceId: number }[] {
    const s = this.sessions.get(sessionId)!;
    if (!this.isPlaced(s)) return [];
    const lesson = this.lesson(s);
    const span = this.span(s.startPeriodId!, lesson.length) ?? [];
    return span.flatMap((p) => [
      {
        day: s.day!,
        periodId: p.id,
        kind: 'room' as const,
        resourceId: s.roomId!,
      },
      {
        day: s.day!,
        periodId: p.id,
        kind: 'lecturer' as const,
        resourceId: lesson.lecturerId,
      },
      ...lesson.classIds.map((id) => ({
        day: s.day!,
        periodId: p.id,
        kind: 'class' as const,
        resourceId: id,
      })),
    ]);
  }

  /** Every hard rule broken by the current timetable (after rooms, lecturers or periods were edited). */
  audit(): { sessionId: number; conflicts: Conflict[] }[] {
    const out: { sessionId: number; conflicts: Conflict[] }[] = [];
    for (const s of this.sessions.values()) {
      if (!this.isPlaced(s)) continue;
      const c = this.conflicts(s, {
        day: s.day!,
        startPeriodId: s.startPeriodId!,
        roomId: s.roomId!,
      });
      if (c.length) out.push({ sessionId: s.id, conflicts: c });
    }
    return out;
  }

  // ------------------------------------------------------------ generator

  /**
   * Places sessions automatically. Locked sessions never move. With `rebuild`, every other
   * session is placed again from scratch; otherwise only unplaced sessions are added.
   */
  generate(
    opts: { rebuild?: boolean; attempts?: number; timeLimitMs?: number } = {},
  ): GenerateResult {
    const attempts = opts.attempts ?? 30;
    const deadline = Date.now() + (opts.timeLimitMs ?? 4000);
    const movable = [...this.sessions.values()].filter(
      (s) => !s.locked && (opts.rebuild || !this.isPlaced(s)),
    );
    if (opts.rebuild) for (const s of movable) this.unplace(s.id);

    // How many legal places each session has on the starting grid: fewest go first.
    const freedom = new Map<number, number>();
    for (const s of movable) freedom.set(s.id, this.candidates(s).length);
    const baseOrder = [...movable].sort((a, b) => {
      const la = this.lesson(a);
      const lb = this.lesson(b);
      return (
        freedom.get(a.id)! - freedom.get(b.id)! ||
        lb.length - la.length ||
        this.size(lb) - this.size(la) ||
        a.id - b.id
      );
    });

    let best: {
      state: Timetable;
      unplaced: ESession[];
      penalty: number;
    } | null = null;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0 && Date.now() > deadline) break;
      const state = this.clone();
      const order = attempt === 0 ? baseOrder : jitter(baseOrder, attempt);
      const unplaced: ESession[] = [];
      for (const s0 of order) {
        const s = state.sessions.get(s0.id)!;
        const c = state.cheapest(s);
        if (c) state.place(s.id, c.at);
        else unplaced.push(s);
      }
      const stillUnplaced = unplaced.filter((s) => !state.repair(s));
      const penalty = state.totalPenalty();
      if (
        !best ||
        stillUnplaced.length < best.unplaced.length ||
        (stillUnplaced.length === best.unplaced.length &&
          penalty < best.penalty)
      )
        best = { state, unplaced: stillUnplaced, penalty };
      // Everything fits: a few more orderings may still find a nicer week, then stop.
      if (!best.unplaced.length && attempt >= 5) break;
    }

    const result = best!.state;
    this.occupancy = result.occupancy;
    for (const s of this.sessions.values())
      Object.assign(s, result.sessions.get(s.id));
    const positions = new Map<number, Placement | null>();
    for (const s of movable) {
      const now = this.sessions.get(s.id)!;
      positions.set(
        s.id,
        this.isPlaced(now)
          ? {
              day: now.day!,
              startPeriodId: now.startPeriodId!,
              roomId: now.roomId!,
            }
          : null,
      );
    }
    return {
      placed: movable.length - best!.unplaced.length,
      unplaced: best!.unplaced.map((s) => ({
        sessionId: s.id,
        reason: this.whyNot(s),
      })),
      positions,
    };
  }

  /** Legal placements for a session right now, each with its soft-rule cost. */
  private candidates(s: ESession): { at: Placement; cost: number }[] {
    const lesson = this.lesson(s);
    const rooms = this.suitableRooms(lesson);
    const out: { at: Placement; cost: number }[] = [];
    for (const day of this.model.days) {
      for (const p of this.model.periods) {
        if (p.isBreak || !this.span(p.id, lesson.length)) continue;
        // Rooms are smallest first, so the first free one is the best fit.
        for (const room of rooms) {
          const at = { day, startPeriodId: p.id, roomId: room.id };
          const c = this.conflicts(s, at);
          if (c.length) {
            if (c.some((x) => !x.code.startsWith('room'))) break; // no room can fix it
            continue;
          }
          out.push({ at, cost: this.cost(s, at, room) });
          break;
        }
      }
    }
    return out;
  }

  private cheapest(s: ESession) {
    let best: { at: Placement; cost: number } | null = null;
    for (const c of this.candidates(s))
      if (!best || c.cost < best.cost) best = c;
    return best;
  }

  /** Soft-rule cost of a placement: lower is better. */
  private cost(s: ESession, at: Placement, room: ERoom): number {
    const lesson = this.lesson(s);
    const span = this.span(at.startPeriodId, lesson.length)!;
    const first = this.periodIndex.get(span[0].id)!;
    const last = first + span.length - 1;
    let cost = 0;
    // The same unit twice in a day is the strongest preference to avoid.
    for (const o of this.sessions.values())
      if (o.id !== s.id && o.lessonId === s.lessonId && o.day === at.day)
        cost += 60;
    for (const classId of lesson.classIds) {
      const load = this.load('class', classId, at.day);
      cost += load * 2; // spread a class's week evenly
      if (load > 0) {
        // Compact days: next to the class's other sessions, not leaving gaps.
        const before = this.periodAt(first - 1);
        const after = this.periodAt(last + 1);
        const adjacent =
          (before &&
            this.occupancy.has(key('class', classId, at.day, before.id))) ||
          (after &&
            this.occupancy.has(key('class', classId, at.day, after.id)));
        cost += adjacent ? -3 : 4;
      }
    }
    cost += this.load('lecturer', lesson.lecturerId, at.day); // spread lecturers' days too
    cost += ((room.capacity - this.size(lesson)) / room.capacity) * 3; // best-fitting room
    cost += first * 0.3; // earlier in the day
    return cost;
  }

  private totalPenalty(): number {
    let total = 0;
    for (const s of this.sessions.values()) {
      if (!this.isPlaced(s)) continue;
      const at = {
        day: s.day!,
        startPeriodId: s.startPeriodId!,
        roomId: s.roomId!,
      };
      total += this.cost(s, at, this.rooms.get(s.roomId!)!);
    }
    return total;
  }

  /** Tries to fit `s` by moving one unlocked session that blocks it somewhere else. */
  private repair(s: ESession): boolean {
    const lesson = this.lesson(s);
    const rooms = this.suitableRooms(lesson);
    for (const day of this.model.days) {
      for (const p of this.model.periods) {
        if (p.isBreak || !this.span(p.id, lesson.length)) continue;
        for (const room of rooms) {
          const at = { day, startPeriodId: p.id, roomId: room.id };
          const c = this.conflicts(s, at);
          if (c.some((x) => !x.code.endsWith('-busy'))) continue;
          const blockers = new Set(c.flatMap((x) => x.sessionIds ?? []));
          if (blockers.size !== 1) continue;
          const blocker = this.sessions.get([...blockers][0])!;
          if (blocker.locked) continue;
          const was = {
            day: blocker.day!,
            startPeriodId: blocker.startPeriodId!,
            roomId: blocker.roomId!,
          };
          this.unplace(blocker.id);
          this.place(s.id, at);
          const moved = this.cheapest(blocker);
          if (moved) {
            this.place(blocker.id, moved.at);
            return true;
          }
          this.unplace(s.id);
          this.place(blocker.id, was);
        }
      }
    }
    return false;
  }

  /** A short explanation for a session the generator could not place: the rule that blocks it most often. */
  private whyNot(s: ESession): string {
    const lesson = this.lesson(s);
    const rooms = this.suitableRooms(lesson);
    const type = (lesson.roomType ?? 'classroom').replace('_', ' ');
    if (!rooms.length)
      return `No active ${type} holds ${this.size(lesson)} students.`;
    const lecturer =
      this.lecturers.get(lesson.lecturerId)?.name ?? 'The lecturer';
    const counts = new Map<ConflictCode, number>();
    for (const day of this.model.days)
      for (const p of this.model.periods) {
        if (p.isBreak) continue;
        const at = { day, startPeriodId: p.id, roomId: rooms[0].id };
        const codes = new Set<ConflictCode>(
          this.conflicts(s, at)
            .map((c) => c.code)
            .filter((c) => c !== 'room-busy'),
        );
        if (
          rooms.every((r) =>
            this.conflicts(s, { ...at, roomId: r.id }).some(
              (c) => c.code === 'room-busy',
            ),
          )
        )
          codes.add('room-busy');
        for (const c of codes) counts.set(c, (counts.get(c) ?? 0) + 1);
      }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const why: Partial<Record<ConflictCode, string>> = {
      'class-busy':
        'the class is already busy at the times the lecturer and a room are free',
      'lecturer-busy': `${lecturer} is teaching at the times the class and a room are free`,
      'lecturer-unavailable': `${lecturer} is unavailable at the remaining free times`,
      'lecturer-max': `${lecturer} has reached the daily limit`,
      'lecturer-inactive': `${lecturer} is marked as not teaching`,
      'class-inactive': 'a class in this lesson is marked as not active',
      'room-busy': `every suitable ${type} is booked when the class and lecturer are free`,
      span: `a ${lesson.length}-period session does not fit between the breaks`,
    };
    return top
      ? `No free slot: ${why[top] ?? 'every slot has a clash'}.`
      : 'No free slot without a clash.';
  }

  // ------------------------------------------------------------ helpers

  private mark(s: ESession, day: number, span: EPeriod[], roomId: number) {
    const lesson = this.lesson(s);
    for (const p of span) {
      this.occupancy.set(key('room', roomId, day, p.id), s.id);
      this.occupancy.set(key('lecturer', lesson.lecturerId, day, p.id), s.id);
      for (const c of lesson.classIds)
        this.occupancy.set(key('class', c, day, p.id), s.id);
    }
  }

  private load(
    kind: Kind,
    id: number,
    day: number,
    skip: Set<number> = new Set(),
  ): number {
    let n = 0;
    for (const p of this.model.periods) {
      const o = this.occupancy.get(key(kind, id, day, p.id));
      if (o !== undefined && !skip.has(o)) n++;
    }
    return n;
  }

  private periodAt(index: number): EPeriod | undefined {
    return index >= 0 ? this.model.periods.at(index) : undefined;
  }

  private clone(): Timetable {
    const copy = Object.create(Timetable.prototype) as Timetable;
    Object.assign(copy, this, {
      sessions: new Map([...this.sessions].map(([id, s]) => [id, { ...s }])),
      occupancy: new Map(this.occupancy),
    });
    return copy;
  }
}

export class ConflictError extends Error {
  constructor(readonly conflicts: Conflict[]) {
    super(conflicts.map((c) => c.message).join(' '));
  }
}

/** The same order with neighbouring sessions swapped a little (deterministic per attempt). */
function jitter<T>(items: T[], seed: number): T[] {
  const out = items.slice();
  let x = seed * 2654435761;
  const rand = () => {
    x = (x ^ (x << 13)) >>> 0;
    x = (x ^ (x >>> 17)) >>> 0;
    x = (x ^ (x << 5)) >>> 0;
    return x / 4294967296;
  };
  for (let i = 0; i < out.length; i++) {
    const j = Math.min(out.length - 1, i + Math.floor(rand() * 4));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
