import { describe, expect, it } from 'vitest';
import { weakPasswordReason } from './weak-passwords.js';

describe('weakPasswordReason', () => {
  it.each([
    'Password2024!',
    'P@ssw0rd12345',
    'Qwerty123456',
    'qwertyuiop12',
    'passwordpassword',
    '123456789012',
    'abcdefghijklm',
    'aaaaaaaaaaaa',
    'abcabcabcabc',
    'Welcome@2026',
    'Admissions2026',
    'Nairobi12345!',
  ])('rejects %s', (password) => {
    expect(weakPasswordReason(password)).not.toBeNull();
  });

  it.each([
    'river-mango-lantern-7',
    'Tw0 blue kettles sing',
    'kZ8#pq2Lw!xV',
    'correct horse battery',
  ])('allows %s', (password) => {
    expect(weakPasswordReason(password)).toBeNull();
  });
});
