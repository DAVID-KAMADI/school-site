import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Switch for the welcome screen: the logo, a drawn school building, the institution name and
 * tagline, shown each time a visitor opens or refreshes the public site. Editable under
 * Site settings → Banners.
 */
export class SeedWelcomeScreen1790950000000 implements MigrationInterface {
  name = 'SeedWelcomeScreen1790950000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      "INSERT INTO `site_settings` (`key`, `group_name`, `value`, `description`) VALUES ('banner.welcome_screen', 'banners', ?, ?)",
      [
        JSON.stringify({ enabled: true }),
        'Welcome screen with the logo, institution name and tagline, shown each time a visitor opens or refreshes the site',
      ],
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      "DELETE FROM `site_settings` WHERE `key` = 'banner.welcome_screen'",
    );
  }
}
