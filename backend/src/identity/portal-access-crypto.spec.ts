import {
  generatePortalKey,
  hashPortalKey,
  normalisePortalKey,
  portalSecret,
  readPortalToken,
  signPortalToken,
} from './portal-access-crypto.js';
import { PortalKeyStatus } from './entities/portal-access-key.entity.js';
import { PortalAccessService } from './portal-access.service.js';

const SECRET = 'test-secret-that-is-at-least-32-characters-long';
const OTHER = 'another-secret-that-is-at-least-32-characters!!';

describe('portal access keys', () => {
  it('generates five groups of five unambiguous characters, all different', () => {
    const keys = new Set(Array.from({ length: 2000 }, generatePortalKey));
    expect(keys.size).toBe(2000);
    for (const k of keys) expect(k).toMatch(/^([0-9A-HJKMNP-TV-Z]{5}-){4}[0-9A-HJKMNP-TV-Z]{5}$/);
  });

  it('accepts the key typed loosely (case, spaces, O for 0, I/L for 1) and rejects anything else', () => {
    const key = '7KQ2M-X9D40-11ABC-DEFGH-JKMNP';
    const n = normalisePortalKey(key)!;
    expect(normalisePortalKey(' 7kq2m x9d4o-ilabc defgh jkmnp ')).toBe(n);
    expect(normalisePortalKey('')).toBeNull();
    expect(normalisePortalKey('7KQ2M-X9D40')).toBeNull();
    expect(normalisePortalKey('7KQ2M-X9D40-11ABC-DEFGH-JKMNU')).toBeNull(); // U is not in the alphabet
    expect(normalisePortalKey('x'.repeat(100))).toBeNull();
  });

  it('hashes with the server secret (a database copy alone cannot check guesses)', () => {
    const n = normalisePortalKey(generatePortalKey())!;
    expect(hashPortalKey(n, SECRET)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashPortalKey(n, SECRET)).toBe(hashPortalKey(n, SECRET));
    expect(hashPortalKey(n, SECRET)).not.toBe(hashPortalKey(n, OTHER));
  });

  it('refuses to run without a long secret', () => {
    expect(() => portalSecret({})).toThrow();
    expect(() => portalSecret({ PORTAL_KEY_SECRET: 'short' })).toThrow();
    expect(portalSecret({ PORTAL_KEY_SECRET: SECRET })).toBe(SECRET);
  });
});

describe('portal tokens', () => {
  const now = 1_800_000_000_000;
  const pass = { t: 'pass' as const, k: 'key-1', e: now + 60_000, n: 'abc' };

  it('round-trips a signed token', () => {
    expect(readPortalToken(signPortalToken(pass, SECRET), now, SECRET)).toEqual(pass);
  });

  it('rejects expired, tampered, foreign-secret and malformed tokens', () => {
    const token = signPortalToken(pass, SECRET);
    expect(readPortalToken(token, pass.e, SECRET)).toBeNull();
    expect(readPortalToken(token, now, OTHER)).toBeNull();
    const [data, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...pass, k: 'key-2' })).toString('base64url');
    expect(readPortalToken(`${forged}.${sig}`, now, SECRET)).toBeNull();
    expect(readPortalToken(`${data}.${sig}x`, now, SECRET)).toBeNull();
    expect(readPortalToken(`${token}.extra`, now, SECRET)).toBeNull();
    expect(readPortalToken(undefined, now, SECRET)).toBeNull();
    expect(readPortalToken('garbage', now, SECRET)).toBeNull();
  });

  it('rejects anything that is not a sign-in pass', () => {
    const other = { t: 'device', k: 'key-1', u: 42, e: now + 60_000 } as unknown as Parameters<typeof signPortalToken>[0];
    expect(readPortalToken(signPortalToken(other, SECRET), now, SECRET)).toBeNull();
  });
});

describe('key status', () => {
  const now = Date.now();
  const base = { status: PortalKeyStatus.Active, expiresAt: new Date(now + 60_000), currentUses: 0, maxUses: 1 };

  it('is active, expired, exhausted or revoked (revoked wins)', () => {
    expect(PortalAccessService.state(base, now)).toBe('active');
    expect(PortalAccessService.state({ ...base, expiresAt: new Date(now) }, now)).toBe('expired');
    expect(PortalAccessService.state({ ...base, currentUses: 1 }, now)).toBe('exhausted');
    expect(
      PortalAccessService.state({ ...base, status: PortalKeyStatus.Revoked, expiresAt: new Date(now - 1) }, now),
    ).toBe('revoked');
  });
});
