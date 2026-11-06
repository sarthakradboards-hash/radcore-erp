// What every journey imports instead of @playwright/test. Each test fails if the page logged a console error, threw,
// or had a request fail or answer 4xx/5xx, so no journey has to remember to check. `expectAccessible` is the axe scan.
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
    async ({ page, expectedStatuses }, use) => {
      const problems: string[] = [];
      const expected = (status: number) => expectedStatuses.includes(status);
      page.on('console', (m) => {
        // The browser logs every 4xx/5xx as a console error too; those are judged by status below.
        if (m.type() === 'error' && !m.text().startsWith('Failed to load resource:')) problems.push(`console error: ${m.text()}`);
      });
      page.on('pageerror', (e) => problems.push(`uncaught: ${e.message}`));
      page.on('requestfailed', (r) => {
        const error = r.failure()?.errorText ?? '';
        // Aborted on purpose: Next cancels prefetches and superseded requests when the page navigates.
        if (!/ERR_ABORTED|NS_BINDING_ABORTED|cancelled/i.test(error)) problems.push(`request failed: ${r.method()} ${r.url()} (${error})`);
      });
      page.on('response', (r) => {
        if (r.status() >= 400 && !expected(r.status())) problems.push(`HTTP ${r.status()}: ${r.request().method()} ${r.url()}`);
      });
      await use(problems);
      expect(problems, 'console errors and failed requests').toEqual([]);
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
