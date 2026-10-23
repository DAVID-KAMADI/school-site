import { MigrationInterface, QueryRunner } from 'typeorm';

/** Settings for the letterhead on printed documents (offer letters, applications reports). */
export class LetterheadSettings1791010000000 implements MigrationInterface {
  name = 'LetterheadSettings1791010000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      "INSERT INTO `site_settings` (`key`, `group_name`, `value`, `description`) VALUES ('institution.letterhead_logo_media_id', 'institution', 'null', ?)",
      [
        'Logo printed on PDF documents such as offer letters and applications reports. Use a version that reads well on white paper. Leave empty to use the site logo.',
      ],
    );
    await q.query(
      "INSERT INTO `site_settings` (`key`, `group_name`, `value`, `description`) VALUES ('contact.website', 'contact', '\"\"', ?)",
      ['Website address printed on letterheads, e.g. https://rcmrd.org'],
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      "DELETE FROM `site_settings` WHERE `key` IN ('institution.letterhead_logo_media_id', 'contact.website')",
    );
  }
}
