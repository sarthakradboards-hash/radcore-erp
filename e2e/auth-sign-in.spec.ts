// RAD-58: signing in. A wrong password and an unknown address get the same words (ADR-001 §7a), and the right password
// opens the app as that person, with their name in the shell.
import { expect, expectAccessible, test } from './fixtures.ts';
import { password, seedPerson } from './people.ts';
import { submitPassword } from './sign-in-steps.ts';

test.use({ expectedStatuses: [401, 422] }); // the refused attempts, and the signed-out /me read
// Each real sign-in costs the api an Argon2 hash, and the whole suite runs in parallel: room for several.
test.describe.configure({ timeout: 90_000 });

const WRONG = 'That email address and password don’t match';

test('a wrong password and an unknown address are refused alike; the right password opens the app', async ({ page }) => {
  const person = await seedPerson('sales');
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
  await expectAccessible(page);

  await submitPassword(page, person.email, 'not the password, but long enough');
  await expect(page.getByRole('alert').filter({ hasText: WRONG })).toBeVisible();
  await submitPassword(page, `nobody-${person.email}`, password());
  await expect(page.getByRole('alert').filter({ hasText: WRONG })).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in$/);

  await submitPassword(page, person.email);
  await expect(page.getByText(`Signed in as ${person.name}`)).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/$/);
  await expectAccessible(page);
});
