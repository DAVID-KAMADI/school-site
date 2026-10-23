import { randomBytes } from 'node:crypto';
import {
  SecretBox,
  base32Decode,
  base32Encode,
  totpCode,
  verifyTotp,
} from './totp.js';

describe('totp', () => {
  // RFC 6238 test vector (SHA-1): secret "12345678901234567890", T = 59 s -> 94287082 (8 digits).
  const rfcSecret = base32Encode(Buffer.from('12345678901234567890'));

  it('matches the RFC 6238 test vector (last 6 digits)', () => {
    expect(totpCode(rfcSecret, Math.floor(59 / 30))).toBe('287082');
    expect(totpCode(rfcSecret, Math.floor(1111111109 / 30))).toBe('081804');
  });

  it('round-trips base32', () => {
    const buf = randomBytes(20);
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
  });

  it('accepts the current and adjacent steps, rejects others', () => {
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30_000);
    expect(verifyTotp(rfcSecret, totpCode(rfcSecret, step), now)).toBe(step);
    expect(verifyTotp(rfcSecret, totpCode(rfcSecret, step - 1), now)).toBe(
      step - 1,
    );
    expect(
      verifyTotp(rfcSecret, totpCode(rfcSecret, step - 3), now),
    ).toBeNull();
    expect(verifyTotp(rfcSecret, 'abc123', now)).toBeNull();
  });

  it('encrypts and decrypts secrets', () => {
    const box = new SecretBox(randomBytes(32).toString('base64'));
    const sealed = box.encrypt(rfcSecret);
    expect(sealed).not.toContain(rfcSecret);
    expect(box.decrypt(sealed)).toBe(rfcSecret);
  });
});
