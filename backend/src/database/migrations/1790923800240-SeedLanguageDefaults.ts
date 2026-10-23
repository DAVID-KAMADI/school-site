import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Language switcher: the list of languages visitors can choose (English only until staff add
 * more in Admin → Languages), translated site settings, and the switcher's interface text.
 */

const SETTINGS: [key: string, value: unknown, description: string][] = [
  [
    'languages.enabled',
    [{ code: 'en', name: 'English' }],
    'Languages visitors can choose. English is the main language and is always first.',
  ],
  [
    'languages.setting_translations',
    {},
    'Site settings (tagline, address, banners) in other languages, keyed by language code.',
  ],
];

const TEXT: [string, string, string][] = [
  [
    'common.language',
    'Language',
    'Label of the language switcher in the header',
  ],
  [
    'common.not_translated',
    'This page is not yet available in {language}, so it is shown in English.',
    'Notice on a page that has not been translated yet. {language} is the chosen language.',
  ],
];

export class SeedLanguageDefaults1790923800240 implements MigrationInterface {
  name = 'SeedLanguageDefaults1790923800240';

  public async up(q: QueryRunner): Promise<void> {
    for (const [key, value, description] of SETTINGS) {
      await q.query(
        "INSERT INTO `site_settings` (`key`, `group_name`, `value`, `description`) VALUES (?, 'languages', ?, ?)",
        [key, JSON.stringify(value), description],
      );
    }
    for (const [key, value, description] of TEXT) {
      await q.query(
        "INSERT INTO `text_strings` (`key`, `locale`, `value`, `description`) VALUES (?, 'en', ?, ?)",
        [key, value, description],
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query('DELETE FROM `text_strings` WHERE `key` IN (?)', [
      TEXT.map(([k]) => k),
    ]);
    await q.query('DELETE FROM `site_settings` WHERE `key` IN (?)', [
      SETTINGS.map(([k]) => k),
    ]);
  }
}
