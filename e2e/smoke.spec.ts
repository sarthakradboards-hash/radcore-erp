// The harness's own check: the app starts and its first page loads cleanly and passes the axe scan. The first page a
// visitor sees is sign-in: the signed-in screens redirect there until they sign in (RAD-50, e2e/shell.spec.ts).
import { expect, expectAccessible, test } from './fixtures.ts';

test('the sign-in page loads with no console errors, no failed requests and no serious accessibility issues', async ({ page }) => {
  await page.goto('/sign-in');
  await expect(page).toHaveTitle('Sign in · RadCore');
  await expect(page.getByRole('main')).toBeVisible();
  await expectAccessible(page);
});
