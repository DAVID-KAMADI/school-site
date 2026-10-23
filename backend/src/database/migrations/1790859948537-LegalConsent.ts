import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Terms of Service, Privacy Policy and Data Processing Agreement support:
 * a footer "legal" menu, a record of which terms version each account agreed to and when,
 * editable legal settings, and the wording of the consent checkbox on the Apply page.
 * The pages themselves are created with `npm run seed:legal` so they stay editable in the admin.
 */

const SETTINGS: [key: string, value: unknown, description: string][] = [
  [
    'legal.terms_version',
    '2026-10-01',
    'Version of the Terms of Service and Privacy Policy (use the date). Change it when you publish an important update: each new account records the version it agreed to.',
  ],
  [
    'legal.terms_path',
    '/terms-of-service',
    'Address of the Terms of Service page (linked from the Apply page)',
  ],
  [
    'legal.privacy_path',
    '/privacy-policy',
    'Address of the Privacy Policy page (linked from the Apply page)',
  ],
];

const TEXT: [string, string, string][] = [
  [
    'apply.register.consent',
    'I have read and agree to the {terms} and the {privacy}, and I agree that {institution_name} may use my information to process my application.',
    'Consent checkbox when creating an applicant account. {terms} and {privacy} become links.',
  ],
  [
    'apply.register.minor',
    'If I am under 18, my parent or guardian has agreed to this application.',
    'Second line of the consent checkbox (children under the Data Protection Act)',
  ],
  [
    'legal.terms_link',
    'Terms of Service',
    'Link text for the Terms of Service',
  ],
  ['legal.privacy_link', 'Privacy Policy', 'Link text for the Privacy Policy'],
];

export class LegalConsent1790859948537 implements MigrationInterface {
  name = 'LegalConsent1790859948537';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      'ALTER TABLE `users` ADD `terms_accepted_at` datetime NULL, ADD `terms_version` varchar(20) NULL',
    );
    await q.query(
      "INSERT INTO `menus` (`location`, `name`) VALUES ('legal', 'Footer legal links (Terms, Privacy)')",
    );
    for (const [key, value, description] of SETTINGS) {
      await q.query(
        "INSERT INTO `site_settings` (`key`, `group_name`, `value`, `description`) VALUES (?, 'legal', ?, ?)",
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
    await q.query("DELETE FROM `menus` WHERE `location` = 'legal'");
    await q.query(
      'ALTER TABLE `users` DROP COLUMN `terms_version`, DROP COLUMN `terms_accepted_at`',
    );
  }
}
