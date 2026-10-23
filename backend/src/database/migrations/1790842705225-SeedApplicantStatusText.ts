import { MigrationInterface, QueryRunner } from 'typeorm';

/** Editable explanations applicants see on their status page, and the Apply page label. */
const TEXT: [string, string, string][] = [
  ['apply.eyebrow', 'Admissions', 'Small label above the Apply page heading'],
  [
    'apply.status.submitted',
    'We have received your application. Our admissions team will review it and contact you.',
    'Status page: submitted',
  ],
  [
    'apply.status.under_review',
    'Our admissions team is reviewing your application.',
    'Status page: under review',
  ],
  [
    'apply.status.info_requested',
    'We need a little more information. Read the message below, update your application and submit it again.',
    'Status page: more information needed',
  ],
  [
    'apply.status.offered',
    'Congratulations! You have been offered a place. Read the message below for next steps.',
    'Status page: offered a place',
  ],
  [
    'apply.status.rejected',
    'Unfortunately your application was not successful this time. Read the message below for details.',
    'Status page: not successful',
  ],
  [
    'apply.status.withdrawn',
    'You withdrew this application. You can start a new one at any time.',
    'Status page: withdrawn',
  ],
];

export class SeedApplicantStatusText1790842705225 implements MigrationInterface {
  name = 'SeedApplicantStatusText1790842705225';

  public async up(q: QueryRunner): Promise<void> {
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
  }
}
