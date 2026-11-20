// RAD-50 / #261 (auditor-3's SHOULD): the main menu as a signed-in person sees it. At phone width it is one Menu button
// (the row of links is display: none, so it isn't in the accessibility tree); wider, it is the row and no button. Either
// way only the entries this person may use are listed, and the page they are on is marked. The role seeded here holds
// session:read (the shell needs it) and journal:read, so its person sees Home and Accounts, no Admin.
import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { apiSignIn, seedPerson, seedRole, type Person } from './people.ts';

const ROLE = 'menu_journal_reader';
let person: Person;

test.beforeAll(async () => {
  await seedRole(ROLE, 'E2E menu, journal reader', ['session:read', 'journal:read']);
  person = await seedPerson(ROLE, { name: `E2E Menu ${randomUUID().slice(0, 6)}` });
});

const menu = (page: Page) => page.getByRole('navigation', { name: 'Main menu' });
async function open(page: Page, baseURL: string, width: number) {
  const api = await apiSignIn(baseURL, person.email);
  await page.context().addCookies((await api.storageState()).cookies);
  await api.dispose();
  await page.setViewportSize({ width, height: 800 });
  await page.goto('/accounts/journal');
  await page.waitForFunction(() => Object.keys(document.querySelector('main') ?? {}).some((k) => k.startsWith('__reactFiber')));
}

test('at 320 px the menu is one Menu button listing only the entries this person may use, the current one marked', async ({ page, baseURL }) => {
  await open(page, baseURL!, 320);
  await expect(menu(page).getByRole('link')).toHaveCount(0);
  await menu(page).getByRole('button', { name: 'Menu' }).click();
  const items = page.getByRole('menuitem');
  await expect(items).toHaveText(['Home', 'Accounts']);
  await expect(items.filter({ hasText: 'Accounts' })).toHaveAttribute('aria-current', 'page');
  await expect(items.filter({ hasText: 'Home' })).not.toHaveAttribute('aria-current', 'page');
  // No sideways scroll: every entry is reached from the button, none from a scroller.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test('at 1280 px the menu is the row of links, and there is no Menu button', async ({ page, baseURL }) => {
  await open(page, baseURL!, 1280);
  await expect(menu(page).getByRole('button', { name: 'Menu' })).toHaveCount(0);
  await expect(menu(page).getByRole('link')).toHaveText(['Home', 'Accounts']);
  await expect(menu(page).getByRole('link', { name: 'Accounts' })).toHaveAttribute('aria-current', 'page');
});
