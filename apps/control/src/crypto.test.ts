import { describe, expect, it } from 'vitest';
import { PHRASE_WORDS, randomToken, verificationPhrase } from './crypto.js';
import { deviceHintFromUserAgent } from './pairing.js';

describe('pairing secrets', () => {
  it('invitation tokens carry 256 bits as 43 base64url chars', () => {
    const t = randomToken(32);
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken(32)).not.toBe(t);
  });
  it('uses 256 distinct phrase words', () => {
    expect(new Set(PHRASE_WORDS).size).toBe(256);
  });
  it('builds word-word-NN phrases', () => {
    expect(verificationPhrase()).toMatch(/^[a-z]+-[a-z]+-\d{2}$/);
  });
  it('summarises user agents without identifiers', () => {
    expect(
      deviceHintFromUserAgent(
        'Mozilla/5.0 (Linux; Android 15; SM-A266B) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36',
      ),
    ).toBe('Android · Chrome');
    expect(deviceHintFromUserAgent(undefined)).toBe('');
  });
});
