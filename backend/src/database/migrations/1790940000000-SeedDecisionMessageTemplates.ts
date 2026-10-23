import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ready-made messages for admissions decisions. When staff choose "Offer a place", "Not successful"
 * or "Request more information", the message box starts with this text, filled in for the applicant;
 * they can still edit it before sending. Editable under Site settings → Admissions.
 */

const PLACEHOLDERS =
  'Placeholders: {first_name}, {full_name}, {application_number}, {programme}, {study_mode}, {intake}, {starts_on}, {accept_by}, {institution_name}.';

const SETTINGS: [key: string, value: string, description: string][] = [
  [
    'admissions.message_offered',
    `Dear {first_name},

Congratulations! We are pleased to offer you a place on the {programme} ({study_mode}) for the {intake} intake.

Next steps:
1. Download your offer letter from your application page.
2. Accept the offer online by {accept_by}. If we do not hear from you by then, the place may be offered to someone else.
3. Pay the fees and report on {starts_on}, as explained in the offer letter.

If you have any questions, reply here or contact the admissions office.

We look forward to welcoming you to {institution_name}.

Admissions Office`,
    `Message filled in when offering a place. ${PLACEHOLDERS}`,
  ],
  [
    'admissions.message_rejected',
    `Dear {first_name},

Thank you for applying to study {programme} at {institution_name}. After careful review, we are unable to offer you a place for the {intake} intake.

This may be because the entry requirements were not met or because places were limited. You are welcome to apply for another programme or a later intake.

We wish you every success.

Admissions Office`,
    `Message filled in when an application is not successful. ${PLACEHOLDERS}`,
  ],
  [
    'admissions.message_info_requested',
    `Dear {first_name},

Thank you for your application ({application_number}). Before we can continue, please send or correct the following:

-

You can upload documents and update your answers on your application page.

Admissions Office`,
    `Message filled in when asking for more information. ${PLACEHOLDERS}`,
  ],
];

export class SeedDecisionMessageTemplates1790940000000 implements MigrationInterface {
  name = 'SeedDecisionMessageTemplates1790940000000';

  public async up(q: QueryRunner): Promise<void> {
    for (const [key, value, description] of SETTINGS)
      await q.query(
        "INSERT INTO `site_settings` (`key`, `group_name`, `value`, `description`) VALUES (?, 'admissions', ?, ?)",
        [key, JSON.stringify(value), description],
      );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query('DELETE FROM `site_settings` WHERE `key` IN (?)', [
      SETTINGS.map(([k]) => k),
    ]);
  }
}
