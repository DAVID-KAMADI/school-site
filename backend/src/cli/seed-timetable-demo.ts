/**
 * A demo timetable for the training database: rooms, lecturers, classes, units and a term with its
 * lessons, then an automatically generated timetable. Everything it creates is marked "(demo)".
 *
 *   npm run seed:timetable-demo              add it (replacing an earlier demo)
 *   npm run seed:timetable-demo -- --remove  remove it again
 *
 * Never run this on production.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { parseArgs } from 'node:util';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module.js';
import { UserStatus } from '../identity/entities/user.entity.js';
import { UsersService } from '../identity/users.service.js';
import { TimetableService } from '../timetable/timetable.service.js';

const MARK = ' (demo)';
const LECTURER_DOMAIN = '@demo.timetable.local';
const SYSTEM_EMAIL = 'website-system@system.local';

const { values } = parseArgs({
  options: { remove: { type: 'boolean', default: false } },
});

const app = await NestFactory.createApplicationContext(AppModule, {
  logger: ['error', 'warn'],
});
try {
  const ds = app.get(DataSource);
  const tt = app.get(TimetableService);

  await ds.query('DELETE FROM tt_terms WHERE name LIKE ?', [`%${MARK}`]);
  await ds.query(
    'DELETE FROM tt_units WHERE name LIKE ? AND id NOT IN (SELECT unit_id FROM tt_lessons)',
    [`%${MARK}`],
  );
  await ds.query(
    'DELETE FROM tt_lecturers WHERE email LIKE ? AND id NOT IN (SELECT lecturer_id FROM tt_lessons)',
    [`%${LECTURER_DOMAIN}`],
  );
  await ds.query('DELETE FROM tt_classes WHERE name LIKE ?', [`%${MARK}`]);
  await ds.query('DELETE FROM tt_rooms WHERE name LIKE ?', [`%${MARK}`]);
  if (values.remove) {
    console.log('Demo timetable removed.');
  } else {
    const userId = await systemUser(ds, app.get(UsersService));
    const id = (r: { id: number }) => r.id;

    const rooms = {
      lr1: id(
        await tt.saveRoom(
          null,
          { name: `LR1${MARK}`, capacity: 40, notes: 'Block A' },
          userId,
        ),
      ),
      lr2: id(
        await tt.saveRoom(
          null,
          { name: `LR2${MARK}`, capacity: 40, notes: 'Block A' },
          userId,
        ),
      ),
      lr3: id(
        await tt.saveRoom(
          null,
          { name: `LR3${MARK}`, capacity: 50, notes: 'Block B' },
          userId,
        ),
      ),
      lr4: id(
        await tt.saveRoom(
          null,
          { name: `LR4${MARK}`, capacity: 55, notes: 'Block B' },
          userId,
        ),
      ),
      theatre: id(
        await tt.saveRoom(
          null,
          { name: `Lecture theatre${MARK}`, capacity: 120 },
          userId,
        ),
      ),
      labA: id(
        await tt.saveRoom(
          null,
          { name: `Computer lab A${MARK}`, capacity: 40, type: 'computer_lab' },
          userId,
        ),
      ),
      labB: id(
        await tt.saveRoom(
          null,
          { name: `Computer lab B${MARK}`, capacity: 35, type: 'computer_lab' },
          userId,
        ),
      ),
      workshop: id(
        await tt.saveRoom(
          null,
          {
            name: `Electrical workshop${MARK}`,
            capacity: 30,
            type: 'workshop',
          },
          userId,
        ),
      ),
    };
    void rooms;

    const lecturer = async (name: string, extra: object = {}) =>
      id(
        await tt.saveLecturer(
          null,
          {
            name,
            email: `${name.split(' ')[0].toLowerCase()}${LECTURER_DOMAIN}`,
            ...extra,
          },
          userId,
        ),
      );
    const L = {
      grace: await lecturer('Grace Wanjiru', {
        department: 'ICT',
        maxPeriodsPerDay: 5,
      }),
      peter: await lecturer('Peter Otieno', { department: 'ICT' }),
      faith: await lecturer('Faith Chebet', {
        department: 'Business',
        unavailable: [{ day: 5, from: '12:30', to: '17:00' }],
      }),
      john: await lecturer('John Mwangi', {
        department: 'Electrical',
        maxPeriodsPerDay: 6,
      }),
      mercy: await lecturer('Mercy Achieng', { department: 'Liberal studies' }),
      david: await lecturer('David Kiprop', {
        department: 'Business',
        unavailable: [{ day: 1, from: '08:00', to: '10:00' }],
      }),
      esther: await lecturer('Esther Njeri', { department: 'ICT' }),
      samuel: await lecturer('Samuel Mutua', { department: 'Electrical' }),
      agnes: await lecturer('Agnes Wambui', { department: 'Business' }),
      brian: await lecturer('Brian Omondi', {
        department: 'Liberal studies',
        maxPeriodsPerDay: 4,
      }),
    };

    const klass = async (name: string, size: number) =>
      id(await tt.saveClass(null, { name: `${name}${MARK}`, size }, userId));
    const C = {
      ict1: await klass('Diploma in ICT, Year 1', 38),
      ict2: await klass('Diploma in ICT, Year 2', 32),
      bus1: await klass('Diploma in Business Management, Year 1', 45),
      bus2: await klass('Diploma in Business Management, Year 2', 40),
      elec1: await klass('Certificate in Electrical Installation, Year 1', 28),
    };

    const unit = async (
      code: string,
      name: string,
      roomType: string | null = null,
    ) =>
      id(
        await tt.saveUnit(
          null,
          { code: `${code}-D`, name: `${name}${MARK}`, roomType },
          userId,
        ),
      );
    const U = {
      prog: await unit(
        'ICT 111',
        'Introduction to Programming',
        'computer_lab',
      ),
      comp: await unit('ICT 112', 'Computer Applications', 'computer_lab'),
      maths: await unit('MAT 101', 'Business Mathematics'),
      comm: await unit('COM 101', 'Communication Skills'),
      db: await unit('ICT 211', 'Database Systems', 'computer_lab'),
      net: await unit('ICT 212', 'Computer Networks'),
      web: await unit('ICT 213', 'Web Development', 'computer_lab'),
      ent: await unit('ENT 201', 'Entrepreneurship'),
      acc: await unit('BUS 111', 'Principles of Accounting'),
      mgt: await unit('BUS 112', 'Principles of Management'),
      eco: await unit('BUS 113', 'Economics'),
      mkt: await unit('BUS 211', 'Marketing'),
      law: await unit('BUS 212', 'Business Law'),
      hrm: await unit('BUS 213', 'Human Resource Management'),
      fin: await unit('BUS 214', 'Financial Management'),
      elp: await unit('ELE 101', 'Electrical Principles'),
      inst: await unit(
        'ELE 102',
        'Electrical Installation Practice',
        'workshop',
      ),
      draw: await unit('ELE 103', 'Technical Drawing'),
      safety: await unit('ELE 104', 'Workshop Safety'),
    };

    const term = await tt.createTerm(
      {
        name: `September–December 2027${MARK}`,
        startsOn: '2027-09-06',
        endsOn: '2027-12-10',
        days: [1, 2, 3, 4, 5],
      },
      userId,
    );
    const lesson = (
      unitId: number,
      lecturerId: number,
      classIds: number[],
      sessionsPerWeek: number,
      length = 1,
    ) =>
      tt.saveLesson(
        term.id,
        null,
        { unitId, lecturerId, classIds, sessionsPerWeek, length },
        userId,
      );

    // Year 1 ICT and Business share Communication Skills in the lecture theatre (83 students).
    await lesson(U.comm, L.mercy, [C.ict1, C.bus1], 2);
    await lesson(U.prog, L.peter, [C.ict1], 2, 2);
    await lesson(U.comp, L.esther, [C.ict1], 2, 2);
    await lesson(U.maths, L.david, [C.ict1], 3);
    await lesson(U.db, L.grace, [C.ict2], 2, 2);
    await lesson(U.net, L.peter, [C.ict2], 3);
    await lesson(U.web, L.esther, [C.ict2], 2, 2);
    await lesson(U.ent, L.brian, [C.ict2, C.bus2], 2);
    await lesson(U.acc, L.faith, [C.bus1], 3);
    await lesson(U.mgt, L.agnes, [C.bus1], 3);
    await lesson(U.eco, L.david, [C.bus1], 2);
    await lesson(U.mkt, L.agnes, [C.bus2], 3);
    await lesson(U.law, L.faith, [C.bus2], 2);
    await lesson(U.hrm, L.agnes, [C.bus2], 2);
    await lesson(U.fin, L.faith, [C.bus2], 2);
    await lesson(U.elp, L.john, [C.elec1], 3);
    await lesson(U.inst, L.samuel, [C.elec1], 3, 2);
    await lesson(U.draw, L.john, [C.elec1], 2);
    await lesson(U.safety, L.samuel, [C.elec1], 1);
    await lesson(U.comm, L.brian, [C.elec1], 2);

    const result = await tt.generate(term.id, false, userId);
    console.log(
      `Demo timetable created: ${result.placed} sessions placed, ${result.unplaced.length} unplaced, in ${result.seconds}s.`,
    );
    console.log(
      'Open Admin → Timetable. Publish the term to see it at /timetable.',
    );
  }
} finally {
  await app.close();
}

/** The disabled system account that "does" the seeding (it can never sign in). */
async function systemUser(
  ds: DataSource,
  users: UsersService,
): Promise<number> {
  const [row] = (await ds.query('SELECT id FROM users WHERE email = ?', [
    SYSTEM_EMAIL,
  ])) as { id: number }[];
  if (row) return Number(row.id);
  const created = await users.create({
    email: SYSTEM_EMAIL,
    fullName: 'Website system',
    password: users.generatePassword(),
  });
  await users.update(created.id, { status: UserStatus.Disabled });
  return created.id;
}
