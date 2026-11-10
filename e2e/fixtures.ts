// What every journey imports instead of @playwright/test. Each test fails if the page logged a console error, threw,
// broke the Content Security Policy, or had a request fail or answer 4xx/5xx, so no journey has to remember to check.
// `expectAccessible` is the axe scan.
import AxeBuilder from '@axe-core/playwright';
import { expect, test as base, type Page } from '@playwright/test';

export { expect };

type Options = {
  /** Statuses this test expects to see, for example `test.use({ expectedStatuses: [401] })` in an auth journey. */
  expectedStatuses: number[];
};
type Fixtures = {
  /** What went wrong on the page so far. Checked when the test ends; the guard self-checks read it directly. */
  pageProblems: string[];
};

export const test = base.extend<Options & Fixtures>({
  expectedStatuses: [[], { option: true }],
  pageProblems: [
    async ({ context, expectedStatuses }, use) => {
      const problems: string[] = [];
      const expected = (status: number) => expectedStatuses.includes(status);
      // Watched on the whole browser context, so a popup or new tab a journey opens is checked like its first page.
      context.on('console', (m) => {
        // The browser logs every 4xx/5xx as a console error too; those are judged by status below.
        if (m.type() === 'error' && !m.text().startsWith('Failed to load resource:')) problems.push(`console error: ${m.text()}`);
      });
      context.on('weberror', (e) => problems.push(`uncaught: ${e.error().message}`));
      // Chromium doesn't reliably log a CSP violation to the console, so listen for the event itself (RAD-72); Firefox
      // then reports one violation twice, which fails the test all the same. On the window, not the document: a popup
      // opened at about:blank keeps its window when it loads the real page, and the init script doesn't run again.
      await context.exposeBinding('__e2eCspViolation', (_source, v: string) => problems.push(`CSP violation: ${v}`));
      await context.addInitScript(`if (!window.__e2eCspWatched) {
        window.__e2eCspWatched = true;
        window.addEventListener('securitypolicyviolation', (e) => window.__e2eCspViolation(
          e.violatedDirective + ' blocked ' + (e.blockedURI || 'inline') + ' in ' + (e.sourceFile || 'the page')));
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
