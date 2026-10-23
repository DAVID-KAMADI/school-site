import { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import type { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import {
  client,
  createTestApp,
  signedInStaff,
  type TestClient,
} from './helpers.js';

// Needs the local training database. Creates its own programme, intake, users and applications, then removes them.

describe('Admissions (e2e)', () => {
  let app: INestApplication<App>;
  let db: DataSource;
  let admin: TestClient;
  const tag = randomBytes(3).toString('hex');
  const userIds: number[] = [];
  let programmeId: number;
  let intakeId: number;
  let closedIntakeId: number;

  const applicantEmail = `applicant-${tag}@training.local`;
  const password = randomBytes(12).toString('base64url');

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
    const signedIn = await signedInStaff(app, [
      { roleKey: 'admissions_officer' },
    ]);
    admin = signedIn.client;
    userIds.push(signedIn.userId);

    const programme = await admin.post('/admin/admissions/programmes', {
      code: `T${tag}`.toUpperCase(),
      name: `Diploma in Testing ${tag}`,
      level: 'diploma',
      school: 'School of Computing',
      studyModes: ['full_time', 'evening'],
      minMeanGrade: 'C-',
    });
    expect(programme.status).toBe(201);
    programmeId = programme.body.id;
    const day = 86_400_000;
    intakeId = (
      await admin.post('/admin/admissions/intakes', {
        name: `Test intake ${tag}`,
        opensAt: new Date(Date.now() - day),
        closesAt: new Date(Date.now() + 30 * day),
      })
    ).body.id;
    closedIntakeId = (
      await admin.post('/admin/admissions/intakes', {
        name: `Closed intake ${tag}`,
        opensAt: new Date(Date.now() - 30 * day),
        closesAt: new Date(Date.now() - day),
      })
    ).body.id;
  });

  afterAll(async () => {
    const apps: { id: number }[] = await db.query(
      'SELECT a.id FROM applications a JOIN users u ON u.id = a.applicant_id WHERE u.email LIKE ?',
      [`%${tag}@training.local`],
    );
    for (const a of apps)
      await rm(
        resolve(
          process.env.STORAGE_DIR || 'storage',
          'private',
          'applications',
          String(a.id),
        ),
        { recursive: true, force: true },
      );
    await db.query('DELETE FROM users WHERE email LIKE ? OR id IN (?)', [
      `%${tag}@training.local`,
      userIds.length ? userIds : [0],
    ]);
    await db.query('DELETE FROM intakes WHERE id IN (?)', [
      [intakeId, closedIntakeId],
    ]);
    await db.query('DELETE FROM programmes WHERE id = ?', [programmeId]);
    await app.close();
  });

  it('takes an applicant from registration to an offer', async () => {
    const applicant = client(app);
    await applicant.get('/auth/csrf');

    // Public options for the Apply page: only the open intake is offered.
    const options = await applicant.get('/applicant/options');
    expect(options.body.intakes.map((i: { id: number }) => i.id)).toContain(
      intakeId,
    );
    expect(options.body.intakes.map((i: { id: number }) => i.id)).not.toContain(
      closedIntakeId,
    );
    expect(options.body.settings['admissions.fee'].amount).toBe(1000);
    const docTypes: { id: number; name: string; isRequired: boolean }[] =
      options.body.documentTypes;

    // Registering needs agreement to the Terms and Privacy Policy.
    const noConsent = await applicant.post('/applicant/register', {
      fullName: 'Amina Wanjiku',
      email: applicantEmail,
      phone: '0712 345 678',
      password,
    });
    expect(noConsent.status).toBe(400);

    // Register (signs in straight away, no two-step login for applicants).
    const reg = await applicant.post('/applicant/register', {
      fullName: 'Amina Wanjiku',
      email: applicantEmail,
      phone: '0712 345 678',
      password,
      acceptTerms: true,
    });
    expect(reg.status).toBe(201);
    const [consent] = await db.query(
      'SELECT terms_accepted_at, terms_version FROM users WHERE email = ?',
      [applicantEmail],
    );
    expect(consent.terms_accepted_at).toBeInstanceOf(Date);
    expect(consent.terms_version).toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(
      (
        await applicant.post('/applicant/register', {
          fullName: 'Again',
          email: applicantEmail,
          phone: '0712345678',
          password,
          acceptTerms: true,
        })
      ).status,
    ).toBe(409);

    const draft = await applicant.get('/applicant/application');
    expect(draft.body.status).toBe('draft');
    expect(draft.body.completion.ready).toBe(false);

    // Applicants cannot reach staff screens.
    expect((await applicant.get('/admin/applications')).status).toBe(403);

    // Programme step: closed intakes and unoffered study modes are refused.
    expect(
      (
        await applicant.put('/applicant/application/sections/programme', {
          data: { intakeId: closedIntakeId },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await applicant.put('/applicant/application/sections/programme', {
          data: { programmeId, studyMode: 'weekend' },
        })
      ).status,
    ).toBe(400);
    await applicant.put('/applicant/application/sections/programme', {
      data: { intakeId, programmeId, studyMode: 'evening' },
    });

    // Drafts save partial answers but reject invalid ones.
    expect(
      (
        await applicant.put('/applicant/application/sections/personal', {
          data: { firstName: 'Amina', phone: '123' },
        })
      ).status,
    ).toBe(422);
    // Too young to be admitted (Site settings → Admissions → Minimum age, 16 by default).
    const tenYearsAgo = new Date();
    tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
    const tooYoung = await applicant.put(
      '/applicant/application/sections/personal',
      { data: { dateOfBirth: tenYearsAgo.toISOString().slice(0, 10) } },
    );
    expect(tooYoung.status).toBe(422);
    expect(tooYoung.body.issues).toEqual([
      {
        path: 'dateOfBirth',
        message: expect.stringContaining('do not meet the age requirement'),
      },
    ]);
    const partial = await applicant.put(
      '/applicant/application/sections/personal',
      { data: { firstName: 'Amina' } },
    );
    expect(partial.body.completion.sections.personal).toBe(false);

    await applicant.put('/applicant/application/sections/personal', {
      data: {
        firstName: 'Amina',
        middleName: '',
        lastName: 'Wanjiku',
        dateOfBirth: '2006-04-12',
        gender: 'female',
        nationality: 'Kenyan',
        idType: 'national_id',
        idNumber: '12345678',
        phone: '0712 345 678',
        country: 'Kenya',
        county: 'Nairobi',
        address: 'Kasarani, Nairobi',
      },
    });
    await applicant.put('/applicant/application/sections/nextOfKin', {
      data: {
        name: 'Jane Wanjiku',
        relationship: 'Mother',
        phone: '+254722000000',
      },
    });
    const edu = await applicant.put(
      '/applicant/application/sections/education',
      {
        data: {
          kcseIndexNumber: '12345678001',
          kcseYear: 2024,
          meanGrade: 'D+',
          secondarySchool: 'Moi Girls',
          subjects: [{ subject: 'Mathematics', grade: 'C' }],
        },
      },
    );
    expect(edu.body.meetsMinimumGrade).toBe(false); // D+ is below C-: warned, not blocked
    await applicant.put('/applicant/application/sections/funding', {
      data: { method: 'helb' },
    });

    // Submitting without documents lists what is missing.
    const incomplete = await applicant.post('/applicant/application/submit', {
      declaration: true,
    });
    expect(incomplete.status).toBe(422);
    expect(incomplete.body.issues.length).toBeGreaterThan(0);

    // Uploads: content is checked, not the file name.
    const jpeg = await sharp({
      create: { width: 600, height: 800, channels: 3, background: '#88a' },
    })
      .jpeg()
      .toBuffer();
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
    const photoType = docTypes.find((d) => d.name === 'Passport photo')!;
    expect(
      (
        await applicant.upload(
          '/applicant/application/documents',
          'file',
          Buffer.from('MZ fake exe'),
          'photo.jpg',
          { documentTypeId: String(photoType.id) },
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await applicant.upload(
          '/applicant/application/documents',
          'file',
          pdf,
          'photo.pdf',
          { documentTypeId: String(photoType.id) },
        )
      ).status,
    ).toBe(400);
    for (const t of docTypes.filter((d) => d.isRequired)) {
      const isPhoto = t.id === photoType.id;
      const r = await applicant.upload(
        '/applicant/application/documents',
        'file',
        isPhoto ? jpeg : pdf,
        isPhoto ? 'me.jpg' : 'doc.pdf',
        { documentTypeId: String(t.id) },
      );
      expect(r.status).toBe(201);
    }

    expect(
      (
        await applicant.post('/applicant/application/submit', {
          declaration: false,
        })
      ).status,
    ).toBe(400);
    const submitted = await applicant.post('/applicant/application/submit', {
      declaration: true,
    });
    expect(submitted.status).toBe(200);
    expect(submitted.body.status).toBe('submitted');
    expect(submitted.body.applicationNumber).toMatch(/^APP-\d{4}-\d{6}$/);
    const number = submitted.body.applicationNumber;

    // No more edits after submitting.
    expect(
      (
        await applicant.put('/applicant/application/sections/funding', {
          data: { method: 'self' },
        })
      ).status,
    ).toBe(403);

    // Another applicant cannot open this applicant's files.
    const other = client(app);
    await other.get('/auth/csrf');
    await other.post('/applicant/register', {
      fullName: 'Other Person',
      email: `other-${tag}@training.local`,
      phone: '0711111111',
      password,
      acceptTerms: true,
    });
    const myDocId = submitted.body.documents[0].id;
    expect(
      (await other.get(`/applicant/application/documents/${myDocId}/file`))
        .status,
    ).toBe(404);
    expect(
      (await applicant.get(`/applicant/application/documents/${myDocId}/file`))
        .status,
    ).toBe(200);

    // Staff: find it, review it.
    const list = await admin.get(
      `/admin/applications?search=${encodeURIComponent(number)}`,
    );
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].meetsMinimumGrade).toBe(false);
    const id = list.body.items[0].id;
    expect(
      (await admin.get(`/admin/applications/${id}/documents/${myDocId}/file`))
        .status,
    ).toBe(200);
    expect((await admin.get('/admin/applications/export.csv')).text).toContain(
      number,
    );

    expect(
      (
        await admin.post(`/admin/applications/${id}/status`, {
          status: 'offered',
        })
      ).status,
    ).toBe(400); // message required
    expect(
      (
        await admin.post(`/admin/applications/${id}/status`, {
          status: 'draft',
        })
      ).status,
    ).toBe(400); // not allowed
    await admin.post(`/admin/applications/${id}/status`, {
      status: 'under_review',
    });

    const photoDoc = submitted.body.documents.find(
      (d: { documentTypeId: number }) => d.documentTypeId === photoType.id,
    );
    expect(
      (
        await admin.patch(
          `/admin/applications/${id}/documents/${photoDoc.id}`,
          { status: 'rejected' },
        )
      ).status,
    ).toBe(400); // note required
    await admin.patch(`/admin/applications/${id}/documents/${photoDoc.id}`, {
      status: 'rejected',
      note: 'The photo is blurred.',
    });
    await admin.post(`/admin/applications/${id}/notes`, {
      message: 'Internal: check KCSE with KNEC.',
      visibleToApplicant: false,
    });
    const info = await admin.post(`/admin/applications/${id}/status`, {
      status: 'info_requested',
      message: 'Please upload a clearer passport photo.',
    });
    expect(info.body.status).toBe('info_requested');

    // Applicant sees the request (but not internal notes), fixes it and re-submits.
    const view = await applicant.get('/applicant/application');
    expect(view.body.editable).toBe(true);
    const texts = view.body.messages
      .map((m: { message: string }) => m.message)
      .join(' ');
    expect(texts).toContain('clearer passport photo');
    expect(texts).not.toContain('Internal');
    expect(
      view.body.completion.missingDocuments.map(
        (d: { name: string }) => d.name,
      ),
    ).toContain('Passport photo');
    await applicant.upload(
      '/applicant/application/documents',
      'file',
      jpeg,
      'me2.jpg',
      { documentTypeId: String(photoType.id) },
    );
    const resubmitted = await applicant.post('/applicant/application/submit', {
      declaration: true,
    });
    expect(resubmitted.body.status).toBe('under_review');
    expect(resubmitted.body.applicationNumber).toBe(number);

    // Fee: applicant reports the M-Pesa code, staff confirm it.
    expect(
      (await applicant.post('/applicant/application/fee', { reference: 'bad' }))
        .status,
    ).toBe(400);
    expect(
      (
        await applicant.post('/applicant/application/fee', {
          reference: 'sgh7k2l9qx',
        })
      ).body.fee.status,
    ).toBe('claimed');
    const feeOk = await admin.post(`/admin/applications/${id}/fee`, {
      status: 'verified',
    });
    expect(feeOk.body.fee.status).toBe('verified');

    const offer = await admin.post(`/admin/applications/${id}/status`, {
      status: 'offered',
      message: 'Congratulations! You have been offered a place.',
    });
    expect(offer.body.status).toBe('offered');
    const final = await applicant.get('/applicant/application');
    expect(final.body.status).toBe('offered');
    expect(final.body.fee.status).toBe('verified');

    // Offer letter: a real PDF for the applicant and for staff, and nobody else.
    expect(final.body.offer.canRespond).toBe(true);
    const letter = await applicant.get(
      '/applicant/application/offer-letter.pdf',
    );
    expect(letter.status).toBe(200);
    expect(letter.headers['content-type']).toContain('application/pdf');
    expect(
      Buffer.from(letter.body as Buffer)
        .subarray(0, 4)
        .toString(),
    ).toBe('%PDF');
    expect(
      (await admin.get(`/admin/applications/${id}/offer-letter.pdf`)).status,
    ).toBe(200);
    expect(
      (await other.get('/applicant/application/offer-letter.pdf')).status,
    ).toBe(404);

    // Accepting the offer shows the link to the existing student portal.
    const [portal] = await db.query(
      "SELECT value FROM site_settings WHERE `key` = 'portal.student_url'",
    );
    await db.query(
      "UPDATE site_settings SET value = ? WHERE `key` = 'portal.student_url'",
      [JSON.stringify('https://portal.example.ac.ke')],
    );
    try {
      const accepted = await applicant.post(
        '/applicant/application/offer/accept',
      );
      expect(accepted.body.status).toBe('accepted');
      expect(accepted.body.studentPortalUrl).toBe(
        'https://portal.example.ac.ke',
      );
      expect(
        (await applicant.post('/applicant/application/offer/accept')).status,
      ).toBe(400);
      expect(
        (await applicant.post('/applicant/application/withdraw')).status,
      ).toBe(400);
      expect((await admin.get(`/admin/applications/${id}`)).body.status).toBe(
        'accepted',
      );
    } finally {
      await db.query(
        "UPDATE site_settings SET value = ? WHERE `key` = 'portal.student_url'",
        [JSON.stringify(portal.value)],
      );
    }
    expect(
      (await admin.get('/admin/applications/counts')).body.accepted,
    ).toBeGreaterThanOrEqual(1);

    // The other applicant withdraws a draft, still sees it, then starts again explicitly.
    expect((await other.post('/applicant/application/new')).status).toBe(409);
    await other.post('/applicant/application/withdraw');
    expect((await other.get('/applicant/application')).body.status).toBe(
      'withdrawn',
    );
    const fresh = await other.post('/applicant/application/new');
    expect(fresh.body.status).toBe('draft');
  });

  it('keeps content editors out of applications', async () => {
    const editor = await signedInStaff(app, [{ roleKey: 'content_editor' }]);
    userIds.push(editor.userId);
    expect((await editor.client.get('/admin/applications')).status).toBe(403);
    expect(
      (await editor.client.get('/admin/admissions/programmes')).status,
    ).toBe(403);
  });
});
