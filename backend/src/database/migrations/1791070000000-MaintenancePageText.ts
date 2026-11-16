import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Wording of the maintenance page (editable under Interface text, and translatable). The heading and
 * message for a particular maintenance are set on Admin → Maintenance mode.
 */
const TEXT: [string, string, string][] = [
  ['maintenance.eyebrow', 'Scheduled maintenance', 'Maintenance page: small line above the heading'],
  ['maintenance.title', "We're making the site better", 'Maintenance page: heading when none is set on Maintenance mode'],
  [
    'maintenance.message',
    "We're carrying out planned updates. Thank you for your patience. Please check back soon.",
    'Maintenance page: message when none is set on Maintenance mode',
  ],
  ['maintenance.back_in', "We'll be back in", 'Maintenance page: above the countdown'],
  ['maintenance.days', 'Days', 'Maintenance page: countdown unit'],
  ['maintenance.hours', 'Hours', 'Maintenance page: countdown unit'],
  ['maintenance.minutes', 'Minutes', 'Maintenance page: countdown unit'],
  ['maintenance.seconds', 'Seconds', 'Maintenance page: countdown unit'],
  ['maintenance.back_at', 'Expected back {time}', 'Maintenance page: under the countdown. {time} is the date and time'],
  [
    'maintenance.almost',
    'Almost done. This page will refresh by itself as soon as the site is back.',
    'Maintenance page: when the countdown has reached zero',
  ],
  [
    'maintenance.no_time',
    'This page will refresh by itself as soon as the site is back.',
    'Maintenance page: when no end time was given',
  ],
  ['maintenance.restoring', 'The site is being restored', 'Maintenance page: heading during a backup restore'],
  [
    'maintenance.contact',
    'Need help urgently? Call {phone} or email {email}.',
    'Maintenance page: contact line. {phone} and {email} come from Site settings',
  ],
  [
    'maintenance.staff_notice',
    'Maintenance mode is on: visitors see the maintenance page. You see the site because you are signed in as staff.',
    'Strip on the public site for signed-in staff while maintenance mode is on',
  ],
];

export class MaintenancePageText1791070000000 implements MigrationInterface {
  name = 'MaintenancePageText1791070000000';

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
