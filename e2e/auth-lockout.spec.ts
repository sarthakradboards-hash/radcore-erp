// RAD-58: lockout (RAD-64). Ten tries at one address within the window lock it: the eleventh is refused even with the
// right password, and the screen says why, without saying whether the address has an account.
import { expect, test } from './fixtures.ts';
import { password, seedPerson } from './people.ts';
import { submitPassword } from './sign-in-steps.ts';

test.use({ expectedStatuses: [401, 422, 429] });
// Each real sign-in costs the api an Argon2 hash, and the whole suite runs in parallel: room for several.
test.describe.configure({ timeout: 90_000 });

test('ten wrong passwords lock the address; then even the right one is refused, with the reason shown', async ({ page }) => {
  const person = await seedPerson('sales');
  await page.goto('/sign-in');
  for (let i = 1; i <= 10; i += 1) {
    const answered = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/sign-in');
    await submitPassword(page, person.email, `wrong password number ${i} of ten`);
    expect((await answered).status(), `try ${i}`).not.toBe(200);
  }
  const last = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/sign-in');
  await submitPassword(page, person.email, password());
  expect((await last).status()).toBe(429);
  await expect(page.getByRole('alert').filter({ hasText: /Too many tries/ })).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByText(/^Signed in as /)).toHaveCount(0);
});
