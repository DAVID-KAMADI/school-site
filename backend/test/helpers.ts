import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { MediaStorage } from '../src/cms/media/storage.js';
import { currentStep, totpCode } from '../src/identity/totp.js';
import { UsersService, type RoleGrant } from '../src/identity/users.service.js';

export async function createTestApp(): Promise<INestApplication<App>> {
  process.loadEnvFile?.();
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  app.use(cookieParser());
  app.useStaticAssets(new MediaStorage().publicRoot, { prefix: '/media' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();
  return app as unknown as INestApplication<App>;
}

/** Keeps cookies between requests and echoes the XSRF cookie like Angular's HttpClient does. */
export function client(app: INestApplication<App>) {
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
    patch: (url: string, body: object = {}) =>
      agent.patch(url).set('X-XSRF-TOKEN', xsrf).send(body).then(capture),
    delete: (url: string) =>
      agent.delete(url).set('X-XSRF-TOKEN', xsrf).then(capture),
    upload: (
      url: string,
      field: string,
      data: Buffer,
      filename: string,
      fields: Record<string, string> = {},
    ) => {
      let req = agent
        .post(url)
        .set('X-XSRF-TOKEN', xsrf)
        .attach(field, data, filename);
      for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
      return req.then(capture);
    },
  };
}

export type TestClient = ReturnType<typeof client>;

/** Creates a staff user with the given roles, signs in and completes 2FA setup. */
export async function signedInStaff(
  app: INestApplication<App>,
  roles: RoleGrant[],
) {
  const users = app.get(UsersService);
  const email = `e2e-${randomBytes(4).toString('hex')}@training.local`;
  const password = randomBytes(18).toString('base64url');
  const user = await users.create({
    email,
    fullName: `E2E ${roles.map((r) => r.roleKey).join('+')}`,
    password,
  });
  await users.setRoles(user.id, roles);

  const c = client(app);
  await c.get('/auth/csrf');
  await c.post('/auth/login', { email, password });
  const setup = await c.post('/auth/2fa/setup');
  const enabled = await c.post('/auth/2fa/enable', {
    code: totpCode(setup.body.secret, currentStep()),
  });
  if (enabled.status !== 200)
    throw new Error(`2FA setup failed: ${JSON.stringify(enabled.body)}`);
  return { client: c, userId: user.id, email };
}
