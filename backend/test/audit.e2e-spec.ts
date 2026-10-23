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

// Needs the local training database (see ../database/setup-local.example.sql).

describe('Audit log and password rules (e2e)', () => {
  let app: INestApplication<App>;
  let db: DataSource;
  let admin: TestClient;
  let adminId: number;
  let editor: TestClient;
  const userIds: number[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
    const a = await signedInStaff(app, [{ roleKey: 'super_admin' }]);
    admin = a.client;
    adminId = a.userId;
    const e = await signedInStaff(app, [{ roleKey: 'content_editor' }]);
    editor = e.client;
    userIds.push(a.userId, e.userId);
  });

  afterAll(async () => {
    await db.query('DELETE FROM users WHERE id IN (?)', [userIds]);
    await app.close();
  });

  it('is only open to users with audit.view', async () => {
    expect((await client(app).get('/admin/audit')).status).toBe(401);
    expect((await editor.get('/admin/audit')).status).toBe(403);
    expect((await admin.get('/admin/audit')).status).toBe(200);
  });

  it('lists sign-ins and failed attempts with filters', async () => {
    // A failed sign-in from a fresh visitor, against the admin's own account.
    const me = await admin.get('/auth/me');
    const visitor = client(app);
    await visitor.get('/auth/csrf');
    await visitor.post('/auth/login', {
      email: me.body.user.email,
      password: `wrong-${randomBytes(6).toString('hex')}`,
    });

    const failed = await admin.get(
      `/admin/audit?group=security&search=${encodeURIComponent(me.body.user.email)}`,
    );
    expect(failed.status).toBe(200);
    expect(failed.body.items.length).toBeGreaterThan(0);
    expect(
      failed.body.items.every((r: { action: string }) =>
        r.action.startsWith('auth.'),
      ),
    ).toBe(true);
    expect(failed.body.items[0]).toMatchObject({
      action: 'auth.login_failed',
      user: { id: adminId },
    });

    const today = new Date().toISOString().slice(0, 10);
    const logins = await admin.get(
      `/admin/audit?action=auth.login&from=${today}&to=${today}&pageSize=5`,
    );
    expect(logins.body.items.length).toBeGreaterThan(0);
    expect(
      logins.body.items.every(
        (r: { action: string }) => r.action === 'auth.login',
      ),
    ).toBe(true);
    expect(logins.body.pageSize).toBe(5);

    const actions = await admin.get('/admin/audit/actions');
    expect(actions.body).toEqual(
      expect.arrayContaining(['auth.login', 'auth.login_failed']),
    );

    expect((await admin.get('/admin/audit?group=nonsense')).status).toBe(400);
  });

  it('refuses common passwords when creating users', async () => {
    const res = await admin.post('/admin/users', {
      email: `e2e-weak-${randomBytes(3).toString('hex')}@training.local`,
      fullName: 'Weak Password',
      password: 'Password2026!',
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/too common/i);
  });
});
