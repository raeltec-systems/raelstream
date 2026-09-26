import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  hotp,
  otpauthUri,
  totp,
  verifyTotp,
  timeStep,
} from './totp.js';
import { hashPassword, passwordProblem, verifyPassword } from './passwords.js';
import { decryptSecret, encryptSecret, loadTotpKey } from './sealing.js';
import { hashRecoveryCode, newRecoveryCodes, normaliseRecoveryCode } from './recovery.js';

const RFC_SECRET = Buffer.from('12345678901234567890');

describe('HOTP/TOTP (RFC 4226 / RFC 6238 test vectors)', () => {
  it('matches RFC 4226 appendix D', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((c) => hotp(RFC_SECRET, c))).toEqual([
      '755224',
      '287082',
      '359152',
      '969429',
      '338314',
      '254676',
      '287922',
      '162583',
      '399871',
      '520489',
    ]);
  });
  it('matches RFC 6238 SHA-1 vectors (last 6 digits)', () => {
    expect(totp(RFC_SECRET, 59_000)).toBe('287082');
    expect(totp(RFC_SECRET, 1_111_111_109_000)).toBe('081804');
    expect(totp(RFC_SECRET, 1_234_567_890_000)).toBe('005924');
    expect(totp(RFC_SECRET, 2_000_000_000_000)).toBe('279037');
  });
  it('accepts ±1 step and refuses reuse of the same step (replay)', () => {
    const now = 1_700_000_000_000;
    const code = totp(RFC_SECRET, now);
    const step = verifyTotp(RFC_SECRET, code, 0, now);
    expect(step).toBe(timeStep(now));
    expect(verifyTotp(RFC_SECRET, code, step!, now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now - 30_000), 0, now)).not.toBeNull();
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now - 90_000), 0, now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, 'abcdef', 0, now)).toBeNull();
  });
  it('round-trips base32 and builds an otpauth URI', () => {
    const b = Buffer.from('hello world 1234');
    expect(base32Decode(base32Encode(b))).toEqual(b);
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(otpauthUri(RFC_SECRET, 'owner@church.org')).toMatch(
      /^otpauth:\/\/totp\/raelstream%3Aowner%40church\.org\?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&/,
    );
  });
});

describe('passwords', () => {
  it('hashes with Argon2id and verifies', async () => {
    const h = await hashPassword('correct horse battery staple');
    expect(h).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
    expect(await verifyPassword('correct horse battery staple', h)).toBe(true);
    expect(await verifyPassword('wrong password here', h)).toBe(false);
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
  });
  it('enforces a minimal policy', () => {
    expect(passwordProblem('short', 'a@b.c')).toBe('too_short');
    expect(passwordProblem('owner@church.org', 'Owner@Church.org')).toBe('same_as_email');
    expect(passwordProblem('a long enough passphrase', 'a@b.c')).toBeNull();
  });
});

describe('secret sealing and recovery codes', () => {
  it('AES-GCM round trip and tamper detection', () => {
    const key = loadTotpKey(undefined, false);
    const blob = encryptSecret(key, RFC_SECRET);
    expect(decryptSecret(key, blob)).toEqual(RFC_SECRET);
    blob[blob.length - 1] = blob[blob.length - 1]! ^ 1;
    expect(() => decryptSecret(key, blob)).toThrow();
    expect(() => loadTotpKey(undefined, true)).toThrow();
  });
  it('makes ten distinct codes and normalises input', () => {
    const codes = newRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    expect(codes[0]).toMatch(/^[a-z2-7]{4}-[a-z2-7]{4}-[a-z2-7]{4}$/);
    expect(normaliseRecoveryCode(codes[0]!.toUpperCase().replace(/-/g, ' '))).toBe(codes[0]);
    expect(hashRecoveryCode(codes[0]!)).toBe(hashRecoveryCode(codes[0]!.replace(/-/g, '')));
  });
});
