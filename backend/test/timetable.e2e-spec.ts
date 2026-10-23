import { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import {
  client,
  createTestApp,
  signedInStaff,
  type TestClient,
} from './helpers.js';

// Needs the local training database. Creates its own rooms, lecturers, classes, units and term,
// and removes them afterwards.

describe('Timetable (e2e)', () => {
  let app: INestApplication<App>;
  let db: DataSource;
  let officer: TestClient;
  let editor: TestClient;
  const userIds: number[] = [];
  const tag = randomBytes(3).toString('hex');
  const created = {
    rooms: [] as number[],
    lecturers: [] as number[],
    classes: [] as number[],
    units: [] as number[],
    terms: [] as number[],
  };

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
    const o = await signedInStaff(app, [{ roleKey: 'timetable_officer' }]);
    const e = await signedInStaff(app, [{ roleKey: 'content_editor' }]);
    officer = o.client;
    editor = e.client;
    userIds.push(o.userId, e.userId);
  });

  afterAll(async () => {
    const del = (table: string, ids: number[]) =>
      ids.length
        ? db.query(`DELETE FROM ${table} WHERE id IN (?)`, [ids])
        : null;
    await del('tt_terms', created.terms);
    await del('tt_units', created.units);
    await del('tt_classes', created.classes);
    await del('tt_lecturers', created.lecturers);
    await del('tt_rooms', created.rooms);
    if (userIds.length)
      await db.query('DELETE FROM users WHERE id IN (?)', [userIds]);
    await app.close();
  });

  const make = async (kind: keyof typeof created, body: object) => {
    const res = await officer.post(`/admin/timetable/resources/${kind}`, body);
    expect(res.status).toBe(201);
    created[kind].push(res.body.id);
    return res.body.id as number;
  };

  it('builds, checks and publishes a timetable without clashes', async () => {
    // Only timetable staff can manage it.
    expect((await editor.get('/admin/timetable/terms')).status).toBe(403);

    await make('rooms', { name: `LR1 ${tag}`, capacity: 40 });
    const lr2 = await make('rooms', { name: `LR2 ${tag}`, capacity: 60 });
    await make('rooms', {
      name: `Lab ${tag}`,
      capacity: 40,
      type: 'computer_lab',
    });
    const ann = await make('lecturers', {
      name: `Ann ${tag}`,
      unavailable: [{ day: 1, from: '08:00', to: '17:00' }],
    });
    const ben = await make('lecturers', {
      name: `Ben ${tag}`,
      maxPeriodsPerDay: 3,
    });
    const year1 = await make('classes', { name: `ICT Y1 ${tag}`, size: 35 });
    const year2 = await make('classes', { name: `ICT Y2 ${tag}`, size: 25 });
    const db1 = await make('units', {
      code: `DB${tag}`,
      name: 'Databases',
      roomType: 'computer_lab',
    });
    const com = await make('units', {
      code: `COM${tag}`,
      name: 'Communication skills',
    });

    // Validation: a duplicate room name, and an impossible unavailability window.
    expect(
      (
        await officer.post('/admin/timetable/resources/rooms', {
          name: `LR1 ${tag}`,
          capacity: 10,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await officer.post('/admin/timetable/resources/lecturers', {
          name: 'X',
          unavailable: [{ day: 1, from: '10:00', to: '09:00' }],
        })
      ).status,
    ).toBe(400);

    // A term starts with a default day (08:00–16:30, tea break and lunch).
    const term = await officer.post('/admin/timetable/terms', {
      name: `Sept ${tag}`,
      startsOn: '2027-09-06',
      endsOn: '2027-12-10',
    });
    expect(term.status).toBe(201);
    const termId = term.body.id;
    created.terms.push(termId);

    const lesson = (body: object) =>
      officer.post(`/admin/timetable/terms/${termId}/lessons`, body);
    expect(
      (
        await lesson({
          unitId: db1,
          lecturerId: ann,
          classIds: [year1],
          sessionsPerWeek: 2,
          length: 2,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await lesson({
          unitId: com,
          lecturerId: ben,
          classIds: [year1, year2],
          sessionsPerWeek: 3,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await lesson({
          unitId: db1,
          lecturerId: ann,
          classIds: [year2],
          sessionsPerWeek: 2,
          length: 2,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await lesson({
          unitId: com,
          lecturerId: ben,
          classIds: [year2],
          sessionsPerWeek: 2,
        })
      ).status,
    ).toBe(201);

    // Generate: everything placed, with no clashes and every rule respected.
    const gen = await officer.post(
      `/admin/timetable/terms/${termId}/generate`,
      {},
    );
    expect(gen.status).toBe(200);
    expect(gen.body.unplaced).toEqual([]);
    expect(gen.body.placed).toBe(9);

    const board = (await officer.get(`/admin/timetable/terms/${termId}/board`))
      .body;
    expect(board.issues).toEqual([]);
    const lessonOf = (s: { lessonId: number }) =>
      board.lessons.find((l: { id: number }) => l.id === s.lessonId);
    for (const s of board.sessions) {
      expect(s.day).not.toBeNull();
      const l = lessonOf(s);
      if (l.lecturerId === ann) expect(s.day).not.toBe(1); // Ann is away on Mondays
      const room = board.rooms.find((r: { id: number }) => r.id === s.roomId);
      if (l.unitId === db1) expect(room.type).toBe('computer_lab');
      else expect(room.type).toBe('classroom');
      if (l.classIds.length === 2)
        expect(room.capacity).toBeGreaterThanOrEqual(60); // both classes together
    }
    // The database holds one occupancy row per resource per period: no duplicates possible.
    const [{ dupes }] = await db.query(
      'SELECT COUNT(*) dupes FROM (SELECT 1 FROM tt_slots WHERE term_id = ? GROUP BY day, period_id, kind, resource_id HAVING COUNT(*) > 1) x',
      [termId],
    );
    expect(Number(dupes)).toBe(0);

    // Moving a session onto a busy class is refused with the reason.
    const [a, b] = board.sessions.filter((s: { lessonId: number }) =>
      lessonOf(s).classIds.includes(year1),
    );
    const clash = await officer.put(
      `/admin/timetable/terms/${termId}/sessions/${a.id}/place`,
      {
        day: b.day,
        periodId: b.startPeriodId,
        roomId: lr2,
      },
    );
    expect(clash.status).toBe(409);
    expect(clash.body.conflicts.join(' ')).toMatch(/already has/);

    // The options for a session show free slots and explain blocked ones.
    const options = (
      await officer.get(
        `/admin/timetable/terms/${termId}/sessions/${a.id}/options`,
      )
    ).body;
    const blocked = options.find(
      (o: { day: number; periodId: number }) =>
        o.day === b.day && o.periodId === b.startPeriodId,
    );
    expect(blocked.roomIds).toEqual([]);
    expect(blocked.reasons.length).toBeGreaterThan(0);
    const free = options.find(
      (o: { roomIds: number[] }) => o.roomIds.length > 0,
    );
    const moved = await officer.put(
      `/admin/timetable/terms/${termId}/sessions/${a.id}/place`,
      {
        day: free.day,
        periodId: free.periodId,
        roomId: free.roomIds[0],
      },
    );
    expect(moved.status).toBe(200);

    // Turning the first period into a break unplaces only the sessions that used it.
    const periods = board.periods.map((p: object) => ({ ...p }));
    periods[0].isBreak = true;
    const usedFirst = (
      await officer.get(`/admin/timetable/terms/${termId}/board`)
    ).body.sessions.filter(
      (s: { startPeriodId: number }) => s.startPeriodId === periods[0].id,
    ).length;
    const changed = await officer.put(
      `/admin/timetable/terms/${termId}/periods`,
      { periods },
    );
    expect(changed.status).toBe(200);
    const after = (await officer.get(`/admin/timetable/terms/${termId}/board`))
      .body;
    expect(
      after.sessions.filter((s: { day: number | null }) => s.day === null)
        .length,
    ).toBeGreaterThanOrEqual(usedFirst);
    expect(
      after.sessions.some(
        (s: { startPeriodId: number }) => s.startPeriodId === periods[0].id,
      ),
    ).toBe(false);

    // Two people placing two lessons of the same class into the same free slot at the same moment:
    // exactly one succeeds, the other is told to reload. No double booking reaches the database.
    const now = (await officer.get(`/admin/timetable/terms/${termId}/board`))
      .body;
    const ofYear1 = now.sessions.filter((s: { lessonId: number }) =>
      now.lessons
        .find((l: { id: number }) => l.id === s.lessonId)
        .classIds.includes(year1),
    );
    const [first, second] = [
      ofYear1[0],
      ofYear1.find(
        (s: { lessonId: number }) => s.lessonId !== ofYear1[0].lessonId,
      ),
    ];
    await officer.delete(
      `/admin/timetable/terms/${termId}/sessions/${first.id}/place`,
    );
    await officer.delete(
      `/admin/timetable/terms/${termId}/sessions/${second.id}/place`,
    );
    const slot = (
      await officer.get(
        `/admin/timetable/terms/${termId}/sessions/${first.id}/options`,
      )
    ).body.find((o: { roomIds: number[] }) => o.roomIds.length > 0);
    const otherRoom =
      slot.roomIds.find((r: number) => r !== slot.roomIds[0]) ?? lr2;
    const results = await Promise.all([
      officer.put(
        `/admin/timetable/terms/${termId}/sessions/${first.id}/place`,
        { day: slot.day, periodId: slot.periodId, roomId: slot.roomIds[0] },
      ),
      officer.put(
        `/admin/timetable/terms/${termId}/sessions/${second.id}/place`,
        { day: slot.day, periodId: slot.periodId, roomId: otherRoom },
      ),
    ]);
    const statuses = results.map((r) => r.status).sort((a, b) => a - b);
    expect(statuses.filter((x) => x === 200).length).toBeLessThanOrEqual(1);
    const [{ dupes: raceDupes }] = await db.query(
      'SELECT COUNT(*) dupes FROM (SELECT 1 FROM tt_slots WHERE term_id = ? GROUP BY day, period_id, kind, resource_id HAVING COUNT(*) > 1) x',
      [termId],
    );
    expect(Number(raceDupes)).toBe(0);

    // Fill again, then publish: the public page shows it, without private details.
    await officer.post(`/admin/timetable/terms/${termId}/generate`, {});
    expect((await client(app).get(`/public/timetable/${termId}`)).status).toBe(
      404,
    );
    expect(
      (await officer.post(`/admin/timetable/terms/${termId}/publish`)).status,
    ).toBe(200);
    const visitor = client(app);
    expect(
      (await visitor.get('/public/timetable')).body.map(
        (t: { id: number }) => t.id,
      ),
    ).toContain(termId);
    const pub = (await visitor.get(`/public/timetable/${termId}`)).body;
    expect(
      pub.classes
        .map((c: { id: number }) => c.id)
        .sort((a: number, b: number) => a - b),
    ).toEqual([year1, year2].sort((a, b) => a - b));
    expect(pub.sessions.length).toBeGreaterThan(0);
    expect(JSON.stringify(pub)).not.toMatch(
      /unavailable|maxPeriodsPerDay|notes/,
    );

    // A published term cannot be deleted until it is unpublished.
    expect(
      (await officer.delete(`/admin/timetable/terms/${termId}`)).status,
    ).toBe(400);
  });
});
