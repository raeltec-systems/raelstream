import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import { E2E } from '../../playwright.config.js';

/** Accounts seeded by apps/control/test/e2e-prepare.ts (TEST-ONLY secrets). */
export interface E2EUser {
  email: string;
  password: string;
  secret: string;
}

export function e2eUser(
  key:
    'spine' | 'broadcast' | 'invite' | 'audio' | 'phone' | 'reconnect' | 'content' | 'destinations',
): E2EUser {
  const users = JSON.parse(readFileSync(join(tmpdir(), 'rs-e2e-users.json'), 'utf8'));
  return users[key] as E2EUser;
}

function base32Decode(s: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of s.replace(/[\s=]/g, '').toUpperCase()) {
    value = (value << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** RFC 6238 code for the current 30 s step (optionally offset, to avoid replaying a used step). */
export function totpCode(secretB32: string, offset = 0): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + offset));
  const h = createHmac('sha1', base32Decode(secretB32)).update(counter).digest();
  const o = h[h.length - 1]! & 0x0f;
  const n = (h.readUInt32BE(o) & 0x7fffffff) % 1_000_000;
  return n.toString().padStart(6, '0');
}

/** Real two-step sign-in through the studio UI (SPEC §6.1). */
export async function signIn(page: Page, u: E2EUser, offset = 0): Promise<void> {
  await page.getByLabel('Email').fill(u.email);
  await page.getByLabel('Password').fill(u.password);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('6-digit code').fill(totpCode(u.secret, offset));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Start a service' })).toBeVisible();
}

/** Close the active service so later specs start from the home screen. */
export async function endService(page: Page): Promise<void> {
  const me = await (await page.request.get('/api/auth/me')).json();
  const active = await (await page.request.get('/api/sessions/active')).json();
  const clientId = await page.evaluate(() => sessionStorage.getItem('rs.client'));
  const r = await page.request.post(`/api/sessions/${active.id}/end`, {
    headers: { 'x-rs-csrf': me.csrf, 'x-rs-client': clientId!, origin: E2E.web },
  });
  expect(r.ok()).toBe(true);
}
