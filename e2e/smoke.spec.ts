// The harness's own check: the app starts and its first page loads cleanly and passes the axe scan.
// shortcut: M0 has no sign-in page, so this opens `/`; M1-14 points it at the sign-in page when it builds one.
import { expect, expectAccessible, test } from './fixtures.ts';

test('the start page loads with no console errors, no failed requests and no serious accessibility issues', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('RadCore');
  await expect(page.getByRole('main')).toBeVisible();
  await expectAccessible(page);
});
