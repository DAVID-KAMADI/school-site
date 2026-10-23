import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Timetable management: the permission, a Timetable officer role, and the wording of the public
 * /timetable page (editable under Interface text, and translatable).
 */

const TEXT: [string, string, string][] = [
  ['timetable.title', 'Timetables', 'Heading of the public timetable page'],
  [
    'timetable.intro',
    'Choose your class to see when and where each lesson takes place.',
    'Introduction on the public timetable page',
  ],
  ['timetable.term', 'Term', 'Label of the term list'],
  ['timetable.view_by', 'View by', 'Label for class / lecturer / room choice'],
  ['timetable.class', 'Class', 'Class option on the timetable page'],
  ['timetable.lecturer', 'Lecturer', 'Lecturer option on the timetable page'],
  ['timetable.room', 'Room', 'Room option on the timetable page'],
  [
    'timetable.choose',
    'Choose…',
    'Placeholder of the class/lecturer/room list',
  ],
  ['timetable.print', 'Print', 'Print button on the timetable page'],
  [
    'timetable.none',
    'No timetable has been published yet.',
    'Shown when there is no published timetable',
  ],
  [
    'timetable.empty',
    'Nothing is scheduled for this choice.',
    'Shown when the chosen class, lecturer or room has no lessons',
  ],
  ['timetable.time', 'Time', 'Column heading for the time of day'],
];

export class SeedTimetableDefaults1790931714695 implements MigrationInterface {
  name = 'SeedTimetableDefaults1790931714695';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      'INSERT INTO `permissions` (`key`, `description`) VALUES (?, ?)',
      [
        'timetable.manage',
        'Manage rooms, lecturers, classes, units and timetables',
      ],
    );
    await q.query(
      'INSERT INTO `roles` (`key`, `name`, `description`) VALUES (?, ?, ?)',
      [
        'timetable_officer',
        'Timetable officer',
        'Prepares and publishes class timetables.',
      ],
    );
    for (const [role, keys] of [
      ['super_admin', ['timetable.manage']],
      ['timetable_officer', ['admin.access', 'timetable.manage']],
    ] as const)
      await q.query(
        'INSERT INTO `role_permissions` (`role_id`, `permission_id`) SELECT r.id, p.id FROM `roles` r JOIN `permissions` p ON p.`key` IN (?) WHERE r.`key` = ?',
        [keys, role],
      );
    for (const [key, value, description] of TEXT)
      await q.query(
        "INSERT INTO `text_strings` (`key`, `locale`, `value`, `description`) VALUES (?, 'en', ?, ?)",
        [key, value, description],
      );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query('DELETE FROM `text_strings` WHERE `key` IN (?)', [
      TEXT.map(([k]) => k),
    ]);
    await q.query("DELETE FROM `roles` WHERE `key` = 'timetable_officer'");
    await q.query("DELETE FROM `permissions` WHERE `key` = 'timetable.manage'");
  }
}
