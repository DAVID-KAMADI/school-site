/**
 * Creates the Terms of Service, Privacy Policy and Data Processing Agreement pages and the footer
 * legal links. Safe to run on production: a page that already exists is never changed, and the
 * legal menu is only filled when it is empty. After this, edit everything in the admin.
 *
 *   npm run seed:legal
 *
 * Complete the text in [square brackets] and have an advocate review the pages before launch.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module.js';
import { PageTemplate } from '../cms/entities/page.entity.js';
import { PagesService } from '../cms/pages/pages.service.js';
import { SiteService } from '../cms/site/site.service.js';
import type { AuthUser } from '../identity/auth-user.js';
import { UserStatus } from '../identity/entities/user.entity.js';
import { UsersService } from '../identity/users.service.js';
import {
  dataProcessingAgreement,
  privacyPolicy,
  termsOfService,
  type LegalVars,
} from './legal-content.js';

const SYSTEM_EMAIL = 'website-system@system.local';

const app = await NestFactory.createApplicationContext(AppModule, {
  logger: ['error', 'warn'],
});
try {
  const ds = app.get(DataSource);
  const users = app.get(UsersService);
  const pages = app.get(PagesService);
  const site = app.get(SiteService);

  // A disabled account that "authors" system-created pages; it can never sign in.
  let [system] = (await ds.query('SELECT id FROM users WHERE email = ?', [
    SYSTEM_EMAIL,
  ])) as { id: number }[];
  if (!system) {
    const created = await users.create({
      email: SYSTEM_EMAIL,
      fullName: 'Website system',
      password: users.generatePassword(),
    });
    await users.update(created.id, { status: UserStatus.Disabled });
    system = { id: created.id };
  }
  const actor: AuthUser = {
    id: Number(system.id),
    email: SYSTEM_EMAIL,
    fullName: 'Website system',
    roles: ['super_admin'],
    permissions: [
      'admin.access',
      'pages.create',
      'pages.edit',
      'pages.publish',
    ],
    scopedPermissions: [],
    twoFactorEnabled: true,
  };

  const settings = Object.fromEntries(
    (
      (await ds.query('SELECT `key`, value FROM site_settings')) as {
        key: string;
        value: unknown;
      }[]
    ).map((r) => [r.key, r.value]),
  );
  const str = (key: string, fallback: string) =>
    typeof settings[key] === 'string' && settings[key]
      ? (settings[key] as string)
      : fallback;
  const version = str(
    'legal.terms_version',
    new Date().toISOString().slice(0, 10),
  );
  const vars: LegalVars = {
    name: str('institution.name', '[Institution name]'),
    short: str('institution.short_name', '[Short name]'),
    address: str('contact.address', '[Physical and postal address]'),
    email: str('contact.email', '[email]'),
    phone: str('contact.phone', '[phone]'),
    version,
    updated: new Date(`${version}T12:00:00Z`).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }),
  };

  const docs = [
    {
      slug: 'terms-of-service',
      title: 'Terms of Service',
      description: `The agreement between you and ${vars.name} when you use this website, create an account or apply for admission.`,
      html: termsOfService(vars),
    },
    {
      slug: 'privacy-policy',
      title: 'Privacy Policy',
      description: `What personal information ${vars.name} collects, why, who can see it, how long it is kept and your rights under the Data Protection Act, 2019.`,
      html: privacyPolicy(vars),
    },
    {
      slug: 'data-processing-agreement',
      title: 'Data Processing Agreement',
      description: `The service providers that handle personal information for ${vars.name}, and the data protection terms they must sign.`,
      html: dataProcessingAgreement(vars),
    },
  ];

  const ids: Record<string, number> = {};
  for (const doc of docs) {
    const [existing] = (await ds.query(
      'SELECT id FROM pages WHERE path = ? AND deleted_at IS NULL',
      [`/${doc.slug}`],
    )) as { id: number }[];
    if (existing) {
      ids[doc.slug] = Number(existing.id);
      console.log(`  kept    /${doc.slug} (already exists)`);
      continue;
    }
    const page = await pages.create(
      { title: doc.title, slug: doc.slug, template: PageTemplate.Standard },
      actor,
    );
    await pages.saveContent(
      page.id,
      {
        title: doc.title,
        metaDescription: doc.description,
        blocks: [{ type: 'rich_text', content: { html: doc.html } }],
        note: 'Starting text from seed:legal',
      },
      actor,
    );
    await pages.publish(page.id, actor);
    ids[doc.slug] = page.id;
    console.log(`  created /${doc.slug}`);
  }

  const [{ n }] = (await ds.query(
    "SELECT COUNT(*) n FROM menu_items mi JOIN menus m ON m.id = mi.menu_id WHERE m.location = 'legal'",
  )) as { n: string }[];
  if (Number(n) === 0) {
    await site.saveMenu(
      'legal',
      docs.map((d) => ({ label: d.title, pageId: ids[d.slug] })),
    );
    console.log('  added the footer legal links');
  } else {
    console.log('  kept the footer legal links (menu already has items)');
  }
  console.log(
    'Done. A running API shows the pages within 5 minutes (or restart it).',
  );
  console.log(
    'Complete the [bracketed] text in each page in the admin, and have it reviewed before launch.',
  );
} finally {
  await app.close();
}
