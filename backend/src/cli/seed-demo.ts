/**
 * Demo content for a visual reference: a complete home page and the main pages (About us, Academics,
 * Admissions, Student life, Contact us), menus and settings, built through the real CMS services so
 * everything stays editable in the admin.
 *
 *   npm run seed:demo             create (or re-create) the demo content
 *   npm run seed:demo -- --remove remove it again
 *
 * The institution ("Mwangaza College"), people, numbers and contact details are fictional placeholders.
 * Photos are downloaded from Unsplash (free licence, https://unsplash.com/license) and credited in the media library.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { DataSource } from 'typeorm';
import { AdmissionsConfigService } from '../admissions/admissions-config.service.js';
import { AppModule } from '../app.module.js';
import { ContentCacheService } from '../cms/content-cache.service.js';
import { MediaService } from '../cms/media/media.service.js';
import { MediaStorage } from '../cms/media/storage.js';
import { PagesService } from '../cms/pages/pages.service.js';
import { SiteService } from '../cms/site/site.service.js';
import type { AuthUser } from '../identity/auth-user.js';
import { UserStatus } from '../identity/entities/user.entity.js';
import { UsersService } from '../identity/users.service.js';

const DEMO_EMAIL = 'demo-content@system.local';
const CACHE_DIR = join(process.cwd(), '.demo-cache');

const PHOTOS = {
  campusAerial: [
    'photo-1638636214032-581196ffd400',
    'Aerial view of the main campus buildings among green trees',
    'Jolame Chirwa / Unsplash',
  ],
  campusFountain: [
    'photo-1638636199555-5085c5f4fc56',
    'Fountain in front of the main administration building',
    'Jolame Chirwa / Unsplash',
  ],
  gradsGroup: [
    'photo-1645263012710-35e2fc89cb5c',
    'Graduates celebrating together after the graduation ceremony',
    'Oscar Omondi / Unsplash',
  ],
  gradCap: [
    'photo-1645262803541-8c47413511e6',
    'A graduate throwing her cap into the air',
    'Oscar Omondi / Unsplash',
  ],
  gradsPose: [
    'photo-1645262960690-5cb9db42d35a',
    'A group of graduates in gowns posing for a photo',
    'Oscar Omondi / Unsplash',
  ],
  gradsTwo: [
    'photo-1645262960695-ec79787ffeac',
    'Two graduates in gowns smiling together',
    'Oscar Omondi / Unsplash',
  ],
  gradWoman: [
    'photo-1686213011624-8578b598ef0f',
    'A graduate in her gown holding her certificate',
    'Divaris Shirichena / Unsplash',
  ],
  studentsLaptops: [
    'photo-1655720348590-c739c860beed',
    'Students working on laptops together on a bench',
    'Iwaria Inc. / Unsplash',
  ],
  ictPair: [
    'photo-1531482615713-2afd69097998',
    'Two students working together at a computer',
    'Christina @ wocintechchat.com / Unsplash',
  ],
  laptopStudent: [
    'photo-1620829813573-7c9e1877706f',
    'A student studying on a laptop',
    'Kojo Kwarteng / Unsplash',
  ],
  lab: [
    'photo-1576089275954-40cd98bfcfdb',
    'Students carrying out an experiment in the science laboratory',
    'National Cancer Institute / Unsplash',
  ],
  clinical: [
    'photo-1582719366768-de4481b828ce',
    'Clinical skills training beside a hospital bed',
    'National Cancer Institute / Unsplash',
  ],
  football: [
    'photo-1722978687695-212eecfa4cbe',
    'Students playing a game of football',
    'Dion Martins / Unsplash',
  ],
  team: [
    'photo-1711645313209-a386d71bc991',
    'The college football team on the pitch',
    'Barnabas Lartey-Odoi Tetteh / Unsplash',
  ],
  library: [
    'photo-1683319598210-d70486f2f996',
    'Students studying at tables in the library',
    'Ilia Bronskiy / Unsplash',
  ],
  speaker: [
    'photo-1551731409-43eb3e517a1a',
    'A student speaking into a microphone at a campus event',
    'Wonderlane / Unsplash',
  ],
  gradPortrait: [
    'photo-1594750852563-5ed8e0421d40',
    'A graduate in academic dress',
    'Nqobile Vundla / Unsplash',
  ],
} as const;
type PhotoKey = keyof typeof PHOTOS;

/** Where the subject is in each photo (0–1), so crops keep it in view. */
const FOCAL: Partial<Record<PhotoKey, [number, number]>> = {
  gradCap: [0.5, 0.85],
  gradWoman: [0.5, 0.3],
  gradsGroup: [0.55, 0.35],
  football: [0.55, 0.55],
  speaker: [0.55, 0.35],
};

const { values } = parseArgs({
  options: { remove: { type: 'boolean', default: false } },
});

const app = await NestFactory.createApplicationContext(AppModule, {
  logger: ['error', 'warn'],
});
const ds = app.get(DataSource);
const users = app.get(UsersService);
const pages = app.get(PagesService);
const media = app.get(MediaService);
const site = app.get(SiteService);
const cache = app.get(ContentCacheService);
const admissions = app.get(AdmissionsConfigService);

// ---------------------------------------------------------------------------

async function removeDemo() {
  const [demo] = await ds.query('SELECT id FROM users WHERE email = ?', [
    DEMO_EMAIL,
  ]);
  if (!demo) return;
  const demoId = Number(demo.id);
  const files: { k: string }[] = await ds.query(
    `SELECT m.storage_key k FROM media m WHERE m.uploaded_by_id = ?
     UNION SELECT v.storage_key FROM media_variants v JOIN media m ON m.id = v.media_id WHERE m.uploaded_by_id = ?`,
    [demoId, demoId],
  );
  const storage = new MediaStorage();
  await Promise.all(files.map((f) => storage.remove(f.k)));
  // Only the menus the demo fills; the legal footer links (seed:legal) are kept.
  await ds.query(
    "DELETE mi FROM menu_items mi JOIN menus m ON m.id = mi.menu_id WHERE m.location IN ('main', 'utility', 'footer')",
  );
  const demoPages: { id: number; path: string }[] = await ds.query(
    "SELECT id, path FROM pages WHERE created_by_id = ? AND path <> '/' ORDER BY LENGTH(path) DESC",
    [demoId],
  );
  for (const p of demoPages) {
    await ds.query(
      'UPDATE pages SET published_revision_id = NULL WHERE id = ?',
      [p.id],
    );
    await ds.query(
      'DELETE FROM media_usage WHERE entity_type = ? AND entity_id = ?',
      ['page', String(p.id)],
    );
    await ds.query('DELETE FROM pages WHERE id = ?', [p.id]);
  }
  await ds.query(
    "DELETE FROM redirects WHERE from_path IN ('/about', '/student-life', '/academics', '/admissions', '/contact')",
  );
  // Reset the home page to an empty draft if the demo filled it.
  const [home] = await ds.query(
    "SELECT id, updated_by_id FROM pages WHERE path = '/'",
  );
  if (home && Number(home.updated_by_id) === demoId) {
    await ds.query(
      "UPDATE pages SET published_revision_id = NULL, status = 'draft', template = 'landing', seo_title = NULL, meta_description = NULL, social_image_id = NULL WHERE id = ?",
      [home.id],
    );
    await ds.query('DELETE FROM page_blocks WHERE page_id = ?', [home.id]);
    await ds.query('DELETE FROM page_revisions WHERE page_id = ?', [home.id]);
    await ds.query(
      "DELETE FROM media_usage WHERE entity_type = 'page' AND entity_id = ?",
      [String(home.id)],
    );
  }
  await ds.query('DELETE FROM media WHERE uploaded_by_id = ?', [demoId]);
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await ds.query(
      'UPDATE site_settings SET value = ? WHERE `key` = ? AND updated_by_id = ?',
      [JSON.stringify(value), key, demoId],
    );
  }
  const codes = DEMO_PROGRAMMES.map((p) => p.code);
  await ds.query('UPDATE programmes SET is_active = 0 WHERE code IN (?)', [
    codes,
  ]);
  await ds.query(
    'DELETE FROM programmes WHERE code IN (?) AND id NOT IN (SELECT programme_id FROM applications WHERE programme_id IS NOT NULL)',
    [codes],
  );
  await ds.query(
    "UPDATE intakes SET is_active = 0 WHERE name IN ('January 2027', 'September 2027')",
  );
  await ds.query('DELETE FROM short_courses WHERE title IN (?)', [
    DEMO_SHORT_COURSES.map((c) => c.title),
  ]);
  await ds.query(
    "DELETE FROM intakes WHERE name IN ('January 2027', 'September 2027') AND id NOT IN (SELECT intake_id FROM applications WHERE intake_id IS NOT NULL)",
  );
  await ds.query('DELETE FROM users WHERE id = ?', [demoId]);
  console.log('Demo content removed.');
}

async function seed() {
  // A disabled account that "authors" the demo content, so it can be found and removed later.
  const author = await users.create({
    email: DEMO_EMAIL,
    fullName: 'Demo content',
    password: users.generatePassword(),
  });
  await users.update(author.id, { status: UserStatus.Disabled });
  const actor: AuthUser = {
    id: author.id,
    email: DEMO_EMAIL,
    fullName: 'Demo content',
    roles: ['super_admin'],
    permissions: [
      'admin.access',
      'pages.create',
      'pages.edit',
      'pages.publish',
      'pages.delete',
      'media.upload',
      'menus.edit',
      'settings.edit',
    ],
    scopedPermissions: [],
    twoFactorEnabled: true,
  };

  console.log('Downloading and processing photos…');
  const ids = {} as Record<PhotoKey, number>;
  for (const [key, [photo, alt, credit]] of Object.entries(PHOTOS) as [
    PhotoKey,
    (typeof PHOTOS)[PhotoKey],
  ][]) {
    const buffer = await photoBuffer(photo);
    const uploaded = await media.upload(
      { originalname: `${key}.jpg`, buffer, size: buffer.length },
      { altText: alt, folder: 'Demo photos' },
      author.id,
    );
    const [focalX, focalY] = FOCAL[key] ?? [0.5, 0.4];
    await media.update(uploaded.id, {
      credit,
      hasConsent: true,
      focalX,
      focalY,
    });
    ids[key] = uploaded.id;
    process.stdout.write('.');
  }
  console.log('');

  const pageIds: Record<string, number> = {};
  for (const [slug, title] of [
    ['about-us', 'About us'],
    ['academics', 'Academics'],
    ['admissions', 'Admissions'],
    ['student-life', 'Student life'],
    ['contact-us', 'Contact us'],
  ]) {
    pageIds[slug] = (
      await pages.create({ title, slug, template: 'landing' as never }, actor)
    ).id;
  }
  const [home] = await ds.query("SELECT id FROM pages WHERE path = '/'");
  pageIds['home'] = Number(home.id);

  const content = pageContent(ids);
  for (const [slug, page] of Object.entries(content)) {
    await pages.saveContent(
      pageIds[slug],
      { ...page, note: 'Demo content' },
      actor,
    );
    await pages.publish(pageIds[slug], actor);
  }

  await site.saveMenu('main', [
    { label: 'About us', pageId: pageIds['about-us'] },
    { label: 'Academics', pageId: pageIds['academics'] },
    { label: 'Admissions', pageId: pageIds['admissions'] },
    { label: 'Student life', pageId: pageIds['student-life'] },
    { label: 'Contact us', pageId: pageIds['contact-us'] },
    { label: 'Apply now', url: '/apply', isButton: true },
  ]);
  await site.saveMenu('utility', [
    { label: 'Fees & funding', url: '/admissions#fees' },
    { label: 'Library', pageId: pageIds['student-life'] },
    { label: 'Visit campus', pageId: pageIds['contact-us'] },
  ]);
  await site.saveMenu('footer', [
    {
      label: 'Study',
      pageId: pageIds['academics'],
      children: [
        { label: 'Programmes', pageId: pageIds['academics'] },
        { label: 'How to apply', pageId: pageIds['admissions'] },
        { label: 'Fees & funding', url: '/admissions#fees' },
      ],
    },
    {
      label: 'College',
      pageId: pageIds['about-us'],
      children: [
        { label: 'About us', pageId: pageIds['about-us'] },
        { label: 'Student life', pageId: pageIds['student-life'] },
        { label: 'Contact us', pageId: pageIds['contact-us'] },
      ],
    },
  ]);

  const settings: Record<string, unknown> = {
    'institution.name': 'Mwangaza College',
    'institution.short_name': 'Mwangaza',
    'institution.tagline':
      'Light for every learner. Practical, career-focused education in Nairobi since 1998.',
    'contact.phone': '+254 700 000 000',
    'contact.whatsapp': '+254 700 000 001',
    'contact.email': 'info@example.ac.ke',
    'contact.address': 'Thika Road, P.O. Box 00000-00100, Nairobi, Kenya',
    'contact.office_hours':
      'Monday to Friday, 8:00 am to 5:00 pm. Saturday, 9:00 am to 1:00 pm.',
    'payments.mpesa_paybill': '000000',
    'social.links': {
      facebook: 'https://facebook.com',
      x: 'https://x.com',
      instagram: 'https://instagram.com',
      linkedin: 'https://linkedin.com',
      youtube: 'https://youtube.com',
      tiktok: '',
    },
    'banner.intake': {
      enabled: true,
      text: 'September 2027 intake: applications close on 15 August.',
      link: '/apply',
      deadline: null,
    },
    'seo.default_description':
      'Mwangaza College offers certificate, diploma and degree programmes in business, technology and health sciences in Nairobi, Kenya.',
  };
  // Never overwrite a setting a real person has edited in the admin.
  for (const [key, value] of Object.entries(settings)) {
    const [row] = await ds.query(
      'SELECT updated_by_id FROM site_settings WHERE `key` = ?',
      [key],
    );
    if (row?.updated_by_id) {
      console.log(`Kept your own value for ${key}.`);
      continue;
    }
    await site.saveSetting(key, value, author.id);
  }

  for (const [i, prog] of DEMO_PROGRAMMES.entries()) {
    await admissions.saveProgramme(null, {
      ...prog,
      sortOrder: i,
      isActive: true,
    });
  }
  for (const [i, course] of DEMO_SHORT_COURSES.entries()) {
    await admissions.saveShortCourse(null, {
      ...course,
      sortOrder: i,
      isActive: true,
    });
  }
  const day = 86_400_000;
  await admissions.saveIntake(null, {
    name: 'January 2027',
    opensAt: new Date(Date.now() - day),
    closesAt: new Date('2026-12-15T23:59:00+03:00'),
    startsOn: '2027-01-11',
    isActive: true,
  });
  await admissions.saveIntake(null, {
    name: 'September 2027',
    opensAt: new Date(Date.now() - day),
    closesAt: new Date('2027-08-15T23:59:00+03:00'),
    startsOn: '2027-09-06',
    isActive: true,
  });

  console.log(
    'Demo content created: home, about us, academics, admissions, student life, contact us.',
  );
}

// ---------------------------------------------------------------------------

async function photoBuffer(photo: string): Promise<Buffer> {
  await mkdir(CACHE_DIR, { recursive: true });
  const file = join(CACHE_DIR, `${photo}.jpg`);
  if (existsSync(file)) return readFile(file);
  const res = await fetch(
    `https://images.unsplash.com/${photo}?w=2400&q=82&fm=jpg&fit=max`,
  );
  if (!res.ok)
    throw new Error(`Could not download ${photo}: HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  await writeFile(file, buffer);
  return buffer;
}

const DEMO_SHORT_COURSES = [
  {
    title: 'Computer Packages',
    category: 'ICT',
    summary:
      'Windows, Word, Excel, PowerPoint, email and safe internet use, from the basics to confident everyday use.',
    duration: '6 weeks',
    fee: 'KSh 8,500',
    delivery: 'in_person',
    schedule: 'Weekdays, 2pm–5pm or Saturdays',
  },
  {
    title: 'GIS and Remote Sensing Essentials',
    category: 'ICT',
    summary:
      'Make maps and analyse spatial data with QGIS, GPS field data and free satellite imagery.',
    duration: '2 weeks',
    fee: 'KSh 35,000',
    delivery: 'blended',
    schedule: 'Monday to Friday, 9am–4pm',
  },
  {
    title: 'Bookkeeping with QuickBooks',
    category: 'Business',
    summary:
      'Record sales, expenses and payroll, reconcile M-Pesa and bank statements, and produce monthly reports.',
    duration: '4 weeks',
    fee: 'KSh 12,000',
    delivery: 'in_person',
    schedule: 'Evenings, 5:30pm–8pm',
  },
  {
    title: 'First Aid and Basic Life Support',
    category: 'Health',
    summary:
      'CPR, choking, bleeding and burns, with a certificate on completion. Ideal for workplaces and schools.',
    duration: '3 days',
    fee: 'KSh 6,000',
    delivery: 'in_person',
    schedule: 'Friday to Sunday',
  },
];

const DEMO_PROGRAMMES = [
  {
    code: 'CBM',
    name: 'Certificate in Business Management',
    level: 'certificate',
    school: 'Business & Management',
    duration: '1 year',
    studyModes: ['full_time', 'evening'],
    minMeanGrade: 'D',
  },
  {
    code: 'DAC',
    name: 'Diploma in Accounting',
    level: 'diploma',
    school: 'Business & Management',
    duration: '2 years',
    studyModes: ['full_time', 'evening', 'weekend'],
    minMeanGrade: 'C-',
  },
  {
    code: 'BCOM',
    name: 'Bachelor of Commerce',
    level: 'degree',
    school: 'Business & Management',
    duration: '4 years',
    studyModes: ['full_time', 'part_time'],
    minMeanGrade: 'C+',
  },
  {
    code: 'CICT',
    name: 'Certificate in ICT',
    level: 'certificate',
    school: 'Computing & Engineering',
    duration: '1 year',
    studyModes: ['full_time', 'evening'],
    minMeanGrade: 'D',
  },
  {
    code: 'DSD',
    name: 'Diploma in Software Development',
    level: 'diploma',
    school: 'Computing & Engineering',
    duration: '2 years',
    studyModes: ['full_time', 'evening'],
    minMeanGrade: 'C-',
    description:
      'Web and mobile development, databases and cloud, with a 3-month industrial attachment.',
  },
  {
    code: 'DEE',
    name: 'Diploma in Electrical Engineering',
    level: 'diploma',
    school: 'Computing & Engineering',
    duration: '3 years',
    studyModes: ['full_time'],
    minMeanGrade: 'C-',
  },
  {
    code: 'BSCS',
    name: 'BSc Computer Science',
    level: 'degree',
    school: 'Computing & Engineering',
    duration: '4 years',
    studyModes: ['full_time'],
    minMeanGrade: 'C+',
  },
  {
    code: 'CCH',
    name: 'Certificate in Community Health',
    level: 'certificate',
    school: 'Health Sciences',
    duration: '1 year',
    studyModes: ['full_time'],
    minMeanGrade: 'D',
  },
  {
    code: 'DKRN',
    name: 'Diploma in Nursing',
    level: 'diploma',
    school: 'Health Sciences',
    duration: '3 years',
    studyModes: ['full_time'],
    minMeanGrade: 'C',
  },
  {
    code: 'BSN',
    name: 'BSc Nursing',
    level: 'degree',
    school: 'Health Sciences',
    duration: '4 years',
    studyModes: ['full_time'],
    minMeanGrade: 'C+',
  },
];

const DEFAULT_SETTINGS: Record<string, unknown> = {
  'institution.name': 'Institution Name',
  'institution.short_name': 'Institution',
  'institution.tagline': '',
  'contact.phone': '',
  'contact.whatsapp': '',
  'contact.email': '',
  'contact.address': '',
  'contact.office_hours': '',
  'payments.mpesa_paybill': '',
  'social.links': {
    facebook: '',
    x: '',
    instagram: '',
    linkedin: '',
    youtube: '',
    tiktok: '',
  },
  'banner.intake': { enabled: false, text: '', link: null, deadline: null },
  'seo.default_description': '',
};

const link = (label: string, href: string) => ({
  label,
  href,
  openInNewTab: false,
});

function pageContent(p: Record<PhotoKey, number>) {
  const block = (type: string, content: Record<string, unknown>) => ({
    type,
    isHidden: false,
    content,
  });
  return {
    home: {
      title: 'Home',
      template: 'landing' as never,
      metaDescription:
        'Certificate, diploma and degree programmes in business, technology and health sciences. September 2027 intake now open.',
      socialImageId: p.gradsGroup,
      blocks: [
        block('hero', {
          eyebrow: 'September 2027 intake now open',
          heading: 'Learn today. Lead tomorrow.',
          text: 'Practical, career-focused programmes taught by people who work in the field, on a green campus ten minutes from Nairobi CBD.',
          mediaId: p.campusAerial,
          slides: [p.gradsGroup, p.studentsLaptops, p.lab],
          buttons: [
            link('Apply now', '/apply'),
            link('Explore programmes', '/academics'),
          ],
          height: 'full',
        }),
        block('cards', {
          variant: 'tiles',
          columns: 4,
          items: [
            {
              title: 'Apply online',
              text: 'Start your application in 10 minutes.',
              link: link('Apply', '/apply'),
            },
            {
              title: 'Find a programme',
              text: '46 certificate, diploma and degree courses.',
              link: link('Programmes', '/academics'),
            },
            {
              title: 'Fees & funding',
              text: 'HELB, bursaries and M-Pesa payments.',
              link: link('Fees', '/admissions#fees'),
            },
            {
              title: 'Visit campus',
              text: 'Book a tour any weekday.',
              link: link('Visit', '/contact-us'),
            },
          ],
        }),
        block('image_text', {
          eyebrow: 'Who we are',
          heading: 'A college that opens doors',
          html: '<p>For more than 25 years Mwangaza College has prepared young Kenyans for work they are proud of. Our classes are small, our lecturers come from industry, and every programme includes a real attachment with an employer.</p><p>We are accredited by the relevant national bodies, and our graduates work in banks, hospitals, tech companies and county governments across East Africa.</p>',
          mediaId: p.campusFountain,
          imagePosition: 'left',
          button: link('Our story', '/about-us'),
        }),
        block('stats', {
          eyebrow: 'Mwangaza at a glance',
          heading: 'Numbers we are proud of',
          background: 'dark',
          items: [
            {
              value: '4,200',
              label: 'Students',
              context: 'from 38 of Kenya’s 47 counties',
            },
            {
              value: '46',
              label: 'Programmes',
              context: 'certificate, diploma and degree',
            },
            {
              value: '89%',
              label: 'Employed',
              context: 'within a year of graduating',
            },
            {
              value: '120+',
              label: 'Industry partners',
              context: 'offering attachments and jobs',
            },
          ],
        }),
        block('cards', {
          eyebrow: 'Study with us',
          heading: 'One institution, many career paths',
          intro:
            'Choose from programmes designed with employers and taught in modern labs and studios.',
          columns: 3,
          items: [
            {
              title: 'Business & Management',
              text: 'Accounting, procurement, human resources, entrepreneurship and supply chain.',
              mediaId: p.gradsTwo,
              link: link('View programmes', '/academics'),
            },
            {
              title: 'Computing & Engineering',
              text: 'Software development, networking, cyber security and electrical engineering.',
              mediaId: p.ictPair,
              link: link('View programmes', '/academics'),
            },
            {
              title: 'Health Sciences',
              text: 'Nursing, clinical medicine, nutrition and community health.',
              mediaId: p.clinical,
              link: link('View programmes', '/academics'),
            },
          ],
        }),
        block('cards', {
          eyebrow: 'Campus life',
          heading: 'More than a classroom',
          intro:
            'Clubs, sport, faith, leadership and a library that is open late during exams.',
          variant: 'overlay',
          columns: 4,
          background: 'light',
          items: [
            {
              title: 'Sports',
              text: 'Football, athletics, basketball and more.',
              mediaId: p.football,
              link: link('Explore', '/student-life'),
            },
            {
              title: 'Library',
              text: 'Open until 10 pm, with e-resources.',
              mediaId: p.library,
              link: link('Explore', '/student-life'),
            },
            {
              title: 'Clubs & societies',
              text: 'Over 30 student-run clubs.',
              mediaId: p.speaker,
              link: link('Explore', '/student-life'),
            },
            {
              title: 'Graduation',
              text: 'Celebrating 1,100 graduates in 2026.',
              mediaId: p.gradCap,
              link: link('Explore', '/student-life'),
            },
          ],
        }),
        block('testimonial', {
          quote:
            'My attachment at a Nairobi tech company turned into a job offer before I had even graduated. The lecturers knew exactly what employers were looking for.',
          name: 'Amina W.',
          role: 'Diploma in Software Development, 2025 (sample story)',
          mediaId: null,
        }),
        block('cards', {
          eyebrow: 'News & events',
          heading: 'What’s happening',
          columns: 3,
          items: [
            {
              title: '12 Sept · Open day',
              text: 'Tour the campus, meet lecturers and get help with your application.',
              mediaId: p.campusAerial,
              link: link('Book a place', '/contact-us'),
            },
            {
              title: '1,100 graduates celebrate',
              text: 'Our 2026 graduation ceremony was our largest yet.',
              mediaId: p.gradsPose,
              link: link('Read more', '/student-life'),
            },
            {
              title: 'New health sciences lab',
              text: 'A fully equipped skills lab for nursing and clinical medicine students.',
              mediaId: p.lab,
              link: link('Read more', '/academics'),
            },
          ],
        }),
        block('cta', {
          heading: 'Your future starts here',
          text: 'Applications for the September 2027 intake close on 15 August.',
          background: 'dark',
          buttons: [
            link('Apply now', '/apply'),
            link('Book a campus visit', '/contact-us'),
          ],
        }),
      ],
    },

    'about-us': {
      title: 'About us',
      template: 'landing' as never,
      metaDescription: 'Our history, mission, values and leadership.',
      socialImageId: p.campusFountain,
      blocks: [
        block('hero', {
          eyebrow: 'About Mwangaza College',
          heading: 'Lighting the way since 1998',
          text: 'Mwangaza means “light” in Kiswahili. We exist to light the way to meaningful work for every learner who walks through our gates.',
          mediaId: p.campusFountain,
          height: 'medium',
        }),
        block('image_text', {
          eyebrow: 'Our purpose',
          heading: 'Mission and vision',
          html: '<p><strong>Mission:</strong> to provide practical, affordable and industry-relevant education that equips learners for employment, enterprise and service.</p><p><strong>Vision:</strong> to be East Africa’s most trusted college for career-ready graduates.</p>',
          mediaId: p.gradsPose,
          imagePosition: 'right',
        }),
        block('cards', {
          eyebrow: 'What we stand for',
          heading: 'Our values',
          variant: 'tiles',
          columns: 4,
          items: [
            {
              title: 'Integrity',
              text: 'We do what we say, openly and fairly.',
            },
            {
              title: 'Excellence',
              text: 'High standards in teaching and service.',
            },
            {
              title: 'Inclusion',
              text: 'Every learner belongs and is supported.',
            },
            {
              title: 'Service',
              text: 'Education that serves our communities.',
            },
          ],
        }),
        block('timeline', {
          heading: 'Our history',
          items: [
            {
              date: '1998',
              title: 'Founded',
              text: 'Opened with 64 students and two business courses.',
            },
            {
              date: '2006',
              title: 'ICT courses',
              text: 'ICT programmes launched with our first computer lab.',
            },
            {
              date: '2014',
              title: 'Health Sciences',
              text: 'Nursing and community health programmes approved.',
            },
            {
              date: '2021',
              title: 'New campus',
              text: 'Moved to our green campus on Thika Road.',
            },
            {
              date: '2026',
              title: '4,200 students',
              text: 'Our largest ever student body and graduating class.',
            },
          ],
        }),
        block('stats', {
          background: 'light',
          items: [
            {
              value: '25+',
              label: 'Years of teaching',
              context: 'founded in 1998',
            },
            {
              value: '180',
              label: 'Lecturers and staff',
              context: 'most with industry experience',
            },
            {
              value: '18,000',
              label: 'Alumni',
              context: 'working across East Africa',
            },
          ],
        }),
        block('testimonial', {
          quote:
            'Our promise is simple: every student leaves with the skills, confidence and connections to build a good life.',
          name: 'The Principal',
          role: 'Mwangaza College',
          mediaId: null,
        }),
        block('cta', {
          heading: 'Come and see for yourself',
          text: 'Campus tours run every weekday at 10 am and 2 pm.',
          background: 'accent',
          buttons: [link('Book a visit', '/contact-us')],
        }),
      ],
    },

    academics: {
      title: 'Academics',
      template: 'landing' as never,
      metaDescription:
        'Certificate, diploma and degree programmes in business, computing, engineering and health sciences.',
      socialImageId: p.ictPair,
      blocks: [
        block('hero', {
          eyebrow: 'Academics',
          heading: 'Programmes built with employers',
          text: 'Every course combines classroom learning, hands-on practice and a supervised industrial attachment.',
          mediaId: p.ictPair,
          slides: [p.lab, p.laptopStudent],
          height: 'medium',
          buttons: [link('How to apply', '/admissions')],
        }),
        block('cards', {
          eyebrow: 'Our courses',
          heading: 'Find your path',
          columns: 3,
          items: [
            {
              title: 'Business & Management',
              text: 'Certificate and diploma in accounting, procurement, HR and entrepreneurship; Bachelor of Commerce.',
              mediaId: p.gradsTwo,
              link: link('Entry requirements', '/admissions'),
            },
            {
              title: 'Computing & Engineering',
              text: 'Software development, networking, cyber security, electrical and electronic engineering.',
              mediaId: p.studentsLaptops,
              link: link('Entry requirements', '/admissions'),
            },
            {
              title: 'Health Sciences',
              text: 'Nursing, clinical medicine, nutrition and dietetics, community health.',
              mediaId: p.clinical,
              link: link('Entry requirements', '/admissions'),
            },
          ],
        }),
        block('programmes', {
          eyebrow: 'What you can study',
          heading: 'Programmes and short courses',
          intro:
            'Full programmes from certificate to degree, plus short courses for working people. Choose a level to see what is on offer.',
          levels: [],
          showShortCourses: true,
          enquiryLink: link('Enquire', '/contact'),
        }),
        block('image_text', {
          eyebrow: 'Learning by doing',
          heading: 'Labs, studios and real attachments',
          html: '<p>Students spend at least a third of their time in labs, workshops and clinical placements. Our 120+ partners host every student for a supervised attachment before graduation.</p>',
          mediaId: p.lab,
          imagePosition: 'left',
          background: 'light',
        }),
        block('faq', {
          heading: 'Questions about our programmes',
          items: [
            {
              question: 'Can I study part-time?',
              answerHtml:
                '<p>Yes. Most diploma programmes have evening and weekend classes.</p>',
            },
            {
              question: 'Are your programmes accredited?',
              answerHtml:
                '<p>Yes. Each programme is approved by the relevant national body. Details are listed on each programme page.</p>',
            },
            {
              question: 'Do you help with attachments?',
              answerHtml:
                '<p>Our careers office places every student with one of our industry partners.</p>',
            },
          ],
        }),
        block('cta', {
          heading: 'Ready to choose?',
          text: 'Talk to an admissions adviser about the right programme for you.',
          background: 'dark',
          buttons: [
            link('Apply now', '/apply'),
            link('Talk to us', '/contact-us'),
          ],
        }),
      ],
    },

    admissions: {
      title: 'Admissions',
      template: 'landing' as never,
      metaDescription:
        'How to apply, entry requirements, fees, HELB and M-Pesa payments.',
      socialImageId: p.gradWoman,
      blocks: [
        block('hero', {
          eyebrow: 'Admissions',
          heading: 'Apply in five simple steps',
          text: 'Applications for the September 2027 intake close on 15 August. Our admissions team is happy to help on WhatsApp.',
          mediaId: p.gradWoman,
          height: 'medium',
          buttons: [
            link('Start your application', '/apply'),
            link('Ask a question', '/contact-us'),
          ],
        }),
        block('timeline', {
          heading: 'How to apply',
          items: [
            {
              date: 'Step 1',
              title: 'Choose your programme',
              text: 'Check the entry requirements for your course.',
            },
            {
              date: 'Step 2',
              title: 'Create an account',
              text: 'Register with your email or phone number.',
            },
            {
              date: 'Step 3',
              title: 'Fill in the form',
              text: 'Your details, KCSE results and programme choice. It saves as you go.',
            },
            {
              date: 'Step 4',
              title: 'Upload documents',
              text: 'ID or birth certificate, KCSE certificate and a passport photo.',
            },
            {
              date: 'Step 5',
              title: 'Pay the application fee',
              text: 'KSh 1,000 through M-Pesa. Your admission letter follows within 7 days.',
            },
          ],
        }),
        block('image_text', {
          eyebrow: 'Fees & funding',
          heading: 'Education you can afford',
          html: '<p>Fees are paid per semester through M-Pesa Paybill or bank. Students can apply for HELB loans, county bursaries and our own merit scholarships.</p><ul><li>Certificate: from KSh 28,000 per semester</li><li>Diploma: from KSh 36,000 per semester</li><li>Degree: from KSh 55,000 per semester</li></ul>',
          mediaId: p.studentsLaptops,
          imagePosition: 'right',
          background: 'light',
        }),
        block('stats', {
          items: [
            {
              value: '3',
              label: 'Intakes a year',
              context: 'January, May and September',
            },
            {
              value: '7',
              label: 'Days',
              context: 'to receive your admission letter',
            },
            {
              value: '40%',
              label: 'Of students',
              context: 'receive a bursary or HELB loan',
            },
          ],
        }),
        block('faq', {
          heading: 'Admissions questions',
          items: [
            {
              question: 'What documents do I need?',
              answerHtml:
                '<p>A copy of your national ID or birth certificate, KCSE result slip or certificate, and a recent passport photo.</p>',
            },
            {
              question: 'How do I pay?',
              answerHtml:
                '<p>Use M-Pesa Paybill and enter your application or student number as the account number. You get a receipt straight away.</p>',
            },
            {
              question: 'I was placed by KUCCPS. What next?',
              answerHtml:
                '<p>Confirm your place online and download your joining instructions. No application fee is needed.</p>',
            },
          ],
        }),
        block('cta', {
          heading: 'Start your application today',
          text: 'It takes about 10 minutes, and you can save and come back.',
          background: 'dark',
          buttons: [
            link('Apply now', '/apply'),
            link('Talk to admissions', '/contact-us'),
          ],
        }),
      ],
    },

    'student-life': {
      title: 'Student life',
      template: 'landing' as never,
      metaDescription:
        'Sport, clubs, the library, accommodation and support at Mwangaza College.',
      socialImageId: p.football,
      blocks: [
        block('hero', {
          eyebrow: 'Student life',
          heading: 'Find your people',
          text: 'Sport, clubs, faith, leadership and friendships that last long after graduation.',
          mediaId: p.football,
          slides: [p.studentsLaptops, p.gradCap],
          height: 'medium',
        }),
        block('cards', {
          eyebrow: 'Life on campus',
          heading: 'Something for everyone',
          variant: 'overlay',
          columns: 3,
          items: [
            {
              title: 'Sports & games',
              text: 'Football, athletics, basketball, volleyball and chess.',
              mediaId: p.team,
            },
            {
              title: 'Library & study spaces',
              text: 'Open until 10 pm with e-books and journals.',
              mediaId: p.library,
            },
            {
              title: 'Clubs & societies',
              text: 'Debate, drama, tech, environment and 30 more.',
              mediaId: p.speaker,
            },
            {
              title: 'Hostels',
              text: 'Safe, affordable rooms on and near campus.',
              mediaId: p.campusAerial,
            },
            {
              title: 'Health & counselling',
              text: 'A campus clinic and free, confidential counselling.',
              mediaId: p.clinical,
            },
            {
              title: 'Student leadership',
              text: 'An elected student council that represents you.',
              mediaId: p.gradsTwo,
            },
          ],
        }),
        block('stats', {
          background: 'dark',
          items: [
            { value: '30+', label: 'Clubs and societies' },
            { value: '12', label: 'Sports teams' },
            { value: '600', label: 'Hostel beds' },
          ],
        }),
        block('gallery', {
          heading: 'Moments from campus',
          items: [
            p.gradsGroup,
            p.football,
            p.studentsLaptops,
            p.library,
            p.gradCap,
            p.lab,
            p.team,
            p.gradsPose,
          ].map((mediaId) => ({ mediaId, caption: '' })),
        }),
        block('testimonial', {
          quote:
            'I joined the football team in my first week and the debate club in my second. Mwangaza became a second home.',
          name: 'Brian O.',
          role: 'Bachelor of Commerce student (sample story)',
          mediaId: null,
        }),
        block('cta', {
          heading: 'See campus life for yourself',
          text: 'Join our next open day and meet current students.',
          background: 'accent',
          buttons: [link('Book a visit', '/contact-us')],
        }),
      ],
    },

    'contact-us': {
      title: 'Contact us',
      template: 'landing' as never,
      metaDescription: 'Phone, WhatsApp, email, address and directions.',
      socialImageId: p.campusAerial,
      blocks: [
        block('hero', {
          eyebrow: 'Contact us',
          heading: 'We’re here to help',
          text: 'Call, WhatsApp or visit us. Our admissions team replies within one working day.',
          mediaId: p.campusAerial,
          height: 'short',
        }),
        block('contact_form', {
          heading: 'Get in touch',
          intro: 'Choose whichever is easiest for you.',
          recipient: 'general',
        }),
        block('map', {
          label: 'Find us',
          lat: -1.2187,
          lng: 36.8868,
          zoom: 15,
        }),
        block('faq', {
          heading: 'Visiting the campus',
          items: [
            {
              question: 'Can I book a campus tour?',
              answerHtml:
                '<p>Yes. Tours run every weekday at 10 am and 2 pm. Call or WhatsApp us to book.</p>',
            },
            {
              question: 'Is there parking?',
              answerHtml:
                '<p>Free visitor parking is available at the main gate.</p>',
            },
          ],
        }),
      ],
    },
  };
}

// Run after everything above is defined.
try {
  await removeDemo();
  if (!values.remove) await seed();
  cache.invalidate();
} finally {
  await app.close();
}
