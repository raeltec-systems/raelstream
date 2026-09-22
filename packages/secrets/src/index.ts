import sodium from 'libsodium-wrappers';

/**
 * Stream-key encryption with libsodium sealed boxes (SPEC §14.2). The control service holds only the
 * public key and can encrypt; only the supervisor holds the secret key and can decrypt.
 */
export interface SealKeypair {
  publicKey: string;
  secretKey: string;
}

async function ready(): Promise<typeof sodium> {
  await sodium.ready;
  return sodium;
}

export async function generateKeypair(): Promise<SealKeypair> {
  const s = await ready();
  const kp = s.crypto_box_keypair();
  return { publicKey: s.to_base64(kp.publicKey), secretKey: s.to_base64(kp.privateKey) };
}

export async function seal(publicKeyB64: string, plaintext: string): Promise<Buffer> {
  const s = await ready();
  return Buffer.from(s.crypto_box_seal(s.from_string(plaintext), s.from_base64(publicKeyB64)));
}

export async function open(keys: SealKeypair, ciphertext: Uint8Array): Promise<string> {
  const s = await ready();
  return s.to_string(
    s.crypto_box_seal_open(
      ciphertext,
      s.from_base64(keys.publicKey),
      s.from_base64(keys.secretKey),
    ),
  );
}

/** Last four characters for display; the key itself is never returned by any API. */
export function last4(key: string): string {
  return key.slice(-4);
}
