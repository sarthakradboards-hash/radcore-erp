// What every journey imports instead of @playwright/test. Each test fails if the page logged a console error, threw,
// broke the Content Security Policy, or had a request fail or answer 4xx/5xx, so no journey has to remember to check.
// `expectAccessible` is the axe scan. And every test ends with the books check (RAD-95): the books are healthy after it.
import AxeBuilder from '@axe-core/playwright';
import { expect, request, test as base, type APIRequestContext, type Page } from '@playwright/test';
import { apiSignIn, BOOKS_ROLE, roleEmail, stateFor } from './people.ts';

export { expect };

type Options = {
  /** Statuses this test expects to see, for example `test.use({ expectedStatuses: [401] })` in an auth journey. */
  expectedStatuses: number[];
};
type Fixtures = {
  /** What went wrong on the page so far. Checked when the test ends; the guard self-checks read it directly. */
  pageProblems: string[];
  /** The books check after the test (RAD-95). Nothing to use: it runs on its own when the test ends. */
  booksCheck: void;
};

type BooksProblem = { check: string; itemId: string | null; locationId: string | null; message: string };

/**
 * GET /books/check (journal:read, #217): the problems in the books now, read as the books check's own person (seeded by
 * global-setup.ts with journal:read only). Its session ending is not a books problem: it signs in again once.
 */
export async function readBooksProblems(baseURL: string): Promise<BooksProblem[]> {
  const ask = (api: APIRequestContext) => api.get('/api/books/check?input=%7B%7D');
  let api = await request.newContext({ baseURL, storageState: stateFor(BOOKS_ROLE) });
  try {
    let res = await ask(api);
    if (res.status() === 401) {
      await api.dispose();
      api = await apiSignIn(baseURL, roleEmail(BOOKS_ROLE));
      await api.storageState({ path: stateFor(BOOKS_ROLE) });
      res = await ask(api);
    }
    if (res.status() !== 200) throw new Error(`the books check answered ${res.status()}: ${await res.text()}`);
    return ((await res.json()) as { problems: BooksProblem[] }).problems;
  } finally {
    await api.dispose();
  }
}

/** One line per problem, as a failed test shows it. */
export const describeBooksProblems = (problems: readonly BooksProblem[]): string[] =>
  problems.map((p) => `${p.check}: ${p.message}${p.itemId === null ? '' : ` (item ${p.itemId})`}${p.locationId === null ? '' : ` (location ${p.locationId})`}`);

/**
 * WebKit's uncaught error for a Next RSC prefetch (`?_rsc=`) that navigation cut off, on this site's own `origin`:
 * "Fetch API cannot load http://127.0.0.1:3100/admin/locations?_rsc=… due to access control checks." (RAD-76). Chromium
 * and Firefox report the same cancel as an aborted request, which `requestfailed` below already ignores. Only that
 * exact text, same-origin and with `_rsc`: a refusal from another origin, or of any other request, is still a problem.
 */
export function isCancelledRscPrefetch(message: string, origin: string): boolean {
  const host = new URL(origin).host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\s|:)/{0,2}${host}/[^\\s?#]*\\?(?:[^\\s#]*&)?_rsc=[^\\s&#]+[^\\s#]* due to access control checks\\.$`)
    .test(message);
}

/**
 * The same WebKit text for a GET to this site's own `/api/` that a full-page navigation cut off: the shell's queries,
 * like the bell's unread count (#232), are torn down by the browser when sign-in sends the page home, and WebKit alone
 * reports that as uncaught. Only when the page really asked for a GET of exactly that URL (`gets`: every URL it fetched
 * by GET, from the fetch call itself, as WebKit can cancel before the request is seen): a URL it never asked for, any
 * other method, another origin, a path outside /api/ or other text is still a problem.
 */
export function isCancelledApiGet(message: string, origin: string, gets: ReadonlySet<string>): boolean {
  const site = new URL(origin);
  const host = site.host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|\\s|:)/{0,2}${host}(/api/[^\\s#]*) due to access control checks\\.$`).exec(message);
  return m !== null && gets.has(new URL(m[1]!, site.origin).href);
}

export const test = base.extend<Options & Fixtures>({
  expectedStatuses: [[], { option: true }],
  pageProblems: [
    async ({ context, expectedStatuses, baseURL }, use) => {
      const problems: string[] = [];
      const expected = (status: number) => expectedStatuses.includes(status);
      // Watched on the whole browser context, so a popup or new tab a journey opens is checked like its first page.
      context.on('console', (m) => {
        // The browser logs every 4xx/5xx as a console error too; those are judged by status below.
        if (m.type() === 'error' && !m.text().startsWith('Failed to load resource:')) problems.push(`console error: ${m.text()}`);
      });
      const gets = new Set<string>(); // what the pages asked for by GET, for isCancelledApiGet
      context.on('request', (r) => { if (r.method() === 'GET') gets.add(r.url()); });
      // WebKit can cancel a fetch before Playwright sees its request (#232's bell on sign-in), so each page also says
      // which URLs it fetched by GET at the call itself. The wrapper only listens: it passes every call through as is.
      await context.exposeBinding('__e2eFetchGet', (_source, url: string) => { gets.add(url); });
      await context.addInitScript(`if (!window.__e2eFetchWatched) {
        window.__e2eFetchWatched = true;
        const fetchAsIs = window.fetch;
        window.fetch = function (input, init) {
          try {
            const asked = input instanceof Request ? input : null;
            const method = String((init && init.method) || (asked && asked.method) || 'GET').toUpperCase();
            if (method === 'GET') window.__e2eFetchGet(new URL(asked ? asked.url : String(input), location.href).href).catch(() => {});
          } catch (e) { /* never in the page's way */ }
          return fetchAsIs.apply(this, arguments);
        };
      }`);
      context.on('weberror', (e) => {
        const message = e.error().message;
        const cancelled = baseURL !== undefined && (isCancelledRscPrefetch(message, baseURL) || isCancelledApiGet(message, baseURL, gets));
        if (!cancelled) problems.push(`uncaught: ${message}`);
      });
      // Chromium doesn't reliably log a CSP violation to the console, so listen for the event itself (RAD-72); Firefox
      // then reports one violation twice, which fails the test all the same. On the window, not the document: a popup
      // opened at about:blank keeps its window when it loads the real page, and the init script doesn't run again.
      await context.exposeBinding('__e2eCspViolation', (_source, v: string) => problems.push(`CSP violation: ${v}`));
      await context.addInitScript(`if (!window.__e2eCspWatched) {
        window.__e2eCspWatched = true;
        // A binding's promise is caught, so a page closing mid-call can't raise an unhandled rejection (auditor on #245).
        window.addEventListener('securitypolicyviolation', (e) => window.__e2eCspViolation(
          e.violatedDirective + ' blocked ' + (e.blockedURI || 'inline') + ' in ' + (e.sourceFile || 'the page')).catch(() => {}));
      }`);
      context.on('requestfailed', (r) => {
        const error = r.failure()?.errorText ?? '';
        // Aborted on purpose: Next cancels prefetches and superseded requests when the page navigates.
        if (!/ERR_ABORTED|NS_BINDING_ABORTED|cancelled/i.test(error)) problems.push(`request failed: ${r.method()} ${r.url()} (${error})`);
      });
      context.on('response', (r) => {
        if (r.status() >= 400 && !expected(r.status())) problems.push(`HTTP ${r.status()}: ${r.request().method()} ${r.url()}`);
      });
      await use(problems);
      expect(problems, 'console errors, CSP violations and failed requests').toEqual([]);
    },
    { auto: true },
  ],
  // RAD-95, RC-063: every journey ends with the books healthy. After the test, whatever it did, the books check must
  // find nothing; a problem fails the test, listed. It reads one snapshot, so another test half-done can't trip it.
  booksCheck: [
    async ({ baseURL }, use) => {
      await use();
      expect(describeBooksProblems(await readBooksProblems(baseURL!)), 'the books check (RAD-95) after this test').toEqual([]);
    },
    { auto: true },
  ],
});

/** The serious or critical WCAG 2.2 A/AA violations on the page as it is now, as `rule-id: help (n element(s))`. */
export async function seriousA11yIssues(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.help} (${v.nodes.length} element(s))`);
}

/** Fails on any serious or critical WCAG 2.2 A/AA violation on the page as it is now. */
export async function expectAccessible(page: Page): Promise<void> {
  expect(await seriousA11yIssues(page), 'serious accessibility issues').toEqual([]);
}
