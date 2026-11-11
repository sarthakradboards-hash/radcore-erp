// The UI kit on /kit (RAD-53 forms and dialogs, RAD-54 tables and pickers), in Chromium, Firefox and WebKit (RAD-75).
// The e2e web server starts with KIT_PAGE=1, which kit-guard allows only in development and CI. /kit makes no request:
// its saves and its 2,100-party list are local fakes, answered after a short delay. Like every journey, each test fails
// on a console error, an uncaught error, a failed request or a CSP violation (fixtures.ts).
import type { Page } from '@playwright/test';
import { expect, expectAccessible, test } from './fixtures.ts';

// Under CI load a browser can hold the fake's 150 ms delay for seconds (RAD-74), so a fetch gets this long.
const LOAD = { timeout: 30_000 };

const form = (page: Page) => page.getByRole('form', { name: 'Edit party' });
const field = (page: Page, label: string) => form(page).getByLabel(label, { exact: true });
// By attribute: an empty alert has no size, and getByRole skips what it counts as hidden.
const alert = (page: Page) => form(page).locator('[role="alert"]');
const save = (page: Page) => form(page).getByRole('button', { name: 'Save party' });
const lastSent = (page: Page) => page.locator('output[aria-label="Last sent"]');
const announced = (page: Page, text: string) => page.getByRole('status').filter({ hasText: new RegExp(`^${text}$`) });
const menuButton = (page: Page) => page.getByRole('button', { name: 'Actions for INV-0042' });
const focusInside = (page: Page) => page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null);
const table = (page: Page) => page.getByRole('table', { name: 'Parties' });
const rows = (page: Page) => table(page).locator('tbody tr');
const shown = (page: Page) => page.locator('.kit-table-foot [role="status"]');
const more = (page: Page) => page.getByRole('button', { name: 'Show more' });
const th = (page: Page, name: string) => table(page).getByRole('columnheader', { name: new RegExp(`^${name.replace(/[()₹]/g, '.')}`) });
const fetchedLog = (page: Page) => page.locator('output[aria-label="Fetched"]');
const chosen = (page: Page) => page.locator('output[aria-label="Chosen"]');
const picker = (page: Page) => page.getByRole('combobox', { name: 'Party' });
const cellTexts = (page: Page, col: number) => rows(page).locator(`td:nth-child(${col})`).allTextContents();

/** Opens /kit once React has hydrated it (typing before that is lost), with the list's first page or the board. */
async function open(page: Page, first: 'list' | 'board' = 'list') {
  await page.goto('/kit');
  await page.waitForFunction(() => Object.keys(document.querySelector('form') ?? {}).some((k) => k.startsWith('__reactFiber')));
  if (first === 'list') await expect(shown(page)).toHaveText('50 shown', LOAD);
  else await expect(page.getByRole('list', { name: 'Parties board' }).getByRole('listitem')).toHaveCount(12, LOAD);
}

for (const scheme of ['light', 'dark'] as const) {
  test(`${scheme}: /kit passes axe, with the picker's list open`, async ({ page }) => {
    await open(page);
    await page.emulateMedia({ colorScheme: scheme }); // after loading: Firefox drops a scheme set before navigating
    expect(await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(scheme === 'dark');
    await picker(page).fill('Farida');
    await expect(page.getByRole('option').first()).toBeVisible(LOAD);
    await expectAccessible(page);
  });
}

test.describe('the form', () => {
  test('a refusal for a field on screen lands on that field, which takes focus and reads the error', async ({ page }) => {
    await open(page);
    await field(page, 'Name').fill('Taken');
    await save(page).click();
    const name = field(page, 'Name');
    await expect(name).toBeFocused();
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    await expect(name).toHaveAccessibleDescription('Another party has this name');
    await expect(alert(page)).toHaveText('Some of what was sent needs correcting');
    await expect(lastSent(page)).toHaveText('');
    await expectAccessible(page);
  });

  test('a refusal for a field not on screen goes to the form alert', async ({ page }) => {
    await open(page);
    await field(page, 'Name').fill('Elsewhere');
    await save(page).click();
    await expect(alert(page)).toHaveText('Some of what was sent needs correcting: The GSTIN is not valid');
    await expect(field(page, 'Name')).toHaveAttribute('aria-invalid', 'false');
  });

  test('a save already made is said in the form\'s own words', async ({ page }) => {
    await open(page);
    await field(page, 'Name').fill('Again');
    await save(page).click();
    await expect(alert(page)).toHaveText('This was already saved; check the list before saving again.');
  });

  test('a bad amount is refused in the browser: nothing is sent, and focus goes to it', async ({ page }) => {
    await open(page);
    const limit = field(page, 'Credit limit (₹)');
    await limit.fill('12.345');
    await save(page).click();
    await expect(limit).toHaveAttribute('aria-invalid', 'true');
    await expect(limit).toBeFocused();
    await expect(lastSent(page)).toHaveText('');
  });

  test('a valid save by keyboard is announced, clears the alert, and never sends the masked phone', async ({ page }) => {
    await open(page);
    await field(page, 'Name').fill('Taken');
    await save(page).click();
    await expect(alert(page)).not.toHaveText('');
    await field(page, 'Name').fill('Asha Traders & Sons');
    await field(page, 'Credit limit (₹)').fill('75000.50');
    await field(page, 'Note').fill('Prefers morning delivery');
    await field(page, 'Note').press('Tab');
    await page.keyboard.press('Enter'); // on Save party
    await expect(announced(page, 'Saved')).toHaveCount(1);
    await expect(alert(page)).toHaveText('');
    expect(JSON.parse((await lastSent(page).textContent()) ?? '{}')).toEqual(
      { name: 'Asha Traders & Sons', limit: '75000.50', note: 'Prefers morning delivery' });
    await expect(form(page).getByLabel('Phone')).toHaveValue('••••••3210');
    await expect(form(page).getByLabel('Phone')).toHaveJSProperty('readOnly', true);
  });
});

test.describe('the menu and dialogs', () => {
  test('menu: 44 px items, Archive disabled and skipped by the arrows, Escape returns focus; the page stays reachable', async ({ page }) => {
    await open(page);
    await menuButton(page).focus();
    await page.keyboard.press('Enter');
    const items = page.getByRole('menuitem');
    await expect(items).toHaveCount(3);
    for (const item of await items.all()) expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByRole('menuitem', { name: 'Archive' })).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByRole('menuitem', { name: 'Cancel invoice' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: 'Sign out (test)' })).toBeFocused();
    // Not modal (RAD-53): the page isn't aria-hidden or scroll-locked behind it, so axe passes with it open.
    expect(await page.evaluate(() => [document.querySelector('main')?.getAttribute('aria-hidden') ?? null,
      getComputedStyle(document.body).overflow])).toEqual([null, 'visible']);
    await expectAccessible(page);
    await page.keyboard.press('Escape');
    await expect(items).toHaveCount(0);
    await expect(menuButton(page)).toBeFocused();
  });

  test('reason dialog: focus inside, scroll locked with a nonced style, empty and "short" refused, a reason sent', async ({ page }) => {
    await open(page);
    await menuButton(page).click();
    await page.getByRole('menuitem', { name: 'Cancel invoice' }).click();
    const dialog = page.getByRole('dialog', { name: 'Cancel invoice INV-0042' });
    await expect(dialog).toBeVisible();
    await expect.poll(() => focusInside(page)).toBe(true);
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe('hidden');
    expect(await page.evaluate(() => [...document.querySelectorAll('style')].every((s) => s.nonce !== ''))).toBe(true);
    await expectAccessible(page);
    const reason = dialog.getByLabel('Reason');
    const confirm = dialog.getByRole('button', { name: 'Cancel invoice' });
    await confirm.click();
    await expect(dialog.getByText('Say why, in your own words')).toBeVisible();
    await expect(reason).toBeFocused();
    await reason.fill('short');
    await confirm.click();
    await expect(reason).toHaveAccessibleDescription(/Give at least 10 characters/);
    await expect(lastSent(page)).toHaveText('');
    await reason.fill('Customer returned the goods unopened');
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    await expect(announced(page, 'Invoice cancelled')).toHaveCount(1);
    await expect(menuButton(page)).toBeFocused();
    expect(JSON.parse((await lastSent(page).textContent()) ?? '{}')).toEqual({ id: 'INV-0042', reason: 'Customer returned the goods unopened' });
  });

  test('reason dialog: Escape, "Keep it" and × close it without sending, focus back on the menu button', async ({ page }) => {
    await open(page);
    for (const how of ['Escape', 'Keep it', 'Close']) {
      await menuButton(page).click();
      await page.getByRole('menuitem', { name: 'Cancel invoice' }).click();
      const dialog = page.getByRole('dialog', { name: 'Cancel invoice INV-0042' });
      await dialog.getByLabel('Reason').fill('Typed but not sent');
      if (how === 'Escape') await page.keyboard.press('Escape');
      else await dialog.getByRole('button', { name: how, exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(menuButton(page)).toBeFocused();
    }
    await expect(lastSent(page)).toHaveText('');
  });

  test('signed-out dialog: no ×, Escape and outside clicks do nothing, Tab stays inside, its button closes it', async ({ page }) => {
    await open(page);
    await menuButton(page).click();
    await page.getByRole('menuitem', { name: 'Sign out (test)' }).click();
    const dialog = page.getByRole('dialog', { name: 'You are signed out' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 5);
    await page.waitForTimeout(300);
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab');
      expect(await focusInside(page)).toBe(true);
    }
    await expectAccessible(page);
    await dialog.getByRole('button', { name: 'Sign in again' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(menuButton(page)).toBeFocused();
  });
});

test.describe('the table', () => {
  test('50 rows first; "Show more" adds 50 at a time to all 2,100 rows, none twice, then goes away', async ({ page }) => {
    test.setTimeout(300_000);
    await open(page);
    await expect(fetchedLog(page)).toHaveText('list');
    let clicks = 0;
    while (await more(page).isVisible()) {
      await more(page).click();
      clicks++;
      // The button goes away on the last page, so wait on the count, not the button.
      await expect(shown(page)).toHaveText(`${Math.min(50 * (clicks + 1), 2100)} shown`, LOAD);
    }
    expect(clicks).toBe(41);
    await expect(rows(page)).toHaveCount(2100);
    expect(new Set(await cellTexts(page, 1)).size).toBe(2100);
  });

  test('sort: ascending then descending, rows in that order, aria-sort on that th only, back to the first 50', async ({ page }) => {
    await open(page);
    await expect(th(page, 'Name')).toHaveAttribute('aria-sort', 'ascending');
    for (const [name, col, numeric] of [['City', 2, false], ['Credit limit (₹)', 3, true]] as const) {
      await more(page).click();
      await expect(shown(page)).toHaveText('100 shown', LOAD);
      const key = (s: string) => (numeric ? Number(s) : s);
      const sorted = (cells: string[], dir: 1 | -1) =>
        [...cells].sort((a, b) => dir * (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
      await th(page, name).getByRole('button').click();
      await expect(th(page, name)).toHaveAttribute('aria-sort', 'ascending');
      await expect(table(page).locator('th[aria-sort]')).toHaveCount(1);
      await expect(shown(page)).toHaveText('50 shown', LOAD);
      const up = await cellTexts(page, col);
      expect(up).toEqual(sorted(up, 1));
      await th(page, name).getByRole('button').press('Enter'); // by keyboard
      await expect(th(page, name)).toHaveAttribute('aria-sort', 'descending');
      await expect(shown(page)).toHaveText('50 shown', LOAD);
      const down = await cellTexts(page, col);
      expect(down).toEqual(sorted(down, -1));
    }
    await expectAccessible(page);
  });

  test('at 320 px the page never scrolls sideways; a too-wide table scrolls in its own region, by keyboard too', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await open(page);
    const region = page.getByRole('region', { name: 'Parties' });
    const pageOverflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await pageOverflow()).toBeLessThanOrEqual(0);
    // Three short columns fit 320 px, so make one row too wide, as a long name would be.
    await region.evaluate((el) => { const td = el.querySelector<HTMLElement>('tbody td'); if (td) { td.textContent = 'W'.repeat(80); td.style.whiteSpace = 'nowrap'; } });
    expect(await region.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    expect(await pageOverflow()).toBeLessThanOrEqual(0);
    await region.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => region.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  });
});

test.describe('the saved view (RC-218)', () => {
  test('Board survives a reload: the server draws it first, and only the board is fetched', async ({ page, context, baseURL }) => {
    await open(page);
    await page.getByRole('button', { name: 'Board' }).click();
    expect((await context.cookies()).find((c) => c.name === 'view-kit')?.value).toBe('board');
    const html = await (await page.request.get(`${baseURL}/kit`)).text();
    expect(html).toContain('aria-label="Parties board"');
    expect(html).not.toContain('<caption');
    await page.reload();
    await page.waitForFunction(() => Object.keys(document.querySelector('form') ?? {}).some((k) => k.startsWith('__reactFiber')));
    await expect(page.getByRole('list', { name: 'Parties board' }).getByRole('listitem')).toHaveCount(12, LOAD);
    await page.waitForTimeout(500); // past one more fake request, so a stray list fetch would show
    await expect(fetchedLog(page)).toHaveText('board');
    await expect(table(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'List' }).click();
    await expect(shown(page)).toHaveText('50 shown', LOAD);
  });

  test('a saved value that isn\'t a view draws the list', async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'view-kit', value: '<script>x</script>', url: baseURL! }]);
    await open(page);
    await expect(page.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('the picker', () => {
  test('typing finds party 2,050 of 2,100, announced at once; arrows never choose; Enter does and closes the list', async ({ page }) => {
    await open(page);
    const input = picker(page);
    await input.fill('2050');
    const only = page.getByRole('option');
    await expect(only).toHaveCount(1, LOAD);
    await expect(only).toHaveText(/^Gopal Traders 2050\s*Pune$/);
    await expect(input).toHaveAttribute('aria-expanded', 'true');
    await expect(input).toHaveAttribute('aria-activedescendant', (await only.getAttribute('id'))!);
    for (const key of ['ArrowDown', 'ArrowUp']) {
      await page.keyboard.press(key);
      await expect(chosen(page)).toHaveText('');
    }
    await page.keyboard.press('Enter');
    await expect(chosen(page)).toHaveText('Gopal Traders 2050');
    await expect(input).toHaveAttribute('aria-expanded', 'false');
    await expect(input).not.toHaveAttribute('aria-activedescendant');
  });

  test('with several options the active descendant follows the highlight; a click chooses; Escape closes without choosing', async ({ page }) => {
    await open(page);
    const input = picker(page);
    await input.fill('Asha Traders 21');
    await expect(page.getByRole('option')).toHaveCount(8, LOAD);
    for (const key of ['ArrowDown', 'ArrowDown', 'ArrowUp']) {
      await page.keyboard.press(key);
      const selected = await page.locator('[cmdk-item][data-selected="true"]').getAttribute('id');
      await expect(input).toHaveAttribute('aria-activedescendant', selected!);
    }
    await expect(chosen(page)).toHaveText('');
    await page.keyboard.press('Escape');
    await expect(input).toHaveAttribute('aria-expanded', 'false');
    await expect(chosen(page)).toHaveText('');
    await input.fill('Devi Traders 1004');
    await page.getByRole('option', { name: /Devi Traders 1004/ }).click();
    await expect(chosen(page)).toHaveText('Devi Traders 1004');
    await input.fill('zzzz');
    await expect(page.getByText('Nothing matches “zzzz”')).toBeVisible(LOAD);
  });
});
