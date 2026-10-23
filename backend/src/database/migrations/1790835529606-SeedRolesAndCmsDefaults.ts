import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reference data every environment needs (training, staging and production):
 * roles, CMS permissions, menu locations, editable site settings and default interface text.
 * All values here are starting points that editors change from the admin side.
 */

const PERMISSIONS: [key: string, description: string][] = [
  ['admin.access', 'Sign in to the administration portal'],
  ['pages.create', 'Create new pages'],
  ['pages.edit', 'Edit page content and images'],
  ['pages.publish', 'Publish, unpublish and schedule pages'],
  ['pages.delete', 'Move pages to trash and restore them'],
  ['media.upload', 'Upload images and documents'],
  ['media.edit', 'Edit media details (alt text, caption, crop)'],
  ['media.delete', 'Delete media'],
  ['menus.edit', 'Edit menus'],
  ['settings.edit', 'Edit site-wide settings'],
  ['text_strings.edit', 'Edit interface text'],
  ['redirects.edit', 'Manage URL redirects'],
  ['users.manage', 'Create users and assign roles'],
  ['audit.view', 'View the audit log'],
];

const ROLES: [
  key: string,
  name: string,
  description: string,
  permissions: string[] | 'all',
][] = [
  [
    'super_admin',
    'Super administrator',
    'Full system access. Use sparingly.',
    'all',
  ],
  [
    'publisher',
    'Publisher',
    'Edits and approves content and makes it live.',
    [
      'admin.access',
      'pages.create',
      'pages.edit',
      'pages.publish',
      'pages.delete',
      'media.upload',
      'media.edit',
      'media.delete',
      'menus.edit',
      'text_strings.edit',
      'redirects.edit',
    ],
  ],
  [
    'content_editor',
    'Content editor',
    'Creates and edits content; submits it for approval.',
    [
      'admin.access',
      'pages.create',
      'pages.edit',
      'media.upload',
      'media.edit',
    ],
  ],
  [
    'admissions_officer',
    'Admissions officer',
    'Applications and admission workflows.',
    ['admin.access'],
  ],
  [
    'finance_officer',
    'Finance officer',
    'Fees, invoices, payments and financial reports.',
    ['admin.access'],
  ],
  [
    'librarian',
    'Librarian',
    'Library resources, loans and notices.',
    ['admin.access'],
  ],
  [
    'hostel_officer',
    'Hostel officer',
    'Hostel applications, rooms and allocations.',
    ['admin.access'],
  ],
  [
    'lecturer',
    'Lecturer',
    'Assigned academic data and permitted student workflows.',
    [],
  ],
  [
    'student',
    'Student',
    'Own academic, finance, library, hostel and support data.',
    [],
  ],
  ['applicant', 'Applicant', 'Own application, documents and status.', []],
];

const MENUS: [location: string, name: string][] = [
  ['main', 'Main navigation'],
  ['utility', 'Utility bar (News, Events, Careers, Visit)'],
  ['footer', 'Footer links'],
];

const SETTINGS: [
  key: string,
  group: string,
  value: unknown,
  description: string,
][] = [
  [
    'institution.name',
    'institution',
    'Institution Name',
    'Full official name shown in the header, footer and page titles',
  ],
  [
    'institution.short_name',
    'institution',
    'Institution',
    'Short name used where space is limited',
  ],
  [
    'institution.tagline',
    'institution',
    '',
    'One-line tagline under the logo or in the hero',
  ],
  [
    'institution.logo_media_id',
    'institution',
    null,
    'Logo image from the media library',
  ],
  [
    'institution.favicon_media_id',
    'institution',
    null,
    'Browser tab icon from the media library',
  ],
  ['contact.phone', 'contact', '', 'Main phone number'],
  [
    'contact.whatsapp',
    'contact',
    '',
    'WhatsApp number for admissions enquiries',
  ],
  ['contact.email', 'contact', '', 'Main enquiries email'],
  ['contact.address', 'contact', '', 'Postal and physical address'],
  [
    'contact.map_location',
    'contact',
    { lat: null, lng: null },
    'Campus map pin',
  ],
  [
    'contact.office_hours',
    'contact',
    '',
    'Office hours shown on the contact page',
  ],
  [
    'payments.mpesa_paybill',
    'payments',
    '',
    'M-Pesa Paybill number shown to visitors',
  ],
  [
    'payments.mpesa_account_hint',
    'payments',
    'Use your student or application number as the account number',
    'Instruction shown next to the Paybill',
  ],
  [
    'social.links',
    'social',
    {
      facebook: '',
      x: '',
      instagram: '',
      linkedin: '',
      youtube: '',
      tiktok: '',
    },
    'Social media profile URLs',
  ],
  [
    'banner.alert',
    'banners',
    { enabled: false, text: '', link: null, level: 'info' },
    'Site-wide alert banner (emergencies, closures, deadlines)',
  ],
  [
    'banner.intake',
    'banners',
    { enabled: false, text: '', link: null, deadline: null },
    'Next intake and application deadline banner',
  ],
  [
    'seo.default_description',
    'seo',
    '',
    'Fallback meta description for pages without one',
  ],
  [
    'seo.default_social_image_media_id',
    'seo',
    null,
    'Fallback image for link previews',
  ],
];

const TEXT_STRINGS: [key: string, value: string, description: string][] = [
  [
    'header.apply_button',
    'Apply Now',
    'Main call-to-action button in the header',
  ],
  [
    'header.portal_button',
    'Portal',
    'Header link to the student/applicant portal',
  ],
  [
    'header.search_placeholder',
    'Search programs, news and pages',
    'Placeholder text in the site search box',
  ],
  ['header.menu_button', 'Menu', 'Mobile menu button label'],
  [
    'footer.copyright',
    '© {year} {institution_name}. All rights reserved.',
    'Footer copyright line',
  ],
  ['common.read_more', 'Read more', 'Link text on cards and news items'],
  [
    'common.view_all',
    'View all',
    'Link to a full list (news, events, programs)',
  ],
  ['common.skip_to_content', 'Skip to main content', 'Accessibility skip link'],
  [
    'form.required_field',
    'This field is required.',
    'Validation message for empty required fields',
  ],
  [
    'form.invalid_email',
    'Enter a valid email address.',
    'Validation message for email fields',
  ],
  ['form.submit', 'Submit', 'Default form submit button'],
  ['error.not_found_title', 'Page not found', 'Heading on the 404 page'],
  [
    'error.not_found_text',
    'The page you are looking for may have moved. Try searching or use the links below.',
    'Text on the 404 page',
  ],
  [
    'error.generic',
    'Something went wrong. Please try again.',
    'General error message',
  ],
];

export class SeedRolesAndCmsDefaults1790835529606 implements MigrationInterface {
  name = 'SeedRolesAndCmsDefaults1790835529606';

  public async up(q: QueryRunner): Promise<void> {
    for (const [key, description] of PERMISSIONS) {
      await q.query(
        'INSERT INTO `permissions` (`key`, `description`) VALUES (?, ?)',
        [key, description],
      );
    }

    for (const [key, name, description, permissions] of ROLES) {
      await q.query(
        'INSERT INTO `roles` (`key`, `name`, `description`) VALUES (?, ?, ?)',
        [key, name, description],
      );
      const keys =
        permissions === 'all' ? PERMISSIONS.map(([k]) => k) : permissions;
      if (keys.length === 0) continue;
      await q.query(
        `INSERT INTO \`role_permissions\` (\`role_id\`, \`permission_id\`)
         SELECT r.id, p.id FROM \`roles\` r JOIN \`permissions\` p ON p.\`key\` IN (?)
         WHERE r.\`key\` = ?`,
        [keys, key],
      );
    }

    for (const [location, name] of MENUS) {
      await q.query('INSERT INTO `menus` (`location`, `name`) VALUES (?, ?)', [
        location,
        name,
      ]);
    }

    for (const [key, group, value, description] of SETTINGS) {
      await q.query(
        'INSERT INTO `site_settings` (`key`, `group_name`, `value`, `description`) VALUES (?, ?, ?, ?)',
        [key, group, JSON.stringify(value), description],
      );
    }

    for (const [key, value, description] of TEXT_STRINGS) {
      await q.query(
        "INSERT INTO `text_strings` (`key`, `locale`, `value`, `description`) VALUES (?, 'en', ?, ?)",
        [key, value, description],
      );
    }

    // Home page exists from day one so the site always has a root. Its content is built in the CMS.
    await q.query(
      "INSERT INTO `pages` (`title`, `slug`, `path`, `template`, `status`) VALUES ('Home', '', '/', 'landing', 'draft')",
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query("DELETE FROM `pages` WHERE `path` = '/'");
    await q.query('DELETE FROM `text_strings` WHERE `key` IN (?)', [
      TEXT_STRINGS.map(([k]) => k),
    ]);
    await q.query('DELETE FROM `site_settings` WHERE `key` IN (?)', [
      SETTINGS.map(([k]) => k),
    ]);
    await q.query('DELETE FROM `menus` WHERE `location` IN (?)', [
      MENUS.map(([l]) => l),
    ]);
    await q.query('DELETE FROM `roles` WHERE `key` IN (?)', [
      ROLES.map(([k]) => k),
    ]);
    await q.query('DELETE FROM `permissions` WHERE `key` IN (?)', [
      PERMISSIONS.map(([k]) => k),
    ]);
  }
}
