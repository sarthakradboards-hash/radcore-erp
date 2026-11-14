// RAD-58: after sign-in the app goes back only to a page on this site (RC-097, safeNext). A crafted ?next= lands on the
// home page and the browser never asks another site for anything; a page of this site is honoured.
import { expect, test } from './fixtures.ts';
import { seedPerson } from './people.ts';
import { submitPassword } from './sign-in-steps.ts';

test.use({ expectedStatuses: [401] }); // the signed-out /me read
// Each real sign-in costs the api an Argon2 hash, and the whole suite runs in parallel: room for several.
test.describe.configure({ timeout: 90_000 });

const UNSAFE = ['https://evil.example/', '//evil.example/', '/\\evil.example/', '/%2e%2e//evil.example/', 'javascript:alert(1)'];

test('a ?next= to another site, or a script, is refused: sign-in lands on the home page', async ({ page, context }) => {
  const person = await seedPerson('sales');
  const elsewhere: string[] = [];
  // Requests to that host only: the sign-in page's own address carries it in ?next=.
  await context.route((url) => url.hostname === 'evil.example', (route) => { elsewhere.push(route.request().url()); return route.abort(); });
  for (const next of UNSAFE) {
    await context.clearCookies();
    await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
    await submitPassword(page, person.email);
    await expect(page.getByText(`Signed in as ${person.name}`), next).toBeVisible({ timeout: 15_000 });
    expect(new URL(page.url()).pathname, next).toBe('/');
    expect(new URL(page.url()).origin, next).toBe(new URL(test.info().project.use.baseURL!).origin);
  }
  expect(elsewhere).toEqual([]);
});

test('a ?next= to a page of this site is honoured', async ({ page }) => {
  const person = await seedPerson('sales');
  await page.goto(`/sign-in?next=${encodeURIComponent('/account/sessions')}`);
  await submitPassword(page, person.email);
  await expect(page).toHaveURL(/\/account\/sessions$/, { timeout: 15_000 });
  await expect(page.getByText(`Signed in as ${person.name}`)).toBeVisible();
});
