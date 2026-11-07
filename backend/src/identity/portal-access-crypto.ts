import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Crypto for staff portal access keys and the passes they lead to.
 * All of it is keyed with PORTAL_KEY_SECRET, so a database copy alone cannot be used to check guesses.
 */

/** Crockford base32: no I, L, O or U, so keys survive being read out or retyped. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const KEY_CHARS = 25; // 25 × 5 bits = 125 bits of randomness.
const KEY_PATTERN = /^[0-9A-HJKMNP-TV-Z]{25}$/;

export function portalSecret(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.PORTAL_KEY_SECRET;
  if (!value || value.length < 32)
    throw new Error('PORTAL_KEY_SECRET must be set (at least 32 random characters).');
  return value;
}

/** A new key, e.g. "7KQ2M-X9D4T-…" (five groups of five). Uses the OS's secure random generator. */
export function generatePortalKey(): string {
  // 256 is a multiple of 32, so masking each byte keeps every character equally likely.
  const bytes = randomBytes(KEY_CHARS);
  let raw = '';
  for (const b of bytes) raw += ALPHABET[b & 31];
  return formatPortalKey(raw);
}

export function formatPortalKey(normalised: string): string {
  return normalised.match(/.{5}/g)!.join('-');
}

/**
 * Upper-cases the typed key and drops spaces and dashes; also accepts O for 0 and I/L for 1.
 * Returns null when it cannot be a key (so it is rejected without a database lookup).
 */
export function normalisePortalKey(input: string): string | null {
  if (typeof input !== 'string' || input.length > 64) return null;
  const s = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  return KEY_PATTERN.test(s) ? s : null;
}

export function hashPortalKey(normalised: string, secret = portalSecret()): string {
  return createHmac('sha256', secret).update(`portal-key:${normalised}`).digest('hex');
}

/** Short-lived pass after a valid sign-in link: lets this browser use the staff sign-in. */
export type PortalToken = { t: 'pass'; k: string; e: number; n: string };

const mac = (data: string, secret: string) =>
  createHmac('sha256', secret).update(`portal-token:${data}`).digest('base64url');

export function signPortalToken(payload: PortalToken, secret = portalSecret()): string {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${data}.${mac(data, secret)}`;
}

/** The token's contents when the signature is right and it has not expired; otherwise null. */
export function readPortalToken(
  token: unknown,
  now = Date.now(),
  secret = portalSecret(),
): PortalToken | null {
  if (typeof token !== 'string' || token.length > 512) return null;
  const [data, sig, extra] = token.split('.');
  if (!data || !sig || extra !== undefined) return null;
  const expected = Buffer.from(mac(data, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const p = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as PortalToken;
    if (typeof p.e !== 'number' || p.e <= now || typeof p.k !== 'string') return null;
    return p.t === 'pass' && typeof p.n === 'string' ? p : null;
  } catch {
    return null;
  }
}

export function newNonce(): string {
  return randomBytes(12).toString('base64url');
}
