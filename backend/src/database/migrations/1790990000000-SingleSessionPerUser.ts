import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Staff may be signed in on one device at a time. When a staff sign-in completes, their other
 * sessions are marked as replaced (not deleted), so the device that was signed out can say why.
 */
export class SingleSessionPerUser1790990000000 implements MigrationInterface {
  name = 'SingleSessionPerUser1790990000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `sessions` ADD `replaced_at` datetime NULL',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `sessions` DROP COLUMN `replaced_at`');
  }
}
