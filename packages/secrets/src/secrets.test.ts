import { describe, expect, it } from 'vitest';
import { generateKeypair, last4, open, seal } from './index.js';

describe('sealed boxes', () => {
  it('round-trips with the keypair and hides the plaintext', async () => {
    const kp = await generateKeypair();
    const ct = await seal(kp.publicKey, 'FB-123456789-0-AbcdEf');
    expect(ct.toString('latin1')).not.toContain('FB-123456789');
    expect(await open(kp, ct)).toBe('FB-123456789-0-AbcdEf');
  });
  it('cannot be opened with another keypair', async () => {
    const a = await generateKeypair();
    const b = await generateKeypair();
    const ct = await seal(a.publicKey, 'secret-key-1');
    await expect(open(b, ct)).rejects.toThrow();
  });
  it('shows only the last four characters', () => {
    expect(last4('abcd-efgh-1234')).toBe('1234');
  });
});
