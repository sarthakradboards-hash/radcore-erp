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
  // Same origin, so the CSP's connect-src allows it; the route refuses the connection (not an abort, which is ignored).
  await page.route('**/?refused', (route) => route.abort('connectionrefused'));
  await page.evaluate('fetch("/?refused").catch(() => {})');
  await expect.poll(() => pageProblems).toEqual([expect.stringMatching(/^request failed: GET http:\/\/127\.0\.0\.1:\d+\/\?refused \(.*REFUSED.*\)$/)]);
  pageProblems.length = 0;
});

test('an aborted request is not recorded', async ({ page, pageProblems }) => {
  await page.goto('/');
  // Wait for the abort itself, so this can't pass without a request ever being sent.
  const failed = page.waitForEvent('requestfailed', (r) => r.url().endsWith('/?slow'));
  await page.evaluate('(() => { const c = new AbortController(); fetch("/?slow", { signal: c.signal }).catch(() => {}); c.abort(); })()');
  expect((await failed).failure()?.errorText).toMatch(/ERR_ABORTED|NS_BINDING_ABORTED|cancelled/i);
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

// The CSP checks run in WebKit too, which refuses string evaluates under our CSP: so a function, typed by hand, since
// this project has no DOM lib.
type El = { nonce: string; textContent: string };
type Doc = { scripts: El[]; createElement(tag: 'style' | 'script'): El; head: { append(node: unknown): void } };
const plantUnNoncedStyle = () => {
  const doc = (globalThis as unknown as { document: Doc }).document;
  const style = doc.createElement('style');
  style.textContent = 'main { outline: 1px solid red }';
  doc.head.append(style);
};
// The page's own script (it carries the response's nonce, as the app's chunks do) evaluates a string, as zod's JIT
// probe did on RAD-52. Deferred, because the browser exempts code run inside Playwright's evaluate from the eval check.
const plantEvalProbe = () => {
  const doc = (globalThis as unknown as { document: Doc }).document;
  const script = doc.createElement('script');
  script.nonce = doc.scripts[0]!.nonce;
  script.textContent = 'setTimeout(() => { try { Function("")(); } catch {} })';
  doc.head.append(script);
};

test('a CSP violation is recorded, with the directive and what was blocked', async ({ page, pageProblems }) => {
  await page.goto('/');
  // A <style> without the response's nonce: style-src allows only nonced elements (RAD-56).
  await page.evaluate(plantUnNoncedStyle);
  await expect.poll(() => pageProblems).toContainEqual(expect.stringMatching(/^CSP violation: style-src(-elem)? blocked inline in /));
  pageProblems.length = 0; // Firefox also logs it as a console error.
});

test('an eval the CSP blocks is recorded, in Chromium too, which never logs it to the console', async ({ page, pageProblems }) => {
  await page.goto('/');
  await page.evaluate(plantEvalProbe);
  await expect.poll(() => pageProblems).toContainEqual(expect.stringMatching(/^CSP violation: script-src blocked eval in /));
  pageProblems.length = 0;
});

test('a popup is watched too: its CSP violation and its console error are recorded', async ({ page, pageProblems }) => {
  await page.goto('/');
  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    page.evaluate(() => { (globalThis as unknown as { open(url: string): unknown }).open('/'); }),
  ]);
  await popup.waitForLoadState();
  await popup.evaluate(plantUnNoncedStyle);
  await popup.evaluate(() => console.error('planted in the popup'));
  await expect.poll(() => pageProblems).toEqual(expect.arrayContaining([
    expect.stringMatching(/^CSP violation: style-src(-elem)? blocked inline in /),
    'console error: planted in the popup',
  ]));
  pageProblems.length = 0;
});

test('a page that keeps to the CSP records no violation', async ({ page, pageProblems }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  expect(pageProblems).toEqual([]);
});

// RAD-74: the browser's /api reaches the e2e API through the web app's dev/ci rewrite, and a browser write gets past
// the API's Origin check (RAD-39). The API has no routes yet, so the probe path answers "no such route" once past it.
test.describe('browser writes reach the API', () => {
  test.use({ expectedStatuses: [403, 404] });

  test('without an Origin, as only a non-browser sends it, the API refuses the write: /api is the API', async ({ page }) => {
    const res = await page.request.post('/api/e2e-origin-probe', { data: {} });
    expect(res.status()).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'forbidden' });
  });

  test('a browser write, with the page\'s own Origin, gets past the Origin check', async ({ page }) => {
    await page.goto('/');
    const answer = await page.evaluate(async () => {
      const r = await fetch('/api/e2e-origin-probe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      return { status: r.status, body: await r.text() };
    });
    expect(answer.status).not.toBe(403);
    expect(answer.body).not.toContain('Page not found'); // the API answered, not the web app's own 404 page
  });
});
