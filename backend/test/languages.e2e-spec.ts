import { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import {
  client,
  createTestApp,
  signedInStaff,
  type TestClient,
} from './helpers.js';

// Needs the local training database. Restores the language list and removes its pages afterwards.

describe('Languages and translations (e2e)', () => {
  let app: INestApplication<App>;
  let db: DataSource;
  let admin: TestClient;
  let editor: TestClient;
  const userIds: number[] = [];
  const pageIds: number[] = [];
  const tag = randomBytes(3).toString('hex');
  let originalLanguages: unknown;
  let originalSettingTranslations: unknown;
  let originalFooter: unknown[];

  const setting = async (key: string) =>
    (
      await db.query('SELECT value FROM site_settings WHERE `key` = ?', [key])
    )[0].value;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
    const a = await signedInStaff(app, [{ roleKey: 'super_admin' }]);
    const e = await signedInStaff(app, [{ roleKey: 'content_editor' }]);
    admin = a.client;
    editor = e.client;
    userIds.push(a.userId, e.userId);
    originalLanguages = await setting('languages.enabled');
    originalSettingTranslations = await setting(
      'languages.setting_translations',
    );
    originalFooter = (await admin.get('/admin/menus')).body.find(
      (m: { location: string }) => m.location === 'footer',
    ).items;
  });

  afterAll(async () => {
    await db.query('UPDATE site_settings SET value = ? WHERE `key` = ?', [
      JSON.stringify(originalLanguages),
      'languages.enabled',
    ]);
    await db.query('UPDATE site_settings SET value = ? WHERE `key` = ?', [
      JSON.stringify(originalSettingTranslations),
      'languages.setting_translations',
    ]);
    await admin.put('/admin/menus/footer', {
      items: stripIds(originalFooter),
    });
    await db.query("DELETE FROM text_strings WHERE locale = 'zz'");
    if (pageIds.length) {
      await db.query(
        'UPDATE pages SET published_revision_id = NULL WHERE id IN (?)',
        [pageIds],
      );
      await db.query('DELETE FROM pages WHERE id IN (?)', [pageIds]);
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

  it('serves pages, menus and settings in the visitor’s language', async () => {
    const visitor = client(app);
    const english = (originalLanguages as { code: string; name: string }[])[0];

    // Only staff who may edit settings can change the language list, and codes are checked.
    expect(
      (
        await editor.put('/admin/languages', {
          languages: [english, { code: 'fr', name: 'Français' }],
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await admin.put('/admin/languages', {
          languages: [english, { code: 'french', name: 'Français' }],
        })
      ).status,
    ).toBe(400);
    const saved = await admin.put('/admin/languages', {
      languages: [{ code: 'fr', name: 'Français' }],
    });
    expect(saved.status).toBe(200);
    // English is always kept, first.
    expect(saved.body.map((l: { code: string }) => l.code)).toEqual([
      'en',
      'fr',
    ]);

    // A top-level page cannot take a language code as its address.
    expect(
      (await admin.post('/admin/pages', { title: 'x', slug: 'fr' })).status,
    ).toBe(400);
    const autoSlug = await admin.post('/admin/pages', { title: 'Fr' });
    pageIds.push(autoSlug.body.id);
    expect(autoSlug.body.path).toBe('/fr-2');

    // An English page, published.
    const created = await admin.post('/admin/pages', {
      title: `Admissions ${tag}`,
    });
    const pageId = created.body.id;
    pageIds.push(pageId);
    const path = created.body.path;
    await admin.put(`/admin/pages/${pageId}/content`, {
      title: `Admissions ${tag}`,
      metaDescription: 'How to apply',
      blocks: [{ type: 'rich_text', content: { html: '<p>Apply now</p>' } }],
    });
    await admin.post(`/admin/pages/${pageId}/publish`);

    // Before translation, /fr/... shows the English page, marked as not translated.
    const fallback = await visitor.get(`/public/pages?path=/fr${path}`);
    expect(fallback.status).toBe(200);
    expect(fallback.body.locale).toBe('fr');
    expect(fallback.body.translated).toBe(false);
    expect(fallback.body.page.title).toBe(`Admissions ${tag}`);
    expect(fallback.body.page.path).toBe(`/fr${path}`);
    expect(fallback.body.alternates).toEqual([{ locale: 'en', path }]);

    // A new translation starts as a copy of the English content.
    const draft = await admin.get(`/admin/pages/${pageId}/translations/fr`);
    expect(draft.status).toBe(200);
    expect(draft.body.exists).toBe(false);
    expect(draft.body.blocks[0].content.html).toBe('<p>Apply now</p>');

    // Unknown languages are refused.
    expect(
      (await admin.get(`/admin/pages/${pageId}/translations/de`)).status,
    ).toBe(400);

    // Translated content is cleaned like English content.
    const translated = await editor.put(
      `/admin/pages/${pageId}/translations/fr`,
      {
        title: `Admissions FR ${tag}`,
        metaDescription: 'Comment postuler',
        blocks: [
          {
            type: 'rich_text',
            content: { html: '<p>Postulez<script>alert(1)</script></p>' },
          },
        ],
      },
    );
    expect(translated.status).toBe(200);
    expect(translated.body.blocks[0].content.html).toBe('<p>Postulez</p>');

    // Saved but not published: visitors still see English. Editors cannot publish.
    expect(
      (await visitor.get(`/public/pages?path=/fr${path}`)).body.translated,
    ).toBe(false);
    expect(
      (await editor.post(`/admin/pages/${pageId}/translations/fr/publish`))
        .status,
    ).toBe(403);
    const published = await admin.post(
      `/admin/pages/${pageId}/translations/fr/publish`,
    );
    expect(published.status).toBe(200);
    expect(published.body.warnings).toEqual([]);

    const french = await visitor.get(`/public/pages?path=/fr${path}`);
    expect(french.body.translated).toBe(true);
    expect(french.body.page.title).toBe(`Admissions FR ${tag}`);
    expect(french.body.page.metaDescription).toBe('Comment postuler');
    expect(french.body.blocks[0].content.html).toBe('<p>Postulez</p>');
    expect(french.body.alternates).toEqual([
      { locale: 'en', path },
      { locale: 'fr', path: `/fr${path}` },
    ]);
    // The English page is unchanged.
    expect(
      (await visitor.get(`/public/pages?path=${path}`)).body.page.title,
    ).toBe(`Admissions ${tag}`);
    // The French home page address works without a trailing path.
    expect([200, 404]).toContain(
      (await visitor.get('/public/pages?path=/fr')).status,
    );

    // The English page changing is flagged on the translation.
    await admin.put(`/admin/pages/${pageId}/content`, {
      title: `Admissions ${tag}`,
      blocks: [{ type: 'rich_text', content: { html: '<p>Apply today</p>' } }],
    });
    const list = await admin.get(`/admin/pages/${pageId}/translations`);
    expect(list.body).toEqual([
      expect.objectContaining({
        locale: 'fr',
        isLive: true,
        englishChanged: true,
      }),
    ]);

    // Menus, settings and interface text in French; English is unchanged.
    await admin.put('/admin/menus/footer', {
      items: [
        {
          label: `Study ${tag}`,
          translations: { fr: `Étudier ${tag}` },
          pageId,
          children: [],
        },
      ],
    });
    expect(
      (
        await admin.put('/admin/languages/fr/settings', {
          values: { 'contact.phone': '+33' },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await admin.put('/admin/languages/fr/settings', {
          values: { 'institution.tagline': `Devise ${tag}` },
        })
      ).status,
    ).toBe(200);
    const siteFr = await visitor.get('/public/site?locale=fr');
    expect(siteFr.body.locale).toBe('fr');
    expect(siteFr.body.languages.map((l: { code: string }) => l.code)).toEqual([
      'en',
      'fr',
    ]);
    expect(siteFr.body.menus.footer[0].label).toBe(`Étudier ${tag}`);
    expect(siteFr.body.settings['institution.tagline']).toBe(`Devise ${tag}`);
    expect(siteFr.body.settings['languages.enabled']).toBeUndefined();
    const siteEn = await visitor.get('/public/site?locale=en');
    expect(siteEn.body.menus.footer[0].label).toBe(`Study ${tag}`);
    expect(siteEn.body.settings['institution.tagline']).not.toBe(
      `Devise ${tag}`,
    );
    // A language that is not enabled falls back to English.
    expect((await visitor.get('/public/site?locale=zz')).body.locale).toBe(
      'en',
    );

    // Deleting the translation brings back the English fallback.
    expect(
      (await admin.delete(`/admin/pages/${pageId}/translations/fr`)).status,
    ).toBe(200);
    expect(
      (await visitor.get(`/public/pages?path=/fr${path}`)).body.translated,
    ).toBe(false);

    // Removing French: /fr/... is an ordinary (missing) address again.
    await admin.put('/admin/languages', { languages: [english] });
    expect((await visitor.get(`/public/pages?path=/fr${path}`)).status).toBe(
      404,
    );
  });
});
