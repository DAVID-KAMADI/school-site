import { MigrationInterface, QueryRunner } from 'typeorm';

/** Admissions setup, split by area and action so each can be given separately in Access control. */
const PERMISSIONS: [
  key: string,
  description: string,
  module: string,
  order: number,
][] = [
  ['programmes.create', 'Add programmes', 'Admissions · Programmes', 60],
  [
    'programmes.edit',
    'Edit programmes and show or hide them from applicants',
    'Admissions · Programmes',
    61,
  ],
  [
    'programmes.delete',
    'Delete programmes nobody has applied to',
    'Admissions · Programmes',
    62,
  ],
  [
    'short_courses.create',
    'Add short courses',
    'Admissions · Short courses',
    63,
  ],
  [
    'short_courses.edit',
    'Edit short courses and show or hide them on the website',
    'Admissions · Short courses',
    64,
  ],
  [
    'short_courses.delete',
    'Delete short courses',
    'Admissions · Short courses',
    65,
  ],
  ['intakes.create', 'Create intakes', 'Admissions · Intakes', 66],
  [
    'intakes.edit',
    'Change intake dates and open, close or hide intakes',
    'Admissions · Intakes',
    67,
  ],
  [
    'intakes.delete',
    'Delete intakes nobody has applied to',
    'Admissions · Intakes',
    68,
  ],
  [
    'document_types.create',
    'Add required documents',
    'Admissions · Required documents',
    69,
  ],
  [
    'document_types.edit',
    'Change required documents and their rules',
    'Admissions · Required documents',
    70,
  ],
  [
    'document_types.delete',
    'Delete required documents nobody has uploaded',
    'Admissions · Required documents',
    71,
  ],
];

export class AdmissionsSetupPermissions1791000000000 implements MigrationInterface {
  name = 'AdmissionsSetupPermissions1791000000000';

  public async up(q: QueryRunner): Promise<void> {
    for (const [key, description, module, order] of PERMISSIONS)
      await q.query(
        'INSERT INTO `permissions` (`key`, `description`, `module`, `sort_order`) VALUES (?, ?, ?, ?)',
        [key, description, module, order],
      );
    // Everyone who could manage admissions setup keeps every part of it.
    await q.query(
      `INSERT IGNORE INTO role_permissions (role_id, permission_id)
       SELECT rp.role_id, p.id FROM role_permissions rp
         JOIN permissions prev ON prev.id = rp.permission_id AND prev.\`key\` = 'admissions.configure'
         JOIN permissions p ON p.\`key\` IN (?)`,
      [PERMISSIONS.map((p) => p[0])],
    );
    await q.query(
      "DELETE FROM `permissions` WHERE `key` = 'admissions.configure'",
    );
    // Keep the new Admissions groups together, ahead of Timetable and Users & access.
    for (const [key, order] of [
      ['timetable.manage', 80],
      ['users.manage', 90],
      ['access.manage', 91],
      ['audit.view', 92],
      ['applications.apply', 99],
    ] as const)
      await q.query(
        'UPDATE `permissions` SET `sort_order` = ? WHERE `key` = ?',
        [order, key],
      );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      "INSERT INTO `permissions` (`key`, `description`, `module`, `sort_order`) VALUES ('admissions.configure', 'Manage programmes, intakes and required documents', 'Admissions', 53)",
    );
    await q.query(
      `INSERT IGNORE INTO role_permissions (role_id, permission_id)
       SELECT rp.role_id, p.id FROM role_permissions rp
         JOIN permissions split ON split.id = rp.permission_id AND split.\`key\` = 'programmes.edit'
         JOIN permissions p ON p.\`key\` = 'admissions.configure'`,
    );
    await q.query('DELETE FROM `permissions` WHERE `key` IN (?)', [
      PERMISSIONS.map((p) => p[0]),
    ]);
  }
}
