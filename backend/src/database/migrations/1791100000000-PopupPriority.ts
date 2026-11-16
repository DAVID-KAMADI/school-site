import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Priority pop-ups show first on the website, before intake pop-ups and the rest. */
export class PopupPriority1791100000000 implements MigrationInterface {
  name = 'PopupPriority1791100000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      'ALTER TABLE `popups` ADD `is_priority` tinyint NOT NULL DEFAULT 0 AFTER `is_active`',
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE `popups` DROP COLUMN `is_priority`');
  }
}
