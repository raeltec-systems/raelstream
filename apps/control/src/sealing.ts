import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

/**
 * AES-256-GCM for small secrets the control service must read back (TOTP seeds).
 * Layout: 12-byte IV | 16-byte tag | ciphertext. Key from RS_TOTP_KEY (32 bytes, base64).
 */
export function encryptSecret(key: Buffer, plaintext: Buffer): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}

export function decryptSecret(key: Buffer, blob: Buffer): Buffer {
  const d = createDecipheriv('aes-256-gcm', key, blob.subarray(0, 12));
  d.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([d.update(blob.subarray(28)), d.final()]);
}

/** Parse RS_TOTP_KEY; in non-production a stable development key is derived so tests run without setup. */
export function loadTotpKey(value: string | undefined, production: boolean): Buffer {
  if (value) {
    const k = Buffer.from(value, 'base64');
    if (k.length !== 32) throw new Error('RS_TOTP_KEY must be 32 bytes, base64-encoded');
    return k;
  }
  if (production) throw new Error('RS_TOTP_KEY is required in production');
  return createHash('sha256').update('raelstream-development-totp-key').digest();
}
