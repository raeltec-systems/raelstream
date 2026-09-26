import { randomBytes } from 'node:crypto';
import { base32Encode } from './totp.js';
import { sha256 } from './crypto.js';

/** Ten single-use recovery codes, shown once, stored hashed (SPEC §6.1). ~60 bits each. */
export function newRecoveryCodes(n = 10): string[] {
  return Array.from({ length: n }, () => {
    const s = base32Encode(randomBytes(8)).slice(0, 12).toLowerCase();
    return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
  });
}

export function normaliseRecoveryCode(code: string): string {
  const c = code.toLowerCase().replace(/[^a-z2-7]/g, '');
  return c.length === 12 ? `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8, 12)}` : '';
}

export function hashRecoveryCode(code: string): string {
  return sha256(normaliseRecoveryCode(code)).toString('hex');
}
