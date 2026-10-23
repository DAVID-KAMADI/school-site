import { MigrationInterface, QueryRunner } from 'typeorm';

/** The youngest age at which someone can be admitted, checked on the application form. */
export class MinimumAge1791020000000 implements MigrationInterface {
  name = 'MinimumAge1791020000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      "INSERT INTO `site_settings` (`key`, `group_name`, `value`, `description`) VALUES ('admissions.minimum_age', 'admissions', '16', ?)",
      [
        'Minimum age in years to apply for admission. Applicants younger than this are told they do not meet the age requirement.',
      ],
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      "DELETE FROM `site_settings` WHERE `key` = 'admissions.minimum_age'",
    );
  }
}
