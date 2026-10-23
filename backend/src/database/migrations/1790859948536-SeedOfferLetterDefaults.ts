import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Editable offer letter wording, the offer response deadline, the link to the existing student portal,
 * and applicant-facing text for accepting or declining an offer.
 */

const SETTINGS: [
  key: string,
  group: string,
  value: unknown,
  description: string,
][] = [
  [
    'admissions.offer_letter',
    'admissions',
    {
      title: 'Offer of admission',
      body:
        'Dear {first_name},\n\n' +
        'We are pleased to offer you a place on the {programme} programme in the {school}, starting in the {intake} intake. ' +
        'You will study {study_mode}.\n\n' +
        'Please accept this offer online through your application account by {accept_by}. If we do not hear from you by then, ' +
        'the place may be offered to another applicant.\n\n' +
        'Congratulations, and welcome to {institution_name}.',
      joining_instructions:
        '- Report to the admissions office on {reporting_date} between 8:00 am and 4:00 pm.\n' +
        '- Bring this letter, your original KCSE certificate or result slip, your national ID or birth certificate, and two passport photos.\n' +
        '- Pay the first semester fees before reporting. Use your application number as the account number.\n' +
        '- After reporting, complete your registration on the student portal: {student_portal}',
      signatory_name: '',
      signatory_title: 'Registrar (Academic Affairs)',
    },
    'Offer letter wording. Placeholders: {applicant_name}, {first_name}, {programme}, {programme_code}, {school}, {duration}, {study_mode}, {intake}, {reporting_date}, {accept_by}, {application_number}, {institution_name}, {student_portal}',
  ],
  [
    'admissions.offer_acceptance_days',
    'admissions',
    14,
    'Days an applicant has to accept an offer',
  ],
  [
    'portal.student_url',
    'portal',
    '',
    'Address of the existing student portal (shown to applicants who accept a place)',
  ],
];

const TEXT: [string, string, string][] = [
  [
    'apply.status.accepted',
    'You have accepted your place. Welcome! Follow the joining instructions in your offer letter.',
    'Status page: offer accepted',
  ],
  [
    'apply.status.declined',
    'You declined this offer. You can start a new application at any time.',
    'Status page: offer declined',
  ],
  [
    'apply.offer.title',
    'Your offer of admission',
    'Heading of the offer box on the status page',
  ],
  ['apply.offer.accept_button', 'Accept my place', 'Button to accept an offer'],
  ['apply.offer.decline_button', 'Decline offer', 'Button to decline an offer'],
  [
    'apply.offer.letter_button',
    'Download offer letter (PDF)',
    'Button to download the offer letter',
  ],
  [
    'apply.offer.portal_button',
    'Go to the student portal',
    'Button shown after accepting a place',
  ],
];

export class SeedOfferLetterDefaults1790859948536 implements MigrationInterface {
  name = 'SeedOfferLetterDefaults1790859948536';

  public async up(q: QueryRunner): Promise<void> {
    for (const [key, group, value, description] of SETTINGS) {
      await q.query(
        'INSERT INTO `site_settings` (`key`, `group_name`, `value`, `description`) VALUES (?, ?, ?, ?)',
        [key, group, JSON.stringify(value), description],
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
