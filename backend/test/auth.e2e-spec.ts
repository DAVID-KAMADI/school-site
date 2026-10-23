import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { currentStep, totpCode } from '../src/identity/totp.js';
import { AccountType } from '../src/identity/entities/user.entity.js';
import { UsersService } from '../src/identity/users.service.js';

// Needs the local training database (see ../database/setup-local.example.sql).

/** Keeps cookies between requests and echoes the XSRF cookie like Angular's HttpClient does. */
function client(app: INestApplication<App>) {
  const agent = request.agent(app.getHttpServer());
  let xsrf = '';
  const capture = (res: request.Response) => {
    const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    const found = cookies.find((c) => c.startsWith('XSRF-TOKEN='));
    if (found) xsrf = found.split(';')[0].split('=')[1];
    return res;
  };
  return {
    get: (url: string) => agent.get(url).then(capture),
    post: (url: string, body: object = {}) =>
      agent.post(url).set('X-XSRF-TOKEN', xsrf).send(body).then(capture),
    put: (url: string, body: object = {}) =>
      agent.put(url).set('X-XSRF-TOKEN', xsrf).send(body).then(capture),
    raw: agent,
  };
}

describe('Authentication (e2e)', () => {
  let app: INestApplication<App>;
  let users: UsersService;
  const email = `e2e-${randomBytes(4).toString('hex')}@training.local`;
  const password = randomBytes(18).toString('base64url');
  const singleSessionEmail = `e2e-${randomBytes(4).toString('hex')}@training.local`;
  const singleSessionPassword = randomBytes(18).toString('base64url');
  const applicantEmail = `e2e-${randomBytes(4).toString('hex')}@training.local`;
  const applicantPassword = randomBytes(18).toString('base64url');

  beforeAll(async () => {
    process.loadEnvFile?.();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    users = app.get(UsersService);
    const user = await users.create({ email, fullName: 'E2E Admin', password });
    await users.setRoles(user.id, [{ roleKey: 'super_admin' }]);
    const staff = await users.create({
      email: singleSessionEmail,
      fullName: 'Single Session User',
      password: singleSessionPassword,
    });
    await users.setRoles(staff.id, [{ roleKey: 'content_editor' }]);
    const applicant = await users.create({
      email: applicantEmail,
      fullName: 'Two Device Applicant',
      password: applicantPassword,
      accountType: AccountType.Applicant,
    });
    await users.setRoles(applicant.id, [{ roleKey: 'applicant' }]);
  });

  afterAll(async () => {
    await app
      .get(DataSource)
      .query('DELETE FROM users WHERE email IN (?, ?, ?)', [
        email,
        singleSessionEmail,
        applicantEmail,
      ]);
    await app.close();
  });

  it('rejects state-changing requests without the XSRF token', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(403);
  });

  it('protects admin routes from anonymous visitors', async () => {
    const c = client(app);
    const res = await c.get('/admin/users');
    expect(res.status).toBe(401);
  });

  it('signs in, requires and completes 2FA setup, then manages users', async () => {
    const c = client(app);
    await c.get('/auth/csrf');

    expect(
      (await c.post('/auth/login', { email, password: 'wrong-password-123' }))
        .status,
    ).toBe(401);

    const login = await c.post('/auth/login', { email, password });
    expect(login.status).toBe(200);
    expect(login.body.twoFactorRequired).toBe(false);
    const sessionCookie = ([] as string[])
      .concat(login.headers['set-cookie'])
      .find((x) => x.startsWith('sid='))!;
    expect(sessionCookie).toMatch(/HttpOnly/i);

    // Staff must set up 2FA before using the admin API.
    const blocked = await c.get('/admin/users');
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('TWO_FACTOR_SETUP_REQUIRED');
    expect((await c.get('/auth/me')).body.twoFactorSetupRequired).toBe(true);

    const setup = await c.post('/auth/2fa/setup');
    expect(setup.status).toBe(200);
    expect(setup.body.otpauthUri).toContain('otpauth://totp/');
    const code = totpCode(setup.body.secret, currentStep());
    expect(
      (
        await c.post('/auth/2fa/enable', {
          code: '000000' === code ? '111111' : '000000',
        })
      ).status,
    ).toBe(401);
    expect((await c.post('/auth/2fa/enable', { code })).status).toBe(200);

    const list = await c.get('/admin/users');
    expect(list.status).toBe(200);
    expect(list.body.some((u: { email: string }) => u.email === email)).toBe(
      true,
    );

    const roles = await c.get('/admin/users/roles');
    expect(roles.body.map((r: { key: string }) => r.key)).toContain(
      'content_editor',
    );

    // A new sign-in now needs the authenticator code, and the same code cannot be reused.
    const c2 = client(app);
    await c2.get('/auth/csrf');
    expect(
      (await c2.post('/auth/login', { email, password })).body
        .twoFactorRequired,
    ).toBe(true);
    expect((await c2.get('/admin/users')).body.code).toBe(
      'TWO_FACTOR_REQUIRED',
    );
    expect((await c2.post('/auth/2fa/verify', { code })).status).toBe(401);

    // Knowing the password without the authenticator code does not sign out the other device.
    expect((await c.get('/admin/users')).status).toBe(200);
    expect((await c2.post('/auth/logout')).status).toBe(200);
    expect((await c2.get('/admin/users')).status).toBe(401);
  });

  it('keeps staff signed in on one device at a time', async () => {
    const first = client(app);
    const second = client(app);
    await first.get('/auth/csrf');
    await second.get('/auth/csrf');
    const login = {
      email: singleSessionEmail,
      password: singleSessionPassword,
    };

    expect((await first.post('/auth/login', login)).status).toBe(200);
    expect((await first.get('/auth/me')).body.user.email).toBe(
      singleSessionEmail,
    );

    expect((await second.post('/auth/login', login)).status).toBe(200);
    const me = (await first.get('/auth/me')).body;
    expect(me.user).toBeNull();
    expect(me.signedOutReason).toBe('replaced');
    expect((await first.get('/admin/pages')).body.code).toBe(
      'SESSION_REPLACED',
    );
    expect((await second.get('/auth/me')).body.user.email).toBe(
      singleSessionEmail,
    );

    const [{ count }] = await app
      .get(DataSource)
      .query(
        'SELECT COUNT(*) AS count FROM sessions WHERE replaced_at IS NULL AND user_id = (SELECT id FROM users WHERE email = ?)',
        [singleSessionEmail],
      );
    expect(Number(count)).toBe(1);

    // The audit log records which device was signed out.
    const [entry] = await app
      .get(DataSource)
      .query(
        "SELECT details FROM audit_logs WHERE action = 'auth.session_replaced' AND user_id = (SELECT id FROM users WHERE email = ?) ORDER BY id DESC LIMIT 1",
        [singleSessionEmail],
      );
    const details = (
      typeof entry.details === 'string'
        ? JSON.parse(entry.details)
        : entry.details
    ) as {
      signedOut: { ipAddress: string | null; userAgent: string | null }[];
    };
    expect(details.signedOut).toHaveLength(1);
    expect(details.signedOut[0]).toHaveProperty('ipAddress');
    expect(details.signedOut[0]).toHaveProperty('userAgent');
    expect((await second.post('/auth/logout')).status).toBe(200);
  });

  it('lets applicants stay signed in on several devices', async () => {
    const phone = client(app);
    const laptop = client(app);
    await phone.get('/auth/csrf');
    await laptop.get('/auth/csrf');
    const login = { email: applicantEmail, password: applicantPassword };

    expect((await phone.post('/auth/login', login)).status).toBe(200);
    expect((await laptop.post('/auth/login', login)).status).toBe(200);
    expect((await phone.get('/auth/me')).body.user.email).toBe(applicantEmail);
    expect((await laptop.get('/auth/me')).body.user.email).toBe(applicantEmail);
    await phone.post('/auth/logout');
    await laptop.post('/auth/logout');
  });

  it('cannot remove the last super administrator', async () => {
    const [{ count }] = await app
      .get(DataSource)
      .query(
        "SELECT COUNT(*) AS count FROM user_roles ur JOIN roles r ON r.id = ur.role_id JOIN users u ON u.id = ur.user_id WHERE r.`key` = 'super_admin' AND ur.scope_page_id IS NULL AND u.status = 'active'",
      );
    const user = await users.findByEmailWithSecrets(email);
    if (Number(count) === 1) {
      await expect(
        users.setRoles(user!.id, [{ roleKey: 'content_editor' }]),
      ).rejects.toThrow(/last active super administrator/);
    }
  });
});
