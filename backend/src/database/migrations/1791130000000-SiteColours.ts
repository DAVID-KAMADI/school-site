import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Site colours (Admin → Site colours), starting with the original blue and orange. */
export class SiteColours1791130000000 implements MigrationInterface {
  name = 'SiteColours1791130000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      'INSERT IGNORE INTO `site_settings` (`key`, `value`, `group_name`, `description`) VALUES (?, ?, ?, ?)',
      [
        'theme.colors',
        JSON.stringify({
          primary: '#0033a0',
          action: '#0345bf',
          accent: '#ef6d00',
          footer: '#001a5c',
        }),
        'theme',
        'Site colours: main, buttons & links, highlight, footer (edited under Site colours)',
      ],
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query("DELETE FROM `site_settings` WHERE `key` = 'theme.colors'");
  }
}
