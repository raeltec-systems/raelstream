import { expect, test, type Page } from '@playwright/test';
import { E2E } from '../../playwright.config.js';
import { e2eUser, signIn, totpCode } from './auth.js';

/**
 * M4: the owner invites an operator, the operator enrols an authenticator, and a second studio tab is
 * read-only until the owner takes over; the operator cannot take over from the owner (SPEC §6.1, §9.10).
 */
test('invite → enrol → operator runs studio → owner takes over', async ({ browser }) => {
  const ownerCtx = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const owner = await ownerCtx.newPage();
  await owner.goto('/studio');
  await signIn(owner, e2eUser('invite'));

  // Invite link (secret in the fragment)
  await owner.getByRole('button', { name: 'Settings' }).click();
  await owner.getByRole('button', { name: 'Create invite link' }).click();
  const link = (await owner.getByTestId('invite-link').textContent())!;
  expect(link).toMatch(/\/invite#t=[A-Za-z0-9_-]{43}$/);

  // Operator accepts and enrols
  const opCtx = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const op = await opCtx.newPage();
  await op.goto(link);
  await expect(op.getByText('Chanda invited you')).toBeVisible();
  expect(new URL(op.url()).hash).toBe('');
  await op.getByLabel('Your name').fill('Mutale');
  await op.getByLabel('Email').fill('mutale@e2e.test');
  await op.getByLabel('Choose a password').fill('a long volunteer password');
  await op.getByLabel('Type the password again').fill('a long volunteer password');
  await op.getByRole('button', { name: 'Create my account' }).click();
  const secret = (await op.getByTestId('totp-secret').textContent())!.replace(/\s/g, '');
  await expect(op.getByTestId('recovery-codes').locator('li')).toHaveCount(10);
  await op.getByLabel('6-digit code').fill(totpCode(secret));
  const finish = op.getByRole('button', { name: 'Finish and sign in' });
  await expect(finish).toBeDisabled(); // recovery codes must be acknowledged first
  await op.getByLabel("I've saved my recovery codes").check();
  await finish.click();
  await expect(op.getByRole('heading', { name: 'Start a service' })).toBeVisible();
  await expect(op.getByRole('button', { name: 'Settings' })).toHaveCount(0); // owner only

  // The operator starts a service and holds the studio
  await op.getByRole('button', { name: 'Start without a saved service' }).click();
  await expect(op.getByRole('heading', { name: 'Connect the camera' })).toBeVisible();

  // The owner's studio is read-only until the owner takes over (confirmed)
  await owner.getByRole('button', { name: 'Back' }).click();
  await expect(owner.getByText('Viewing only: Mutale is running the studio')).toBeVisible();
  await expect(owner.getByRole('button', { name: 'Show pairing code' })).toBeDisabled();
  await owner.getByRole('button', { name: 'Take over' }).click();
  await owner.getByRole('button', { name: 'Take over the studio' }).click();
  await expect(owner.getByText(/Viewing only/)).toHaveCount(0);
  await expect(owner.getByRole('button', { name: 'Show pairing code' })).toBeEnabled();

  // The operator's tab is fenced; an operator cannot take over from someone else (SPEC §6.2)
  await expect(op.getByText('Viewing only: Chanda is running the studio')).toBeVisible();
  await expect(op.getByText(/Only the owner can take over/)).toBeVisible();
  await expect(op.getByRole('button', { name: 'Take over' })).toHaveCount(0);

  await endService(owner);
  await ownerCtx.close();
  await opCtx.close();
});

/** Close the service so later specs start from the home screen. */
async function endService(page: Page) {
  const me = await (await page.request.get('/api/auth/me')).json();
  const active = await (await page.request.get('/api/sessions/active')).json();
  const clientId = await page.evaluate(() => sessionStorage.getItem('rs.client'));
  const r = await page.request.post(`/api/sessions/${active.id}/end`, {
    headers: { 'x-rs-csrf': me.csrf, 'x-rs-client': clientId!, origin: E2E.web },
  });
  expect(r.ok()).toBe(true);
}
