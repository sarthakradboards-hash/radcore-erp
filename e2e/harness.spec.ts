// Proof that the guards in fixtures.ts still catch what they promise to, each for its own reason. Each test checks
// what the guard recorded, then clears it so the test itself passes.
import { request } from '@playwright/test';
import { describeBooksProblems, expect, isCancelledApiGet, isCancelledRscPrefetch, readBooksProblems, seriousA11yIssues, test } from './fixtures.ts';
import { BOOKS_ROLE, stateFor } from './people.ts';

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

// RAD-76: WebKit reports a Next RSC prefetch cut off by navigation as an uncaught error, not an aborted request. Only
// that exact text, for this site and with `_rsc`, is ignored; each `false` here fails if the filter is made wider.
test('only WebKit\'s cancelled same-origin ?_rsc= prefetch is ignored as an uncaught error', ({ baseURL }) => {
  const origin = baseURL!;
  const host = new URL(origin).host;
  const ignored = (m: string) => isCancelledRscPrefetch(m, origin);
  // As WebKit says it, and as CI's log showed it (the scheme cut off), with _rsc first or later in the query.
  expect(ignored(`Fetch API cannot load ${origin}/admin/locations?_rsc=5CB68i4pnAekjehf due to access control checks.`)).toBe(true);
  expect(ignored(`/${host}/admin/locations?_rsc=5CB68i4pnAekjehf due to access control checks.`)).toBe(true);
  expect(ignored(`Fetch API cannot load ${origin}/admin/items?status=inactive&_rsc=1a2b due to access control checks.`)).toBe(true);
  // Still problems: another origin, a request that isn't a prefetch, other text, and another site dressed as this one.
  expect(ignored('Fetch API cannot load https://evil.example/admin?_rsc=1a2b due to access control checks.')).toBe(false);
  expect(ignored(`Fetch API cannot load ${origin}/api/me due to access control checks.`)).toBe(false);
  expect(ignored(`Fetch API cannot load ${origin}/api/me?x_rsc=1 due to access control checks.`)).toBe(false);
  expect(ignored(`Fetch API cannot load ${origin}/admin?_rsc=1a2b due to access control checks. And then something else.`)).toBe(false);
  expect(ignored(`Fetch API cannot load https://evil.example/${host}/admin?_rsc=1a2b due to access control checks.`)).toBe(false);
  expect(ignored(`Fetch API cannot load http://${host}.evil.example/admin?_rsc=1a2b due to access control checks.`)).toBe(false);
});

// #232: the same WebKit text for a GET to this site's /api/ (the bell's unread count, cut off by sign-in's navigation).
// Ignored only for a URL the page really sent a GET to; each `false` fails if the filter is made wider.
test('only WebKit\'s cancelled same-origin GET to /api/ that the page sent is ignored as an uncaught error', ({ baseURL }) => {
  const origin = baseURL!;
  const host = new URL(origin).host;
  const bell = `${origin}/api/me/notifications/unread`;
  const ignored = (m: string, gets: string[] = [bell]) => isCancelledApiGet(m, origin, new Set(gets));
  // As WebKit says it, and with the scheme cut off as CI's log shows it.
  expect(ignored(`Fetch API cannot load ${bell} due to access control checks.`)).toBe(true);
  expect(ignored(`/${host}/api/me/notifications/unread due to access control checks.`)).toBe(true);
  expect(ignored(`Fetch API cannot load ${origin}/api/items?input=%7B%7D due to access control checks.`, [`${origin}/api/items?input=%7B%7D`])).toBe(true);
  // Still problems: a URL the page never sent a GET to (a POST, or nothing), another query, a path outside /api/,
  // another origin, other text, and another site dressed as this one.
  expect(ignored(`Fetch API cannot load ${bell} due to access control checks.`, [])).toBe(false);
  expect(ignored(`Fetch API cannot load ${bell}?x=1 due to access control checks.`)).toBe(false);
  expect(ignored(`Fetch API cannot load ${origin}/apix/me due to access control checks.`, [`${origin}/apix/me`])).toBe(false);
  expect(ignored(`Fetch API cannot load ${origin}/admin/items due to access control checks.`, [`${origin}/admin/items`])).toBe(false);
  expect(ignored('Fetch API cannot load https://evil.example/api/me/notifications/unread due to access control checks.',
    ['https://evil.example/api/me/notifications/unread'])).toBe(false);
  expect(ignored(`Fetch API cannot load ${bell} due to access control checks. And then something else.`)).toBe(false);
  expect(ignored(`Fetch API cannot load https://evil.example/${host}/api/me/notifications/unread due to access control checks.`)).toBe(false);
  expect(ignored(`Fetch API cannot load http://${host}.evil.example/api/me/notifications/unread due to access control checks.`)).toBe(false);
});

test('a cancelled /api/ GET error is not recorded; the same for a POST, or a URL never requested, is', async ({ page, pageProblems, baseURL }) => {
  await page.goto('/');
  await page.route('**/api/e2e-harness/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.evaluate(`Promise.all([fetch('/api/e2e-harness/got'), fetch('/api/e2e-harness/posted', { method: 'POST' })])`);
  const throwLater = (m: string) => page.evaluate(`setTimeout(() => { throw new Error(${JSON.stringify(m)}) })`);
  const text = (path: string) => `Fetch API cannot load ${baseURL}/api/e2e-harness/${path} due to access control checks.`;
  for (const path of ['got', 'posted', 'never']) await throwLater(text(path));
  // Only the POST and the never-requested one are problems; waiting for them proves the GET had its turn.
  await expect.poll(() => pageProblems).toEqual([`uncaught: ${text('posted')}`, `uncaught: ${text('never')}`]);
  pageProblems.length = 0;
});

test('a GET cancelled before any request is seen still counts as sent: its cancel isn\'t recorded, a POST\'s is', async ({ page, pageProblems, baseURL }) => {
  await page.goto('/');
  // An already-aborted signal: the fetch rejects at once and no request reaches Playwright, as WebKit's teardown does.
  await page.evaluate(`(() => { const c = new AbortController(); c.abort();
    fetch('/api/e2e-harness/early-get', { signal: c.signal }).catch(() => {});
    fetch('/api/e2e-harness/early-post', { method: 'POST', signal: c.signal }).catch(() => {}); })()`);
  const throwLater = (m: string) => page.evaluate(`setTimeout(() => { throw new Error(${JSON.stringify(m)}) })`);
  const text = (path: string) => `/${new URL(baseURL!).host}/api/e2e-harness/${path} due to access control checks.`;
  for (const path of ['early-get', 'early-post']) await throwLater(text(path));
  await expect.poll(() => pageProblems).toEqual([`uncaught: ${text('early-post')}`]);
  pageProblems.length = 0;
});

test('a cancelled-prefetch error from this site is not recorded; the same from another site is', async ({ page, pageProblems, baseURL }) => {
  await page.goto('/');
  const throwLater = (m: string) => page.evaluate(`setTimeout(() => { throw new Error(${JSON.stringify(m)}) })`);
  await throwLater(`Fetch API cannot load ${baseURL}/admin/locations?_rsc=abc due to access control checks.`);
  await throwLater('Fetch API cannot load https://evil.example/admin/locations?_rsc=abc due to access control checks.');
  // Only the second is a problem; waiting for it also proves the first had its turn and was let through.
  await expect.poll(() => pageProblems).toEqual(['uncaught: Fetch API cannot load https://evil.example/admin/locations?_rsc=abc due to access control checks.']);
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
  // Held open by a route that never answers, and aborted only once the request is seen: aborting in the same tick as
  // the fetch could cancel it before any request existed, and then no requestfailed came (once, under suite load).
  await page.route('**/?slow', () => undefined);
  const sent = page.waitForEvent('request', (r) => r.url().endsWith('/?slow'));
  const failed = page.waitForEvent('requestfailed', (r) => r.url().endsWith('/?slow'));
  // Not returned: evaluate would wait for the fetch's promise, and the route never answers it.
  await page.evaluate('(() => { window.__slow = new AbortController(); fetch("/?slow", { signal: window.__slow.signal }).catch(() => {}); })()');
  await sent;
  await page.evaluate('window.__slow.abort()');
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
    // The API's own answer for a route it doesn't have, past the guard: not 403, not the web app's 404 page, not a
    // 5xx from an API that's down. Update it when the API gets its own not-found answer.
    expect(answer).toEqual({ status: 404, body: expect.stringContaining('Cannot POST /e2e-origin-probe') });
  });
});

// RAD-95: the books check every test ends with. It reads as its own person, who may read the journal and nothing else,
// and a problem fails the test in words. (Planting a real problem here would trip every test running alongside: that
// proof is on the PR, against a database of its own.)
test('the books check reads healthy books as a person who can do nothing else', async ({ baseURL }) => {
  expect(await readBooksProblems(baseURL!)).toEqual([]);
  const api = await request.newContext({ baseURL: baseURL!, storageState: stateFor(BOOKS_ROLE) });
  // Reads with valid input ({}), so the refusal is the permission's (input is checked first: a bad one answers 400).
  expect((await api.get('/api/admin/company?input=%7B%7D')).status()).toBe(403);
  expect((await api.get('/api/stock/location-kinds?input=%7B%7D')).status()).toBe(403);
  await api.dispose();
});

test('a books problem is worded for the failed test, with its item and place', () => {
  const lines = describeBooksProblems([
    { check: 'trial_balance', itemId: null, locationId: null, message: 'Debits 100.00 and credits 99.00 differ' },
    { check: 'stock_value', itemId: 'i-1', locationId: 'l-1', message: 'Stock in Hand 0.00, the ledger 100.00' },
  ]);
  expect(lines).toEqual([
    'trial_balance: Debits 100.00 and credits 99.00 differ',
    'stock_value: Stock in Hand 0.00, the ledger 100.00 (item i-1) (location l-1)',
  ]);
  expect(() => expect(lines, 'the books check (RAD-95) after this test').toEqual([])).toThrow(/the books check \(RAD-95\)/);
});
