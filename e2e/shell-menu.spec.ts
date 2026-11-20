// RAD-50 / #261 (auditor-3's SHOULD): the main menu as a signed-in person sees it. At phone width it is one Menu button
// (the row of links is display: none, so it isn't in the accessibility tree); wider, it is the row and no button. Either
// way only the entries this person may use are listed, and the page they are on is marked. The books-check role holds
// journal:read alone, so it sees Home and Accounts, no Admin.
import { expect, test } from './fixtures.ts';
import { BOOKS_ROLE, stateFor } from './people.ts';

test.use({ storageState: stateFor(BOOKS_ROLE) });

const menu = (page: import('@playwright/test').Page) => page.getByRole('navigation', { name: 'Main menu' });
async function open(page: import('@playwright/test').Page, width: number) {
  await page.setViewportSize({ width, height: 800 });
  await page.goto('/accounts/journal');
  await page.waitForFunction(() => Object.keys(document.querySelector('main') ?? {}).some((k) => k.startsWith('__reactFiber')));
}

test('at 320 px the menu is one Menu button listing only the entries this person may use, the current one marked', async ({ page }) => {
  await open(page, 320);
  await expect(menu(page).getByRole('link')).toHaveCount(0);
  await menu(page).getByRole('button', { name: 'Menu' }).click();
  const items = page.getByRole('menuitem');
  await expect(items).toHaveText(['Home', 'Accounts']);
  await expect(items.filter({ hasText: 'Accounts' })).toHaveAttribute('aria-current', 'page');
  await expect(items.filter({ hasText: 'Home' })).not.toHaveAttribute('aria-current', 'page');
  // No sideways scroll: every entry is reached from the button, none from a scroller.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test('at 1280 px the menu is the row of links, and there is no Menu button', async ({ page }) => {
  await open(page, 1280);
  await expect(menu(page).getByRole('button', { name: 'Menu' })).toHaveCount(0);
  await expect(menu(page).getByRole('link')).toHaveText(['Home', 'Accounts']);
  await expect(menu(page).getByRole('link', { name: 'Accounts' })).toHaveAttribute('aria-current', 'page');
});
