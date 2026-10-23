import { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import type { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import { MediaStorage } from '../src/cms/media/storage.js';
import {
  client,
  createTestApp,
  signedInStaff,
  type TestClient,
} from './helpers.js';

// Needs the local training database. Creates its own pages, media and users and removes them afterwards.

describe('Content management (e2e)', () => {
  let app: INestApplication<App>;
  let db: DataSource;
  let admin: TestClient;
  const userIds: number[] = [];
  const pageIds: number[] = [];
  const mediaIds: number[] = [];
  const tag = randomBytes(3).toString('hex');
  let originalName: unknown;
  let originalApply: string;
  let originalMainMenu: unknown[];

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
    const signedIn = await signedInStaff(app, [{ roleKey: 'super_admin' }]);
    admin = signedIn.client;
    userIds.push(signedIn.userId);
    originalName = (
      await db.query(
        "SELECT value FROM site_settings WHERE `key` = 'institution.name'",
      )
    )[0].value;
    originalApply = (
      await db.query(
        "SELECT value FROM text_strings WHERE `key` = 'header.apply_button' AND locale = 'en'",
      )
    )[0].value;
    originalMainMenu = (await admin.get('/admin/menus')).body.find(
      (m: { location: string }) => m.location === 'main',
    ).items;
  });

  afterAll(async () => {
    await admin.put('/admin/menus/main', { items: stripIds(originalMainMenu) });
    await admin.put('/admin/settings/institution.name', {
      value: originalName,
    });
    await admin.put('/admin/text-strings/header.apply_button', {
      locale: 'en',
      value: originalApply,
    });
    if (pageIds.length) {
      await db.query(
        'DELETE FROM redirects WHERE to_path LIKE ? OR from_path LIKE ?',
        [`%${tag}%`, `%${tag}%`],
      );
      await db.query(
        'UPDATE pages SET published_revision_id = NULL WHERE id IN (?)',
        [pageIds],
      );
      await db.query(
        'DELETE FROM pages WHERE id IN (?) ORDER BY parent_id IS NULL',
        [pageIds],
      );
    }
    if (mediaIds.length) {
      const files: { k: string }[] = await db.query(
        'SELECT storage_key k FROM media WHERE id IN (?) UNION SELECT storage_key FROM media_variants WHERE media_id IN (?)',
        [mediaIds, mediaIds],
      );
      const storage = new MediaStorage();
      await Promise.all(files.map((f) => storage.remove(f.k)));
      await db.query('DELETE FROM media WHERE id IN (?)', [mediaIds]);
    }
    if (userIds.length)
      await db.query('DELETE FROM users WHERE id IN (?)', [userIds]);
    await app.close();
  });

  const stripIds = (items: unknown[]): unknown[] =>
    (items as { id?: number; pagePath?: string; children: unknown[] }[]).map(
      ({ id: _id, pagePath: _p, children, ...rest }) => ({
        ...rest,
        ...((rest as { pageId?: number }).pageId
          ? { url: undefined }
          : { pageId: undefined }),
        children: stripIds(children),
      }),
    );

  it('runs the full editing and publishing workflow', async () => {
    // Upload an image: variants are generated and the file is served.
    const png = await sharp({
      create: { width: 1800, height: 900, channels: 3, background: '#2a6' },
    })
      .png()
      .toBuffer();
    const upload = await admin.upload(
      '/admin/media',
      'file',
      png,
      'campus.png',
      { folder: `e2e-${tag}` },
    );
    expect(upload.status).toBe(201);
    mediaIds.push(upload.body.id);
    expect(upload.body.srcset.map((s: { width: number }) => s.width)).toEqual([
      320, 480, 640, 800, 1024, 1366, 1800,
    ]);
    expect((await client(app).get(upload.body.srcset[0].url)).status).toBe(200);

    // Fake files are rejected by content, not by name.
    expect(
      (
        await admin.upload(
          '/admin/media',
          'file',
          Buffer.from('<svg onload=alert(1)>'),
          'evil.png',
        )
      ).status,
    ).toBe(400);

    // Create a page; its address comes from the title.
    const created = await admin.post('/admin/pages', { title: `About ${tag}` });
    expect(created.status).toBe(201);
    const pageId = created.body.id;
    pageIds.push(pageId);
    expect(created.body.path).toBe(`/about-${tag}`);

    // Invalid blocks are rejected with a precise list of problems.
    const bad = await admin.put(`/admin/pages/${pageId}/content`, {
      title: `About ${tag}`,
      blocks: [
        {
          type: 'cta',
          content: {
            heading: 'x',
            buttons: [{ label: 'Go', href: 'javascript:alert(1)' }],
          },
        },
      ],
    });
    expect(bad.status).toBe(422);
    expect(bad.body.issues[0].path).toBe('buttons.0.href');

    // Save content; rich text is cleaned.
    const saved = await admin.put(`/admin/pages/${pageId}/content`, {
      title: `About ${tag}`,
      metaDescription: 'Who we are',
      blocks: [
        {
          type: 'hero',
          content: {
            heading: 'Welcome',
            mediaId: upload.body.id,
            buttons: [{ label: 'Apply', href: '/apply' }],
          },
        },
        {
          type: 'rich_text',
          content: { html: '<p>Hello<script>alert(1)</script></p>' },
        },
      ],
    });
    expect(saved.status).toBe(200);
    expect(saved.body.blocks[1].content.html).toBe('<p>Hello</p>');
    expect(saved.body.latestRevision).toBe(2);

    // Not visible until published.
    const visitor = client(app);
    expect((await visitor.get(`/public/pages?path=/about-${tag}`)).status).toBe(
      404,
    );

    const published = await admin.post(`/admin/pages/${pageId}/publish`);
    expect(published.status).toBe(200);
    expect(published.body.warnings).toContain('1 image(s) have no alt text.');

    const live = await visitor.get(`/public/pages?path=/about-${tag}/`);
    expect(live.status).toBe(200);
    expect(live.body.blocks[0].content.heading).toBe('Welcome');
    expect(live.body.media[upload.body.id].srcset.length).toBe(7);

    // Edits stay in draft until published again.
    await admin.put(`/admin/pages/${pageId}/content`, {
      title: `About ${tag}`,
      blocks: [{ type: 'hero', content: { heading: 'Changed' } }],
    });
    expect(
      (await visitor.get(`/public/pages?path=/about-${tag}`)).body.blocks[0]
        .content.heading,
    ).toBe('Welcome');
    expect(
      (await admin.get(`/admin/pages/${pageId}`)).body.hasUnpublishedChanges,
    ).toBe(true);

    // Restore revision 2 (the published content) into the draft.
    const revisions = await admin.get(`/admin/pages/${pageId}/revisions`);
    const rev2 = revisions.body.find(
      (r: { revisionNumber: number }) => r.revisionNumber === 2,
    );
    const restored = await admin.post(
      `/admin/pages/${pageId}/revisions/${rev2.id}/restore`,
    );
    expect(restored.body.blocks[0].content.heading).toBe('Welcome');

    // Image in use cannot be deleted without force.
    expect((await admin.delete(`/admin/media/${upload.body.id}`)).status).toBe(
      409,
    );
    await admin.patch(`/admin/media/${upload.body.id}`, {
      altText: 'Students on the main lawn',
    });

    // Preview link shows the draft to someone without an account.
    const preview = await admin.post(`/admin/pages/${pageId}/preview-link`, {
      hours: 1,
    });
    const previewToken = preview.body.url.split('/').pop();
    expect((await visitor.get(`/public/preview/${previewToken}`)).status).toBe(
      200,
    );
    expect((await visitor.get(`/public/preview/${previewToken}x`)).status).toBe(
      404,
    );

    // Renaming a live page leaves a redirect from the old address.
    const renamed = await admin.patch(`/admin/pages/${pageId}/settings`, {
      slug: `who-we-are-${tag}`,
    });
    expect(renamed.body.path).toBe(`/who-we-are-${tag}`);
    expect(
      (await visitor.get(`/public/pages?path=/about-${tag}`)).body.redirect,
    ).toEqual({ to: `/who-we-are-${tag}`, statusCode: 301 });

    // Menus link to pages by id, so they follow the rename.
    const menu = await admin.put('/admin/menus/main', {
      items: [
        {
          label: 'About',
          pageId,
          children: [{ label: 'Portal', url: 'https://portal.example.ac.ke' }],
        },
      ],
    });
    expect(menu.status).toBe(200);
    expect(
      (
        await admin.put('/admin/menus/main', {
          items: [{ label: 'Bad', url: 'javascript:x' }],
        })
      ).status,
    ).toBe(400);

    // Settings and interface text are editable and show up for visitors straight away.
    expect(
      (
        await admin.put('/admin/settings/institution.name', {
          value: `Test College ${tag}`,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await admin.put('/admin/settings/institution.name', {
          value: { not: 'text' },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await admin.put('/admin/text-strings/header.apply_button', {
          locale: 'en',
          value: 'Apply today',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await admin.put('/admin/text-strings/header.apply_button', {
          locale: 'sw',
          value: 'Tuma maombi',
        })
      ).status,
    ).toBe(200);
    // Translations are served once the language is switched on under Languages.
    const languages = (await admin.get('/admin/languages')).body.languages;
    if (!languages.some((l: { code: string }) => l.code === 'sw')) {
      expect(
        (await visitor.get('/public/site?locale=sw')).body.text[
          'header.apply_button'
        ],
      ).toBe('Apply today');
      await admin.put('/admin/languages', {
        languages: [...languages, { code: 'sw', name: 'Kiswahili' }],
      });
    }
    const site = await visitor.get('/public/site?locale=sw');
    expect(site.body.settings['institution.name']).toBe(`Test College ${tag}`);
    expect(site.body.text['header.apply_button']).toBe('Tuma maombi');
    expect(site.body.text['common.read_more']).toBe('Read more');
    expect(site.body.menus.main[0]).toMatchObject({
      label: 'About',
      href: `/who-we-are-${tag}`,
    });
    await db.query(
      "DELETE FROM text_strings WHERE `key` = 'header.apply_button' AND locale = 'sw'",
    );
    await admin.put('/admin/languages', { languages });

    // Trash: visitors are redirected to the parent; the page can be restored.
    expect((await admin.delete(`/admin/pages/${pageId}`)).status).toBe(200);
    expect(
      (await visitor.get(`/public/pages?path=/who-we-are-${tag}`)).body.redirect
        .to,
    ).toBe('/');
    expect(
      (await admin.get('/admin/pages/trash')).body.some(
        (p: { id: number }) => p.id === pageId,
      ),
    ).toBe(true);
    const back = await admin.post(`/admin/pages/${pageId}/restore`);
    expect(back.status).toBe(200);
    expect(back.body.path).toBe(`/who-we-are-${tag}`);
  });

  it('limits a section editor to their section and keeps publishing for publishers', async () => {
    const section = await admin.post('/admin/pages', {
      title: `Library ${tag}`,
    });
    const other = await admin.post('/admin/pages', { title: `Finance ${tag}` });
    pageIds.push(section.body.id, other.body.id);

    const editor = await signedInStaff(app, [
      { roleKey: 'content_editor', scopePageId: section.body.id },
    ]);
    userIds.push(editor.userId);
    const e = editor.client;

    // Can create and edit inside the section.
    const child = await e.post('/admin/pages', {
      title: 'Opening hours',
      parentId: section.body.id,
    });
    expect(child.status).toBe(201);
    pageIds.unshift(child.body.id);
    expect(child.body.path).toBe(`/library-${tag}/opening-hours`);
    const edit = await e.put(`/admin/pages/${child.body.id}/content`, {
      title: 'Opening hours',
      blocks: [{ type: 'rich_text', content: { html: '<p>8am - 8pm</p>' } }],
    });
    expect(edit.status).toBe(200);
    expect(
      (await e.post(`/admin/pages/${child.body.id}/submit`)).body.status,
    ).toBe('in_review');

    // Cannot touch other sections, publish, or change site settings.
    expect((await e.get(`/admin/pages/${other.body.id}`)).status).toBe(403);
    expect((await e.post('/admin/pages', { title: 'Top level' })).status).toBe(
      403,
    );
    expect((await e.post(`/admin/pages/${child.body.id}/publish`)).status).toBe(
      403,
    );
    expect(
      (await e.put('/admin/settings/institution.name', { value: 'Hacked' }))
        .status,
    ).toBe(403);
    expect((await e.get('/admin/users')).status).toBe(403);

    // The publisher (admin) approves it.
    expect(
      (await admin.post(`/admin/pages/${child.body.id}/publish`)).status,
    ).toBe(200);
    expect(
      (
        await client(app).get(
          `/public/pages?path=/library-${tag}/opening-hours`,
        )
      ).status,
    ).toBe(200);
  });
});
