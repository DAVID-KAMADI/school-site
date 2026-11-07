import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { productionCheck } from './production-check.js';

const good = {
  NODE_ENV: 'production',
  COOKIE_SECURE: 'true',
  REQUIRE_STAFF_2FA: 'true',
  TOTP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  PREVIEW_LINK_SECRET: randomBytes(32).toString('hex'),
  PORTAL_KEY_SECRET: randomBytes(32).toString('base64url'),
  FRONTEND_ORIGIN: 'https://www.example.ac.ke',
  DB_NAME: 'school_site',
  DB_USER: 'school_app',
  DB_PASSWORD: randomBytes(24).toString('base64url'),
  TRUST_PROXY: '1',
  WEBSITE_SERVER_SECRET: randomBytes(32).toString('base64url'),
};

describe('productionCheck', () => {
  it('passes a safe production configuration', () => {
    expect(productionCheck(good)).toEqual({ errors: [], warnings: [] });
  });

  it('ignores development', () => {
    expect(
      productionCheck({ NODE_ENV: 'development', COOKIE_SECURE: 'false' })
        .errors,
    ).toEqual([]);
  });

  it('stops a training configuration from going live', () => {
    const { errors } = productionCheck({
      ...good,
      COOKIE_SECURE: 'false',
      REQUIRE_STAFF_2FA: 'false',
      FRONTEND_ORIGIN: 'http://localhost:4200',
      DB_NAME: 'school_site_training',
      DB_USER: 'root',
      DB_PASSWORD: 'short',
      TOTP_ENCRYPTION_KEY: 'abc',
      PREVIEW_LINK_SECRET: 'x',
      PORTAL_KEY_SECRET: '',
      WEBSITE_SERVER_SECRET: '',
    });
    expect(errors).toHaveLength(10);
  });

  it('requires a portal key secret of its own', () => {
    expect(productionCheck({ ...good, PORTAL_KEY_SECRET: 'too-short' }).errors).toHaveLength(1);
    expect(
      productionCheck({ ...good, PORTAL_KEY_SECRET: good.PREVIEW_LINK_SECRET }).errors,
    ).toHaveLength(1);
  });

  it('requires a website server secret of its own', () => {
    expect(productionCheck({ ...good, WEBSITE_SERVER_SECRET: '' }).errors).toHaveLength(1);
    expect(
      productionCheck({ ...good, WEBSITE_SERVER_SECRET: good.PORTAL_KEY_SECRET }).errors,
    ).toHaveLength(1);
  });

  it('warns when TRUST_PROXY is missing', () => {
    expect(productionCheck({ ...good, TRUST_PROXY: '' }).warnings).toHaveLength(
      1,
    );
  });
});
