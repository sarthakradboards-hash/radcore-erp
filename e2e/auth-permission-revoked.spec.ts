// RAD-58: a revoked permission leaves an open tab within a minute. Since RAD-83 a role that loses a key ends its
// holders' sessions, so the other tab's next /me read (the shell's one-minute refresh, RAD-52) finds the session gone
// and shows the signed-out dialog; after signing in again, the control that key gave is gone from the page.
import { randomUUID } from 'node:crypto';
import { expect, test } from './fixtures.ts';
import { apiSignIn, seedPerson } from './people.ts';
import { signInThroughScreen } from './sign-in-steps.ts';

test.use({ expectedStatuses: [401] }); // the /me read after the session ends

test('an admin takes audit:read from a role: its holder\'s open tab loses the Admin entry within a minute', async ({ page, context, baseURL }) => {
  test.setTimeout(150_000);
  // The admin, signed in through the api, makes a role that opens the audit trail and nothing else admin.
  const admin = await apiSignIn(baseURL!, (await seedPerson('admin')).email);
  const write = (method: 'post' | 'put', path: string, data: unknown) =>
    admin[method](`/api${path}`, { data, headers: { 'idempotency-key': randomUUID() } });
  const version = async () => ((await (await admin.get('/api/admin/permissions?input=%7B%7D')).json()) as { version: string }).version;
  const created = await write('post', '/admin/roles', { name: `E2E auditor ${randomUUID().slice(0, 6)}`, description: 'RAD-58 journey', reason: 'RAD-58 journey' });
  expect(created.status(), await created.text()).toBe(200);
  const { key } = (await created.json()) as { key: string };
  const grant = async (grants: string[]) => {
    const res = await write('put', `/admin/roles/${key}/permissions`, { grants, version: await version(), reason: 'RAD-58 journey' });
    expect(res.status(), await res.text()).toBe(200);
  };
  await grant(['audit:read', 'session:read']);

  // Its holder, in their own browser, sees Admin, which opens the audit trail.
  const holder = await seedPerson(key);
  const own = await apiSignIn(baseURL!, holder.email);
  await context.addCookies((await own.storageState()).cookies);
  await own.dispose();
  await page.goto('/');
  const adminEntry = page.getByRole('navigation', { name: 'Main menu' }).getByRole('link', { name: 'Admin' });
  await expect(adminEntry).toHaveAttribute('href', '/admin/audit');

  // The admin takes audit:read away.
  await grant(['session:read']);
  const revokedAt = Date.now();
  await admin.dispose();

  // Within a minute the open tab learns: its session ended with the role's shrink, so the dialog asks to sign in.
  const dialog = page.getByRole('dialog', { name: 'You’ve been signed out' });
  await expect(dialog).toBeVisible({ timeout: 65_000 });
  expect(Date.now() - revokedAt).toBeLessThan(65_000);
  await signInThroughScreen(page, dialog, holder.email);
  await expect(dialog).toHaveCount(0);
  await expect(adminEntry).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Main menu' }).getByRole('link')).toHaveText(['Home']);
});
