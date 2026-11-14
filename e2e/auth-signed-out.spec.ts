// RAD-58: signed out under an open page (RC-147). Another tab signs out; this page's next request finds the session
// gone and the signed-out dialog asks to sign in again, right there. What was typed stays, and passwords never reach
// the drafts store.
import { expect, expectAccessible, test } from './fixtures.ts';
import { apiSignIn, password, seedPerson } from './people.ts';
import { signInThroughScreen } from './sign-in-steps.ts';

test.use({ expectedStatuses: [401] }); // the save and /me reads after the session ends
// Each real sign-in costs the api an Argon2 hash, and the whole suite runs in parallel: room for several.
test.describe.configure({ timeout: 90_000 });

test('signed out in another tab: the dialog appears on the next save, and signing in again keeps what was typed', async ({ page, context, baseURL }) => {
  const person = await seedPerson('sales');
  const api = await apiSignIn(baseURL!, person.email);
  await context.addCookies((await api.storageState()).cookies);
  await api.dispose();

  await page.goto('/account/password');
  await expect(page.getByRole('heading', { level: 1, name: 'Change your password' })).toBeVisible();
  const typedNew = `a brand new long password ${Date.now()}`;
  await page.getByLabel('Current password').fill(password());
  await page.getByLabel('New password').fill(typedNew);

  // Another tab of the same browser signs out, with the browser's own request.
  const tab = await context.newPage();
  await tab.goto('/');
  const out = await tab.evaluate(async () => (await fetch('/api/sign-out', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status);
  expect(out).toBe(200);
  await tab.close();

  await page.getByRole('button', { name: 'Change password' }).click();
  const dialog = page.getByRole('dialog', { name: 'You’ve been signed out' });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel('Current password')).toHaveValue(password());
  await expect(page.getByLabel('New password')).toHaveValue(typedNew);
  await expectAccessible(page);

  await signInThroughScreen(page, dialog, person.email);
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel('Current password')).toHaveValue(password());
  await expect(page.getByLabel('New password')).toHaveValue(typedNew);
  // Kept in the page only: no password in the drafts store (RAD-55).
  const stored = await page.evaluate(() => Object.keys(sessionStorage).map((k) => `${k}=${sessionStorage.getItem(k)}`).join('\n'));
  expect(stored).not.toContain(typedNew);
  expect(stored).not.toContain(password());
});
