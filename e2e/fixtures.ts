// What every journey imports instead of @playwright/test. Each test fails if the page logged a console error, threw,
// or had a request fail or answer 4xx/5xx, so no journey has to remember to check. `expectAccessible` is the axe scan.
import AxeBuilder from '@axe-core/playwright';
import { expect, test as base, type Page } from '@playwright/test';

export { expect };

export const test = base.extend<{ pageProblems: string[] }>({
  pageProblems: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on('console', (m) => { if (m.type() === 'error') problems.push(`console error: ${m.text()}`); });
      page.on('pageerror', (e) => problems.push(`uncaught: ${e.message}`));
      page.on('requestfailed', (r) => problems.push(`request failed: ${r.method()} ${r.url()} (${r.failure()?.errorText})`));
      page.on('response', (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.request().method()} ${r.url()}`); });
      await use(problems);
      expect(problems, 'console errors and failed requests').toEqual([]);
    },
    { auto: true },
  ],
});

/** Fails on any serious or critical WCAG 2.2 A/AA violation on the page as it is now. */
export async function expectAccessible(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length} element(s))`), 'serious accessibility issues').toEqual([]);
}
