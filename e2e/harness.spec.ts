// Proof that the guards in fixtures.ts still catch what they promise to, each for its own reason. Each test checks
// what the guard recorded, then clears it so the test itself passes.
import { expect, seriousA11yIssues, test } from './fixtures.ts';

test('a page answering 404 is recorded', async ({ page, pageProblems }) => {
  await page.goto('/no-such-page');
  expect(pageProblems).toEqual([expect.stringMatching(/^HTTP 404: GET .*\/no-such-page$/)]);
  pageProblems.length = 0;
});

test.describe('with 404 expected', () => {
  test.use({ expectedStatuses: [404] });
  test('an expected status is not recorded', async ({ page, pageProblems }) => {
    await page.goto('/no-such-page');
    expect(pageProblems).toEqual([]);
  });
});

test('a console error is recorded', async ({ page, pageProblems }) => {
  await page.goto('/');
  await page.evaluate('console.error("planted")');
  expect(pageProblems).toEqual(['console error: planted']);
  pageProblems.length = 0;
});

test('an uncaught error is recorded', async ({ page, pageProblems }) => {
  await page.goto('/');
  await page.evaluate('setTimeout(() => { throw new Error("planted") })');
  await expect.poll(() => pageProblems).toEqual([expect.stringContaining('uncaught: planted')]);
  pageProblems.length = 0;
});

test('a request that cannot connect is recorded', async ({ page, pageProblems }) => {
  await page.goto('/');
  // Port 9 (discard) has nothing listening, so the connection is refused.
  await page.evaluate('fetch("http://127.0.0.1:9/").catch(() => {})');
  await expect.poll(() => pageProblems).toEqual([expect.stringMatching(/^request failed: GET http:\/\/127\.0\.0\.1:9\//)]);
  pageProblems.length = 0;
});

test('an aborted request is not recorded', async ({ page, pageProblems }) => {
  await page.goto('/');
  await page.evaluate('(() => { const c = new AbortController(); fetch("/?slow", { signal: c.signal }).catch(() => {}); c.abort(); })()');
  await page.waitForTimeout(200);
  expect(pageProblems).toEqual([]);
});

test('a serious accessibility issue is reported', async ({ page }) => {
  await page.goto('/');
  // Changing <main> before React hydrates it is a mismatch (React error #418), so wait for hydration first.
  await page.waitForFunction('Object.keys(document.querySelector("main") ?? {}).some((k) => k.startsWith("__reactFiber"))');
  // An unlabelled form field: axe's `label` rule, impact critical.
  await page.evaluate('document.querySelector("main").append(document.createElement("input"))');
  expect(await seriousA11yIssues(page)).toEqual([expect.stringMatching(/^label: /)]);
});
