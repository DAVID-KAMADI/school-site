import { MigrationInterface, QueryRunner } from 'typeorm';

/** Module and order of every permission, for the access control matrix. */
const CATALOGUE: [key: string, module: string, order: number][] = [
  ['admin.access', 'Admin portal', 10],
  ['pages.create', 'Website content', 20],
  ['pages.edit', 'Website content', 21],
  ['pages.publish', 'Website content', 22],
  ['pages.delete', 'Website content', 23],
  ['media.upload', 'Media library', 30],
  ['media.edit', 'Media library', 31],
  ['media.delete', 'Media library', 32],
  ['menus.edit', 'Site setup', 40],
  ['settings.edit', 'Site setup', 41],
  ['text_strings.edit', 'Site setup', 42],
  ['redirects.edit', 'Site setup', 43],
  ['applications.view', 'Admissions', 50],
  ['applications.review', 'Admissions', 51],
  ['applications.decide', 'Admissions', 52],
  ['admissions.configure', 'Admissions', 53],
  ['applicants.manage', 'Admissions', 54],
  ['timetable.manage', 'Timetable', 60],
  ['users.manage', 'Users & access', 70],
  ['access.manage', 'Users & access', 71],
  ['audit.view', 'Users & access', 72],
  ['applications.apply', 'Applicant portal', 90],
];

export class AccessControl1790980000000 implements MigrationInterface {
  name = 'AccessControl1790980000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      "ALTER TABLE `permissions` ADD `module` varchar(40) NOT NULL DEFAULT 'Other', ADD `sort_order` smallint UNSIGNED NOT NULL DEFAULT 0",
    );
    // Who a role is for: staff use the admin portal; applicants and students use their own portals.
    await q.query(
      "ALTER TABLE `roles` ADD `audience` enum ('staff', 'applicant', 'student') NOT NULL DEFAULT 'staff', ADD `is_locked` tinyint NOT NULL DEFAULT 0",
    );
    await q.query(
      "ALTER TABLE `users` ADD `account_type` enum ('staff', 'applicant', 'student') NOT NULL DEFAULT 'staff', ADD INDEX `IDX_users_account_type` (`account_type`)",
    );

    for (const [key, description] of [
      [
        'applicants.manage',
        'View applicant accounts, disable them and reset passwords',
      ],
      ['access.manage', 'Edit roles and what each role may do'],
    ])
      await q.query(
        'INSERT INTO `permissions` (`key`, `description`) VALUES (?, ?)',
        [key, description],
      );
    for (const [key, module, order] of CATALOGUE)
      await q.query(
        'UPDATE `permissions` SET `module` = ?, `sort_order` = ? WHERE `key` = ?',
        [module, order, key],
      );

    await q.query(
      "UPDATE `roles` SET `is_locked` = 1 WHERE `key` IN ('super_admin', 'applicant')",
    );
    await q.query(
      "UPDATE `roles` SET `audience` = 'applicant' WHERE `key` = 'applicant'",
    );
    await q.query(
      "UPDATE `roles` SET `audience` = 'student' WHERE `key` = 'student'",
    );
    for (const [role, keys] of [
      ['super_admin', ['applicants.manage', 'access.manage']],
      ['admissions_officer', ['applicants.manage']],
    ] as const)
      await q.query(
        'INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`) SELECT r.id, p.id FROM `roles` r JOIN `permissions` p ON p.`key` IN (?) WHERE r.`key` = ?',
        [keys, role],
      );

    // Accounts whose only roles are applicant/student roles are not staff.
    await q.query(
      `UPDATE users u SET u.account_type = 'applicant'
        WHERE EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.audience = 'applicant')
          AND NOT EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.audience = 'staff')`,
    );
    await q.query(
      `UPDATE users u SET u.account_type = 'student'
        WHERE EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.audience = 'student')
          AND NOT EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.audience = 'staff')`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      "DELETE FROM `permissions` WHERE `key` IN ('applicants.manage', 'access.manage')",
    );
    await q.query(
      'ALTER TABLE `users` DROP INDEX `IDX_users_account_type`, DROP COLUMN `account_type`',
    );
    await q.query(
      'ALTER TABLE `roles` DROP COLUMN `is_locked`, DROP COLUMN `audience`',
    );
    await q.query(
      'ALTER TABLE `permissions` DROP COLUMN `sort_order`, DROP COLUMN `module`',
    );
  }
}
