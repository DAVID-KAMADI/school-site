import { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import { AccountType } from '../src/identity/entities/user.entity.js';
import { UsersService } from '../src/identity/users.service.js';
import { client, createTestApp, signedInStaff } from './helpers.js';

// Needs the local training database (see ../database/setup-local.example.sql).

describe('Access control and applicant accounts (e2e)', () => {
  let app: INestApplication<App>;
  const userIds: number[] = [];
  const roleKeys: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    const db = app.get(DataSource);
    if (userIds.length)
      await db.query('DELETE FROM users WHERE id IN (?)', [userIds]);
    if (roleKeys.length)
      await db.query('DELETE FROM roles WHERE `key` IN (?)', [roleKeys]);
    await app.close();
  });

  it('keeps an admissions officer to admissions', async () => {
    const officer = await signedInStaff(app, [
      { roleKey: 'admissions_officer' },
    ]);
    userIds.push(officer.userId);
    const c = officer.client;

    expect((await c.get('/admin/applications')).status).toBe(200);
    expect((await c.get('/admin/applicants')).status).toBe(200);
    expect((await c.get('/admin/admissions/programmes')).status).toBe(200);

    for (const url of [
      '/admin/pages',
      '/admin/blog',
      '/admin/settings',
      '/admin/menus',
      '/admin/users',
      '/admin/access/matrix',
      '/admin/audit',
    ])
      expect({ url, status: (await c.get(url)).status }).toEqual({
        url,
        status: 403,
      });

    const dashboard = await c.get('/admin/dashboard');
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.applications).not.toBeNull();
    expect(dashboard.body.content).toBeNull();
  });

  it('applies role changes straight away and audits them', async () => {
    const admin = await signedInStaff(app, [{ roleKey: 'super_admin' }]);
    userIds.push(admin.userId);
    const a = admin.client;

    const created = await a.post('/admin/access/roles', {
      name: `E2E role ${randomBytes(3).toString('hex')}`,
    });
    expect(created.status).toBe(201);
    roleKeys.push(created.body.key);

    const member = await signedInStaff(app, [{ roleKey: created.body.key }]);
    userIds.push(member.userId);
    expect((await member.client.get('/admin/timetable/terms')).status).toBe(
      403,
    );

    const set = await a.put(
      `/admin/access/roles/${created.body.key}/permissions`,
      {
        permissions: ['timetable.manage'],
      },
    );
    expect(set.status).toBe(200);
    expect(set.body.added).toEqual(
      expect.arrayContaining(['timetable.manage', 'admin.access']),
    );
    // No new sign-in needed.
    expect((await member.client.get('/admin/timetable/terms')).status).not.toBe(
      403,
    );

    const matrix = await a.get('/admin/access/matrix');
    expect(
      matrix.body.permissions.some(
        (p: { key: string }) => p.key === 'applications.apply',
      ),
    ).toBe(false);
    const superAdmin = matrix.body.roles.find(
      (r: { key: string }) => r.key === 'super_admin',
    );
    expect(superAdmin.locked).toBe(true);
    expect(
      (
        await a.put('/admin/access/roles/super_admin/permissions', {
          permissions: [],
        })
      ).status,
    ).toBe(400);

    // Cannot delete a role someone holds.
    expect(
      (await a.delete(`/admin/access/roles/${created.body.key}`)).status,
    ).toBe(400);

    const audit = await a.get(
      '/admin/audit?action=role.permissions_set&pageSize=5',
    );
    expect(
      audit.body.items.some(
        (e: { entityId: string }) => e.entityId === created.body.key,
      ),
    ).toBe(true);
  });

  it('keeps applicant accounts apart from staff', async () => {
    const admin = await signedInStaff(app, [{ roleKey: 'super_admin' }]);
    userIds.push(admin.userId);
    const users = app.get(UsersService);
    const applicant = await users.create({
      email: `e2e-${randomBytes(4).toString('hex')}@training.local`,
      fullName: 'E2E Applicant',
      password: randomBytes(18).toString('base64url'),
      accountType: AccountType.Applicant,
    });
    userIds.push(applicant.id);
    await users.setRoles(applicant.id, [{ roleKey: 'applicant' }]);

    const staffList = await admin.client.get('/admin/users');
    expect(
      staffList.body.some((u: { id: number }) => u.id === applicant.id),
    ).toBe(false);
    expect(
      (await admin.client.get('/admin/users/roles')).body.some(
        (r: { key: string }) => r.key === 'applicant',
      ),
    ).toBe(false);

    // Staff tools refuse applicant accounts; applicants cannot be given staff roles.
    expect(
      (await admin.client.post(`/admin/users/${applicant.id}/reset-password`))
        .status,
    ).toBe(404);
    expect(
      (
        await admin.client.put(`/admin/users/${admin.userId}/roles`, {
          roles: [{ roleKey: 'applicant' }],
        })
      ).status,
    ).toBe(400);
    await expect(
      users.setRoles(applicant.id, [{ roleKey: 'content_editor' }]),
    ).rejects.toThrow(/staff roles/);

    const applicants = await admin.client.get(
      `/admin/applicants?search=${encodeURIComponent('E2E Applicant')}`,
    );
    expect(applicants.status).toBe(200);
    expect(
      applicants.body.items.some((u: { id: number }) => u.id === applicant.id),
    ).toBe(true);
    const disabled = await admin.client.patch(
      `/admin/applicants/${applicant.id}/status`,
      { status: 'disabled' },
    );
    expect(disabled.status).toBe(200);
    // Applicant tools refuse staff accounts.
    expect(
      (
        await admin.client.post(
          `/admin/applicants/${admin.userId}/reset-password`,
        )
      ).status,
    ).toBe(404);
  });

  it('gives each part of admissions setup its own permissions', async () => {
    const admin = await signedInStaff(app, [{ roleKey: 'super_admin' }]);
    userIds.push(admin.userId);
    const role = await admin.client.post('/admin/access/roles', {
      name: `E2E intakes ${randomBytes(3).toString('hex')}`,
    });
    roleKeys.push(role.body.key);
    await admin.client.put(`/admin/access/roles/${role.body.key}/permissions`, {
      permissions: ['intakes.create', 'intakes.edit', 'intakes.delete'],
    });
    const clerk = await signedInStaff(app, [{ roleKey: role.body.key }]);
    userIds.push(clerk.userId);
    const c = clerk.client;

    expect((await c.get('/admin/admissions/intakes')).status).toBe(200);
    expect((await c.get('/admin/admissions/programmes')).status).toBe(403);
    expect((await c.get('/admin/admissions/document-types')).status).toBe(403);
    expect(
      (
        await c.post('/admin/admissions/programmes', {
          code: 'E2EX',
          name: 'Should not save',
          level: 'diploma',
          school: 'Nowhere',
          studyModes: ['full_time'],
        })
      ).status,
    ).toBe(403);

    const day = 86_400_000;
    const intake = await c.post('/admin/admissions/intakes', {
      name: `E2E intake ${randomBytes(3).toString('hex')}`,
      opensAt: new Date(Date.now() + 300 * day).toISOString(),
      closesAt: new Date(Date.now() + 330 * day).toISOString(),
      isActive: false,
    });
    expect(intake.status).toBe(201);
    expect(
      (await c.delete(`/admin/admissions/intakes/${intake.body.id}`)).status,
    ).toBe(200);

    // Something applicants already used cannot be deleted.
    const [used] = await app
      .get(DataSource)
      .query(
        'SELECT intake_id AS id FROM applications WHERE intake_id IS NOT NULL LIMIT 1',
      );
    if (used) {
      const blocked = await admin.client.delete(
        `/admin/admissions/intakes/${used.id}`,
      );
      expect(blocked.status).toBe(400);
      expect(blocked.body.message).toMatch(/cannot be deleted/);
    }

    const audit = await admin.client.get(
      '/admin/audit?action=intake.delete&pageSize=5',
    );
    expect(
      audit.body.items.some(
        (e: { entityId: string }) => e.entityId === String(intake.body.id),
      ),
    ).toBe(true);
  });

  it('needs a signed-in staff member for applicant accounts', async () => {
    expect((await client(app).get('/admin/applicants')).status).toBe(401);
  });
});
