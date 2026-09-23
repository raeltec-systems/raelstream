import { argon2id, argon2Verify } from 'hash-wasm';
import { randomBytes } from 'node:crypto';

/** Argon2id, m=64 MiB, t=3, p=1 (SPEC §4.3). Encoded PHC string includes the parameters and salt. */
export async function hashPassword(password: string): Promise<string> {
  return argon2id({
    password,
    salt: randomBytes(16),
    parallelism: 1,
    iterations: 3,
    memorySize: 65536,
    hashLength: 32,
    outputType: 'encoded',
  });
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  try {
    return await argon2Verify({ password, hash: encoded });
  } catch {
    return false;
  }
}

let dummy: Promise<string> | null = null;
/** Burn equivalent time when the email is unknown, so timing does not reveal which accounts exist. */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummy ??= hashPassword('raelstream-dummy-password');
  await verifyPassword(password, await dummy);
}

export type PasswordProblem = 'too_short' | 'too_long' | 'same_as_email';

export function passwordProblem(password: string, email: string): PasswordProblem | null {
  if (password.length < 12) return 'too_short';
  if (password.length > 200) return 'too_long';
  if (password.trim().toLowerCase() === email.trim().toLowerCase()) return 'same_as_email';
  return null;
}
