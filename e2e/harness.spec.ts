// Proof that the guards in fixtures.ts still catch what they promise to. Each test is expected to fail;
// if one starts passing, that guard has stopped working.
import { expectAccessible, test } from './fixtures.ts';

test.fail('a page answering 404 fails the test', async ({ page }) => {
  await page.goto('/no-such-page');
});

test.fail('a console error fails the test', async ({ page }) => {
  await page.goto('/');
  await page.evaluate('console.error("planted")');
});

test.fail('a serious accessibility issue fails the scan', async ({ page }) => {
  await page.goto('/');
  // An unlabelled form field: axe's `label` rule, impact critical.
  await page.evaluate('document.querySelector("main").append(document.createElement("input"))');
  await expectAccessible(page);
});
