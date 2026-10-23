import {
  ConflictError,
  Timetable,
  type ELesson,
  type ESession,
  type Model,
} from './engine.js';

/** A realistic week: 7 teaching periods a day, a tea break and lunch. */
const PERIODS = [
  { id: 1, startsAt: '08:00', endsAt: '09:00', isBreak: false },
  { id: 2, startsAt: '09:00', endsAt: '10:00', isBreak: false },
  { id: 3, startsAt: '10:00', endsAt: '10:30', isBreak: true },
  { id: 4, startsAt: '10:30', endsAt: '11:30', isBreak: false },
  { id: 5, startsAt: '11:30', endsAt: '12:30', isBreak: false },
  { id: 6, startsAt: '12:30', endsAt: '13:30', isBreak: true },
  { id: 7, startsAt: '13:30', endsAt: '14:30', isBreak: false },
  { id: 8, startsAt: '14:30', endsAt: '15:30', isBreak: false },
  { id: 9, startsAt: '15:30', endsAt: '16:30', isBreak: false },
];

function college(): Model {
  const rooms = [
    {
      id: 1,
      name: 'LR1',
      capacity: 40,
      type: 'classroom' as const,
      isActive: true,
    },
    {
      id: 2,
      name: 'LR2',
      capacity: 40,
      type: 'classroom' as const,
      isActive: true,
    },
    {
      id: 3,
      name: 'LR3',
      capacity: 50,
      type: 'classroom' as const,
      isActive: true,
    },
    {
      id: 4,
      name: 'LR4',
      capacity: 60,
      type: 'classroom' as const,
      isActive: true,
    },
    {
      id: 5,
      name: 'LR5',
      capacity: 30,
      type: 'classroom' as const,
      isActive: true,
    },
    {
      id: 6,
      name: 'LR6',
      capacity: 90,
      type: 'classroom' as const,
      isActive: true,
    },
    {
      id: 7,
      name: 'Computer lab A',
      capacity: 40,
      type: 'computer_lab' as const,
      isActive: true,
    },
    {
      id: 8,
      name: 'Computer lab B',
      capacity: 35,
      type: 'computer_lab' as const,
      isActive: true,
    },
    {
      id: 9,
      name: 'Workshop',
      capacity: 30,
      type: 'workshop' as const,
      isActive: true,
    },
  ];
  const classes = [28, 35, 40, 25, 38, 30, 45, 22].map((size, i) => ({
    id: i + 1,
    name: `Class ${i + 1}`,
    size,
    isActive: true,
  }));
  const lecturers = Array.from({ length: 14 }, (_, i) => ({
    id: i + 1,
    name: `Lecturer ${i + 1}`,
    maxPeriodsPerDay: i % 3 === 0 ? 5 : null,
    unavailable: i % 4 === 0 ? [{ day: 5, from: '13:00', to: '17:00' }] : [],
    isActive: true,
  }));
  const lessons: ELesson[] = [];
  const sessions: ESession[] = [];
  let lessonId = 0;
  let sessionId = 0;
  const add = (
    classIds: number[],
    lecturerId: number,
    count: number,
    length = 1,
    roomType: ELesson['roomType'] = null,
  ) => {
    lessons.push({
      id: ++lessonId,
      label: `U${lessonId}`,
      roomType,
      lecturerId,
      classIds,
      length,
    });
    for (let i = 0; i < count; i++)
      sessions.push({
        id: ++sessionId,
        lessonId,
        day: null,
        startPeriodId: null,
        roomId: null,
        locked: false,
      });
  };
  for (const c of classes) {
    const l = (n: number) => ((c.id * 3 + n) % lecturers.length) + 1;
    add([c.id], l(0), 3); // core theory, 3 x 1
    add([c.id], l(1), 2, 2); // double lessons
    add([c.id], l(2), 2);
    add([c.id], l(3), 2, 2, c.size <= 35 ? 'computer_lab' : null);
    add([c.id], l(4), 3);
    add([c.id], l(5), 2);
    if (c.size <= 30) add([c.id], l(6), 1, 2, 'workshop');
  }
  add([1, 2], 14, 2); // combined classes (63 students) need LR6
  return {
    days: [1, 2, 3, 4, 5],
    periods: PERIODS,
    rooms,
    lecturers,
    classes,
    lessons,
    sessions,
  };
}

/** Checks a finished timetable from scratch, without trusting the engine's bookkeeping. */
function verify(model: Model, tt: Timetable) {
  const placed = [...tt.sessions.values()].filter((s) => s.day !== null);
  const covered = (s: ESession) => {
    const lesson = model.lessons.find((l) => l.id === s.lessonId)!;
    const start = model.periods.findIndex((p) => p.id === s.startPeriodId);
    return model.periods.slice(start, start + lesson.length);
  };
  for (const s of placed) {
    const lesson = model.lessons.find((l) => l.id === s.lessonId)!;
    const span = covered(s);
    expect(span).toHaveLength(lesson.length);
    expect(span.some((p) => p.isBreak)).toBe(false);
    const room = model.rooms.find((r) => r.id === s.roomId)!;
    const size = lesson.classIds.reduce(
      (n, id) => n + model.classes.find((c) => c.id === id)!.size,
      0,
    );
    expect(room.capacity).toBeGreaterThanOrEqual(size);
    expect(room.type).toBe(lesson.roomType ?? 'classroom');
    const lecturer = model.lecturers.find((l) => l.id === lesson.lecturerId)!;
    for (const u of lecturer.unavailable)
      if (u.day === s.day)
        expect(span.some((p) => p.startsAt < u.to && p.endsAt > u.from)).toBe(
          false,
        );
  }
  for (const a of placed)
    for (const b of placed) {
      if (a.id >= b.id || a.day !== b.day) continue;
      const overlap = covered(a).some((p) => covered(b).includes(p));
      if (!overlap) continue;
      const la = model.lessons.find((l) => l.id === a.lessonId)!;
      const lb = model.lessons.find((l) => l.id === b.lessonId)!;
      expect(a.roomId).not.toBe(b.roomId);
      expect(la.lecturerId).not.toBe(lb.lecturerId);
      expect(la.classIds.filter((c) => lb.classIds.includes(c))).toEqual([]);
    }
  for (const l of model.lecturers) {
    if (l.maxPeriodsPerDay === null) continue;
    for (const day of model.days) {
      const periods = placed
        .filter(
          (s) =>
            s.day === day &&
            model.lessons.find((x) => x.id === s.lessonId)!.lecturerId === l.id,
        )
        .reduce(
          (n, s) => n + model.lessons.find((x) => x.id === s.lessonId)!.length,
          0,
        );
      expect(periods).toBeLessThanOrEqual(l.maxPeriodsPerDay);
    }
  }
}

describe('Timetable engine', () => {
  it('generates a full week with no clashes', () => {
    const model = college();
    const tt = new Timetable(model);
    const result = tt.generate({ timeLimitMs: 8000 });
    expect(result.unplaced).toEqual([]);
    expect(result.placed).toBe(model.sessions.length);
    verify(model, tt);
    // Sessions of one unit land on different days.
    const sameDay = model.lessons.filter((l) => {
      const days = [...tt.sessions.values()]
        .filter((s) => s.lessonId === l.id)
        .map((s) => s.day);
      return new Set(days).size < days.length;
    });
    expect(sameDay).toEqual([]);
  });

  it('refuses a double booking with a clear reason', () => {
    const model = college();
    const tt = new Timetable(model);
    const [a, b] = model.sessions.filter((s) => s.lessonId === 1);
    tt.place(a.id, { day: 1, startPeriodId: 1, roomId: 1 });
    expect(() =>
      tt.place(b.id, { day: 1, startPeriodId: 1, roomId: 2 }),
    ).toThrow(ConflictError);
    try {
      tt.place(b.id, { day: 1, startPeriodId: 1, roomId: 1 });
    } catch (err) {
      const codes = (err as ConflictError).conflicts.map((c) => c.code);
      expect(codes).toEqual(
        expect.arrayContaining(['room-busy', 'lecturer-busy', 'class-busy']),
      );
    }
    // A double lesson cannot start just before a break.
    const double = model.sessions.find(
      (s) => model.lessons.find((l) => l.id === s.lessonId)!.length === 2,
    )!;
    expect(
      tt.conflicts(double, { day: 2, startPeriodId: 2, roomId: 3 })[0].code,
    ).toBe('span');
  });

  it('keeps locked sessions where they are when rebuilding', () => {
    const model = college();
    const first = model.sessions[0];
    Object.assign(first, { day: 3, startPeriodId: 7, roomId: 1, locked: true });
    const tt = new Timetable(model);
    tt.generate({ rebuild: true, timeLimitMs: 4000 });
    expect(tt.sessions.get(first.id)).toMatchObject({
      day: 3,
      startPeriodId: 7,
      roomId: 1,
    });
    verify(model, tt);
  });

  it('explains what cannot be placed instead of forcing a clash', () => {
    const model = college();
    model.rooms = model.rooms.filter((r) => r.type !== 'workshop');
    const tt = new Timetable(model);
    const result = tt.generate({ timeLimitMs: 4000 });
    const workshopLessons = model.lessons
      .filter((l) => l.roomType === 'workshop')
      .map((l) => l.id);
    const workshopSessions = model.sessions.filter((s) =>
      workshopLessons.includes(s.lessonId),
    );
    expect(
      result.unplaced.map((u) => u.sessionId).sort((a, b) => a - b),
    ).toEqual(workshopSessions.map((s) => s.id).sort((a, b) => a - b));
    expect(result.unplaced[0].reason).toMatch(/No active workshop/);
    verify(model, tt);
  });

  it('shows which slots are free for a session', () => {
    const model = college();
    const tt = new Timetable(model);
    const s = model.sessions[0];
    const lesson = model.lessons[0];
    const other = model.sessions.find(
      (x) =>
        x.lessonId !== lesson.id &&
        model.lessons.find((l) => l.id === x.lessonId)!.lecturerId ===
          lesson.lecturerId,
    )!;
    tt.place(other.id, { day: 1, startPeriodId: 1, roomId: 6 });
    const slot = tt.options(s.id).find((o) => o.day === 1 && o.periodId === 1)!;
    expect(slot.roomIds).toEqual([]);
    expect(slot.reasons.join(' ')).toMatch(/already teaching/);
    const free = tt.options(s.id).find((o) => o.day === 2 && o.periodId === 1)!;
    expect(free.roomIds.length).toBeGreaterThan(0);
    expect(tt.options(s.id).some((o) => o.periodId === 3)).toBe(false); // breaks are never offered
  });
});
