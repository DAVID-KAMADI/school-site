import { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import { client, createTestApp, signedInStaff } from './helpers.js';

// Needs the local training database (see ../database/setup-local.example.sql).

describe('Admin dashboard (e2e)', () => {
  let app: INestApplication<App>;
  const userIds: number[] = [];

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app
      .get(DataSource)
      .query('DELETE FROM users WHERE id IN (?)', [userIds]);
    await app.close();
  });

  it('needs a signed-in staff member', async () => {
    expect((await client(app).get('/admin/dashboard')).status).toBe(401);
  });

  it('gives a super administrator every section', async () => {
    const admin = await signedInStaff(app, [{ roleKey: 'super_admin' }]);
    userIds.push(admin.userId);
    const res = await admin.client.get('/admin/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.applications.trend).toHaveLength(30);
    expect(res.body.applications.counts).toBeTypeOf('object');
    expect(res.body.content.media).toHaveProperty('images');
    expect(res.body.people.staff).toBeGreaterThan(0);
    expect(res.body.activity.recent.length).toBeGreaterThan(0);
  });

  it('only shows a content editor the content section', async () => {
    const editor = await signedInStaff(app, [{ roleKey: 'content_editor' }]);
    userIds.push(editor.userId);
    const res = await editor.client.get('/admin/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.applications).toBeNull();
    expect(res.body.people).toBeNull();
    expect(res.body.activity).toBeNull();
    expect(res.body.content.pages).toBeTypeOf('object');
  });
});
