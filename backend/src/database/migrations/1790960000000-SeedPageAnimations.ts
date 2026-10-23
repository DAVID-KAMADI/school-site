import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Switch for the page animations: headings that rise word by word, sections that animate in as
 * visitors scroll, and timelines that draw themselves. Editable under Site settings → Banners.
 */
export class SeedPageAnimations1790960000000 implements MigrationInterface {
  name = 'SeedPageAnimations1790960000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      "INSERT INTO `site_settings` (`key`, `group_name`, `value`, `description`) VALUES ('banner.animations', 'banners', ?, ?)",
      [
        JSON.stringify({ enabled: true }),
        'Page animations: headings rise word by word, sections animate in as visitors scroll and timelines draw themselves. Visitors who ask their device for less motion always see still pages.',
      ],
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      "DELETE FROM `site_settings` WHERE `key` = 'banner.animations'",
    );
  }
}
