import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Admissions reference data: permissions, editable settings (fee, declaration…), default document types
 * and interface text for the application form. Programmes and intakes are institution-specific and are
 * added in the admin (or by the demo seed).
 */

const PERMISSIONS: [string, string][] = [
  ['applications.apply', 'Apply for admission (applicant portal)'],
  ['applications.view', 'View applications'],
  [
    'applications.review',
    'Review applications, documents and fees; message applicants',
  ],
  ['applications.decide', 'Offer or reject applications'],
  ['admissions.configure', 'Manage programmes, intakes and required documents'],
];

const GRANTS: [role: string, permissions: string[]][] = [
  [
    'super_admin',
    [
      'applications.view',
      'applications.review',
      'applications.decide',
      'admissions.configure',
    ],
  ],
  [
    'admissions_officer',
    [
      'applications.view',
      'applications.review',
      'applications.decide',
      'admissions.configure',
    ],
  ],
  ['applicant', ['applications.apply']],
];

const SETTINGS: [string, unknown, string][] = [
  [
    'admissions.fee',
    {
      amount: 1000,
      currency: 'KSh',
      instructions:
        'Pay the application fee through M-Pesa: go to Lipa na M-Pesa, Pay Bill, enter our Paybill number and use your application number as the account number. Then enter the M-Pesa confirmation code below so we can match your payment.',
    },
    'Application fee amount and payment instructions shown to applicants',
  ],
  [
    'admissions.declaration',
    'I confirm that the information in this application is true and complete. I understand that giving false information may lead to my application being cancelled or my admission being withdrawn.',
    'Declaration applicants must accept before submitting',
  ],
  [
    'admissions.welcome',
    'Apply online in about 15 minutes. Your answers are saved as you go, so you can stop and come back at any time.',
    'Introduction on the Apply page',
  ],
  [
    'admissions.number_prefix',
    'APP',
    'Start of every application number, e.g. APP-2027-000042',
  ],
];

const DOCUMENT_TYPES: [string, string, boolean, string, number][] = [
  [
    'National ID or birth certificate',
    'A clear photo or scan of both sides of your ID, or your birth certificate if you do not have an ID yet.',
    true,
    'any',
    5,
  ],
  [
    'KCSE result slip or certificate',
    'Your KCSE certificate, or the result slip if the certificate is not yet available.',
    true,
    'any',
    5,
  ],
  [
    'Passport photo',
    'A recent colour photo with a plain background, facing the camera.',
    true,
    'image',
    3,
  ],
  [
    'Other certificates',
    'Certificates or transcripts from other institutions, if any.',
    false,
    'any',
    10,
  ],
];

const TEXT: [string, string, string][] = [
  ['apply.title', 'Apply for admission', 'Heading on the Apply page'],
  ['apply.step.programme', 'Programme', 'Application step 1 title'],
  ['apply.step.personal', 'Personal details', 'Application step 2 title'],
  ['apply.step.next_of_kin', 'Next of kin', 'Application step 3 title'],
  ['apply.step.education', 'Education', 'Application step 4 title'],
  ['apply.step.funding', 'Funding', 'Application step 5 title'],
  ['apply.step.documents', 'Documents', 'Application step 6 title'],
  ['apply.step.review', 'Review & submit', 'Application step 7 title'],
  [
    'apply.help.programme',
    'Choose the intake, programme and how you would like to study.',
    'Help text for the programme step',
  ],
  [
    'apply.help.personal',
    'Enter your details exactly as they appear on your ID or birth certificate.',
    'Help text for the personal details step',
  ],
  [
    'apply.help.next_of_kin',
    'Someone we can contact in an emergency.',
    'Help text for the next of kin step',
  ],
  [
    'apply.help.education',
    'Enter your KCSE results as shown on your result slip or certificate.',
    'Help text for the education step',
  ],
  [
    'apply.help.funding',
    'Tell us how you plan to pay your fees. This does not affect your admission.',
    'Help text for the funding step',
  ],
  [
    'apply.help.documents',
    'Upload clear photos or PDFs. Phone photos are fine as long as everything can be read.',
    'Help text for the documents step',
  ],
  [
    'apply.help.review',
    'Check your answers, accept the declaration and submit.',
    'Help text for the review step',
  ],
  ['apply.saved', 'Saved', 'Shown after the form saves automatically'],
  ['apply.submitted_title', 'Application received', 'Heading after submitting'],
  [
    'apply.grade_warning',
    'Your mean grade is below the usual minimum for this programme. You can still apply; admissions will consider your application.',
    'Warning when a mean grade is below the programme minimum',
  ],
];

export class SeedAdmissionsDefaults1790842705224 implements MigrationInterface {
  name = 'SeedAdmissionsDefaults1790842705224';

  public async up(q: QueryRunner): Promise<void> {
    for (const [key, description] of PERMISSIONS) {
      await q.query(
        'INSERT INTO `permissions` (`key`, `description`) VALUES (?, ?)',
        [key, description],
      );
    }
    for (const [role, keys] of GRANTS) {
      await q.query(
        'INSERT INTO `role_permissions` (`role_id`, `permission_id`) SELECT r.id, p.id FROM `roles` r JOIN `permissions` p ON p.`key` IN (?) WHERE r.`key` = ?',
        [keys, role],
      );
    }
    for (const [key, value, description] of SETTINGS) {
      await q.query(
        "INSERT INTO `site_settings` (`key`, `group_name`, `value`, `description`) VALUES (?, 'admissions', ?, ?)",
        [key, JSON.stringify(value), description],
      );
    }
    for (const [
      i,
      [name, description, required, accepts, maxSize],
    ] of DOCUMENT_TYPES.entries()) {
      await q.query(
        'INSERT INTO `document_types` (`name`, `description`, `is_required`, `accepts`, `max_size_mb`, `sort_order`) VALUES (?, ?, ?, ?, ?, ?)',
        [name, description, required ? 1 : 0, accepts, maxSize, i],
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
    await q.query('DELETE FROM `document_types` WHERE `name` IN (?)', [
      DOCUMENT_TYPES.map(([n]) => n),
    ]);
    await q.query('DELETE FROM `site_settings` WHERE `key` IN (?)', [
      SETTINGS.map(([k]) => k),
    ]);
    await q.query('DELETE FROM `permissions` WHERE `key` IN (?)', [
      PERMISSIONS.map(([k]) => k),
    ]);
  }
}
