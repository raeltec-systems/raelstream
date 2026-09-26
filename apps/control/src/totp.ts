import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** RFC 4648 base32 (no padding), as used by authenticator apps. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of clean) {
    const i = ALPHABET.indexOf(c);
    if (i < 0) throw new Error('invalid base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const TOTP_STEP_S = 30;
export const TOTP_DIGITS = 6;

/** HOTP (RFC 4226) with SHA-1, 6 digits. */
export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(msg).digest();
  const off = mac[mac.length - 1]! & 0x0f;
  const bin =
    ((mac[off]! & 0x7f) << 24) | (mac[off + 1]! << 16) | (mac[off + 2]! << 8) | mac[off + 3]!;
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export function timeStep(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_STEP_S);
}

export function totp(secret: Buffer, nowMs = Date.now()): string {
  return hotp(secret, timeStep(nowMs));
}

/**
 * Verify a 6-digit code within ±1 step (SPEC §4.3). Returns the matched step so the caller can refuse
 * reuse of the same or an earlier step (replay protection), or null.
 */
export function verifyTotp(
  secret: Buffer,
  code: string,
  lastUsedStep: number,
  nowMs = Date.now(),
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = timeStep(nowMs);
  for (const step of [now - 1, now, now + 1]) {
    if (step <= lastUsedStep) continue;
    const expect = Buffer.from(hotp(secret, step));
    if (timingSafeEqual(expect, Buffer.from(code))) return step;
  }
  return null;
}

export function newTotpSecret(): Buffer {
  return randomBytes(20);
}

export function otpauthUri(secret: Buffer, account: string, issuer = 'raelstream'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${base32Encode(secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
