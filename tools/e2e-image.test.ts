// RAD-78: the e2e job runs in Playwright's own image, so no apt runs at job time. The image's browsers are the
// ones its Playwright version drives, so its tag must be the lockfile's Playwright: bumping one without the other
// fails here, before CI tries to launch a browser the image doesn't have.
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/e2e.yml', 'utf8');
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as { packages: Record<string, { version?: string }> };

it("runs the e2e job in Playwright's image at the lockfile's Playwright version, pinned by digest", () => {
  const playwright = Object.entries(lock.packages)
    .filter(([key]) => /(^|\/)node_modules\/(@playwright\/test|playwright|playwright-core)$/.test(key))
    .map(([key, entry]) => `${key}@${entry.version}`);
  const versions = new Set(playwright.map((p) => p.slice(p.lastIndexOf('@') + 1)));
  expect(playwright.length, 'the lockfile has @playwright/test, playwright and playwright-core').toBeGreaterThanOrEqual(3);
  expect([...versions], `one Playwright version in the lockfile: ${playwright.join(', ')}`).toHaveLength(1);
  const [version] = versions;

  const images = [...workflow.matchAll(/^\s*image:\s*mcr\.microsoft\.com\/playwright:(\S+)\s*$/gm)].map((m) => m[1]);
  expect(images).toHaveLength(1);
  expect(images[0]).toMatch(new RegExp(`^v${version!.replaceAll('.', '\\.')}-noble@sha256:[0-9a-f]{64}$`));
});

it('installs no browsers or OS packages at job time', () => {
  const runs = workflow.split('\n').filter((l) => /^\s*(-\s+)?run:/.test(l));
  expect(runs.length).toBeGreaterThan(0);
  expect(runs.filter((l) => /playwright install|\bapt(-get)?\b/.test(l))).toEqual([]);
});
