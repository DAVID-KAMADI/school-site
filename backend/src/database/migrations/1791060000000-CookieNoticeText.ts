import { MigrationInterface, QueryRunner } from 'typeorm';

/** Wording of the cookie notice on the public site (editable under Interface text, and translatable). */
const TEXT: [string, string, string][] = [
  [
    'cookies.message',
    'We use cookies to keep you signed in, remember your language and keep this site secure. Videos from YouTube or Vimeo may set their own cookies when you play them.',
    'Cookie notice at the bottom of the public site',
  ],
  ['cookies.accept', 'Accept all', 'Cookie notice: button that accepts all cookies'],
  ['cookies.essential', 'Essential only', 'Cookie notice: button that accepts only the cookies the site needs'],
  ['cookies.details', 'Cookie details', 'Cookie notice: link to the cookie section of the Privacy Policy'],
  [
    'cookies.video_note',
    'Playing this video loads it from {provider}, which may set its own cookies.',
    'Under a video, for visitors who chose "Essential only". {provider} is YouTube or Vimeo',
  ],
];

export class CookieNoticeText1791060000000 implements MigrationInterface {
  name = 'CookieNoticeText1791060000000';

  public async up(q: QueryRunner): Promise<void> {
    for (const [key, value, description] of TEXT)
      await q.query(
        "INSERT IGNORE INTO `text_strings` (`key`, `locale`, `value`, `description`) VALUES (?, 'en', ?, ?)",
        [key, value, description],
      );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query('DELETE FROM `text_strings` WHERE `key` IN (?)', [TEXT.map(([key]) => key)]);
  }
}
