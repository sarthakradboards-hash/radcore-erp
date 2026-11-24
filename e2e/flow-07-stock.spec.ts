// Keeping stock right (RAD-146, M4, flow 7), in a real browser: stores moves goods from the stockroom to the showroom with a reason, and it
// posts at once; stores counts the stockroom and finds fewer than the books say, but the difference does not post until the owner, another
// person, approves it; the admin asks for an adjustment, is refused when trying to approve their own request, the owner rejects it with a reason, it is
// sent again and approved; and a transfer is undone by its mirror, unless the goods have moved on since. Stock is received through the real
// stock engine (e2e/seed-stock.ts), and after every step the quantity in each place is read both on the screen and from the API. Every test
// ends with the books check (RAD-95).
// Job work is its own journey: flow-07-job-work.spec.ts.
import { randomBytes, randomUUID } from 'node:crypto';
import { openFinancialYear } from '@radcore/lib-accounts';
import { indiaDate, percentString } from '@radcore/lib-common';
import { putGstRate } from '@radcore/lib-gst';
import type { Ctx, Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import { addCategory, addItem, addPlace } from '@radcore/lib-stock';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import pg from 'pg';
import { expect, expectAccessible, test } from './fixtures.ts';
import { seedCompany, stateFor } from './people.ts';
import { openYearFor, receiveStock } from './seed-stock.ts';

test.describe.configure({ mode: 'serial', timeout: 180_000 });

const APP_URL = process.env['E2E_DATABASE_URL'] ?? 'postgres://radcore_app@127.0.0.1:5432/radcore_e2e';
const today = () => indiaDate(new Date());
const enc = (o: unknown) => encodeURIComponent(JSON.stringify(o));
const u = randomBytes(3).toString('hex').toUpperCase();

// What the journey keeps: one item, 20 received into the stockroom at 500.00, and a showroom beside it.
const ITEM = { name: `Stock charger ${u}`, sku: `SC-${u}`, id: '' };
const PLACES = { stockroom: { name: `Stockroom ${u}`, id: '' }, showroom: { name: `Showroom ${u}`, id: '' } };

// Handed from one step to the next (the steps run in order, in one worker).
const run = { firstTransferUrl: '', countUrl: '', adjustmentUrl: '', transferDoneAt: 0 };

const accessible = async (page: Page) => { await page.evaluate(() => window.scrollTo(0, 0)); await expectAccessible(page); };
const fact = (page: Page, term: string) => page.locator('dl[aria-label]').filter({ has: page.locator('dt', { hasText: term }) }).locator('dt', { hasText: new RegExp(`^${term}$`) }).locator('xpath=following-sibling::dd[1]');
const dialog = (page: Page) => page.getByRole('dialog');
const btn = (page: Page, name: string | RegExp) => page.getByRole('button', { name });
const status = (page: Page, text: string | RegExp) => page.getByRole('status').filter({ hasText: text });
const bar = (page: Page) => page.getByRole('list', { name: 'Where it is' });
const lineSet = (page: Page, n: number) => page.getByRole('group', { name: new RegExp(`^Line ${n}\\b`) });
async function pick(page: Page, label: RegExp, text: string, within: Locator | Page = page) {
  const c = within.getByRole('combobox', { name: label });
  await c.click();
  await c.fill(text);
  await page.getByRole('option', { name: new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first().click();
}
/** One call to the API as the person `request` is signed in as. */
async function api<T>(request: APIRequestContext, path: string): Promise<T> {
  const res = await request.get(`/api${path}`);
  expect(res.status(), `get ${path}: ${await res.text()}`).toBe(200);
  return (await res.json()) as T;
}
/** What the books say is in a place, from the API. */
const onHand = async (request: APIRequestContext, place: { id: string }) =>
  Number((await api<{ position: string }>(request, `/stock/on-hand?input=${enc({ itemId: ITEM.id, locationId: place.id, limit: 5 })}`)).position);
/** What the on-hand screen shows for the item at a place. */
async function screenOnHand(page: Page, place: { name: string }, qty: string) {
  await page.goto('/stock/on-hand');
  await page.getByRole('combobox', { name: 'Place', exact: true }).selectOption({ label: place.name });
  const row = page.getByRole('row').filter({ hasText: ITEM.sku });
  await expect(row).toHaveCount(1, { timeout: 15_000 });
  await expect(row.getByRole('cell').nth(2)).toHaveText(`${qty} NOS`);
}

/** Writes and posts a transfer from the stockroom to the showroom of `qty` of the item, with a reason. */
async function transfer(page: Page, qty: string, reason: string, onHandNow: string) {
  await page.goto('/stock/transfers/new');
  await page.getByLabel('From', { exact: true }).selectOption({ label: PLACES.stockroom.name });
  await page.getByLabel('To', { exact: true }).selectOption({ label: PLACES.showroom.name });
  await page.getByLabel('Reason').fill(reason);
  await pick(page, /^Item/, ITEM.name, lineSet(page, 1));
  await lineSet(page, 1).getByLabel('Quantity', { exact: true }).fill(qty);
  await lineSet(page, 1).getByLabel(new RegExp(`^From batch B1 \\(on hand ${onHandNow}\\)`)).fill(qty);
  await accessible(page);
  await btn(page, 'Transfer it').click();
  await expect(page).toHaveURL(/\/stock\/transfers\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name: /^Transfer \S+/ })).toBeVisible();
}

test.beforeAll(async () => {
  await seedCompany();
  await openYearFor(today());
  const pool = new pg.Pool({ connectionString: APP_URL, max: 3 });
  try {
    const staff: Principal = { kind: 'user', userId: randomUUID(), ownScope: [], permissions: ['items:write', 'locations:write', 'gst:write', 'cost:read'] };
    await runInTransaction(createDatabase(pool), { readOnly: false, isolation: 'read committed' }, staff, randomUUID(), async (ctx: Ctx) => {
      await openFinancialYear(ctx, today());
      const { id: categoryId } = await addCategory(ctx, { name: `Stock cat ${u}` });
      const hsn = `8507${String(randomBytes(2).readUInt16BE() % 10000).padStart(4, '0')}`;
      await putGstRate(ctx, { hsn, effectiveFrom: '2025-04-01', rate: percentString().parse('18'), source: 'E2E', note: null, reason: 'E2E' });
      ITEM.id = (await addItem(ctx, { sku: ITEM.sku, name: ITEM.name, categoryId, hsn, unit: 'NOS', barcode: null, serialised: false, hasChassis: false, purchasePrice: null })).id;
      PLACES.stockroom.id = (await addPlace(ctx, { code: `SR${u}`, name: PLACES.stockroom.name, kind: 'stores' })).id;
      PLACES.showroom.id = (await addPlace(ctx, { code: `SH${u}`, name: PLACES.showroom.name, kind: 'store' })).id;
    });
  } finally { await pool.end(); }
  await receiveStock([{ itemId: ITEM.id, qty: '20', rate: '500.00' }], PLACES.stockroom.id, today());
});

test.describe('stores, moving goods', () => {
  test.use({ storageState: stateFor('stores') });

  test('moves 5 to the showroom with a reason: it posts at once and takes its number', async ({ page, request }) => {
    expect(await onHand(request, PLACES.stockroom), 'received into the stockroom').toBe(20);
    await transfer(page, '5', 'Display stock for the weekend', '20');
    run.firstTransferUrl = new URL(page.url()).pathname;
    await expect(status(page, /^Transferred as \S+/).first()).toBeAttached();
    await expect(bar(page).getByRole('listitem')).toHaveText(['Draft (done)', 'Posted (now)']);
    await expect(fact(page, 'From')).toHaveText(PLACES.stockroom.name);
    await expect(fact(page, 'To')).toHaveText(PLACES.showroom.name);
    await expect(fact(page, 'Reason')).toHaveText('Display stock for the weekend');
    const row = page.getByRole('row').filter({ hasText: ITEM.sku });
    await expect(row.getByRole('cell').nth(1)).toHaveText('5');
    await expect(row.getByRole('cell').nth(2)).toHaveText('B1 (5)');
    await accessible(page);
    expect(await onHand(request, PLACES.stockroom)).toBe(15);
    expect(await onHand(request, PLACES.showroom)).toBe(5);
    run.transferDoneAt = Date.now();
  });

  test('the on-hand screen shows 15 in the stockroom and 5 in the showroom', async ({ page }) => {
    await screenOnHand(page, PLACES.stockroom, '15');
    await accessible(page);
    await screenOnHand(page, PLACES.showroom, '5');
  });

  test('counts the stockroom and finds 12 against 15 in the books; sent for approval, it changes nothing', async ({ page, request }) => {
    // the count's book quantity is as at its minute, so it waits for the minute the transfer posted in to pass
    const wait = 60_000 - (Date.now() % 60_000) + 1500;
    if (Math.floor(Date.now() / 60_000) === Math.floor(run.transferDoneAt / 60_000)) await page.waitForTimeout(wait);
    await page.goto('/stock/counts/new');
    await page.getByLabel('Place', { exact: true }).selectOption({ label: PLACES.stockroom.name });
    await page.getByLabel('Reason').fill('Quarterly count of the stockroom');
    await pick(page, /^Item/, ITEM.name, lineSet(page, 1));
    await lineSet(page, 1).getByLabel('Batch', { exact: true }).selectOption({ label: 'B1' });
    await lineSet(page, 1).getByLabel('Found', { exact: true }).fill('12');
    await accessible(page);
    await btn(page, 'Save the count').click();
    await expect(page).toHaveURL(/\/stock\/counts\/[0-9a-f-]{36}$/);
    run.countUrl = new URL(page.url()).pathname;
    await expect(page.getByRole('heading', { level: 1, name: 'Draft count' })).toBeVisible();
    await expect(page.getByText('This draft hasn’t been sent for approval. Nothing changes in stock until someone else approves it.')).toBeVisible();
    const row = page.getByRole('row').filter({ hasText: ITEM.sku });
    await expect(row.getByRole('cell').nth(2)).toHaveText('12');
    await expect(row.getByRole('cell').nth(3)).toHaveText('15');
    await expect(row.getByRole('cell').nth(4)).toHaveText('-3');
    await accessible(page);
    await btn(page, 'Send for approval').click();
    await dialog(page).getByRole('button', { name: 'Send for approval' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(status(page, 'Sent for approval').first()).toBeAttached();
    await expect(page.getByText('This is waiting for someone else’s approval. Nothing has changed in stock yet; approving it posts it.')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Draft count' })).toBeVisible();
    expect(await onHand(request, PLACES.stockroom), 'nothing changes until it is approved').toBe(15);
    await screenOnHand(page, PLACES.stockroom, '15');
  });
});

test.describe('owner, approving the count', () => {
  test.use({ storageState: stateFor('owner') });

  test('the approvals screen lists the count; approving it posts the difference: 12 in the stockroom', async ({ page, request }) => {
    await page.goto('/stock/approvals');
    await expect(page.getByRole('heading', { level: 1, name: 'Stock approvals' })).toBeVisible();
    const counts = page.getByRole('region', { name: 'Counts' });
    // the list runs oldest first, and this journey's request is the newest (a failed earlier run may leave older ones)
    await counts.getByRole('button', { name: /^Review what .* asked$/ }).last().click();
    await expect(counts.getByRole('heading', { level: 3, name: /^Asked by / })).toBeVisible({ timeout: 15_000 });
    await accessible(page);
    await counts.getByRole('button', { name: 'Approve and post' }).click();
    await dialog(page).getByRole('button', { name: 'Approve and post' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(status(page, 'Approved and posted').first()).toBeAttached();
    expect(await onHand(request, PLACES.stockroom)).toBe(12);
    expect(await onHand(request, PLACES.showroom)).toBe(5);
    await page.goto(run.countUrl);
    await expect(page.getByRole('heading', { level: 1, name: /^Count \S+/ })).toBeVisible();
    await expect(bar(page).getByRole('listitem')).toHaveText(['Draft (done)', 'Posted (now)']);
    await accessible(page);
    await screenOnHand(page, PLACES.stockroom, '12');
  });
});

test.describe('admin, adjusting', () => {
  test.use({ storageState: stateFor('admin'), expectedStatuses: [403, 409, 422] });

  test('asks for 2 out of the showroom, cracked on display; deciding their own request is refused', async ({ page, request }) => {
    await page.goto('/stock/adjustments/new');
    await page.getByLabel('Place', { exact: true }).selectOption({ label: PLACES.showroom.name });
    await page.getByLabel('Reason').fill('Two cracked on display');
    await pick(page, /^Item/, ITEM.name, lineSet(page, 1));
    await lineSet(page, 1).getByLabel('Quantity', { exact: true }).fill('2');
    await lineSet(page, 1).getByLabel(/^From batch B1 \(on hand 5\)/).fill('2');
    await accessible(page);
    await btn(page, 'Save the adjustment').click();
    await expect(page).toHaveURL(/\/stock\/adjustments\/[0-9a-f-]{36}$/);
    run.adjustmentUrl = new URL(page.url()).pathname;
    await expect(page.getByRole('heading', { level: 1, name: 'Draft adjustment' })).toBeVisible();
    await btn(page, 'Send for approval').click();
    await dialog(page).getByRole('button', { name: 'Send for approval' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByText('This is waiting for someone else’s approval. Nothing has changed in stock yet; approving it posts it.')).toBeVisible();
    // the admin holds the approval key, but this is their own request
    await page.goto('/stock/approvals');
    const adjustments = page.getByRole('region', { name: 'Adjustments' });
    await adjustments.getByRole('button', { name: /^Review what .* asked$/ }).last().click();
    await expect(adjustments.getByRole('heading', { level: 3, name: /^Asked by / })).toBeVisible({ timeout: 15_000 });
    await adjustments.getByRole('button', { name: 'Approve and post' }).click();
    await dialog(page).getByRole('button', { name: 'Approve and post' }).click();
    await expect(dialog(page).getByRole('alert')).toContainText('You asked for this yourself, so someone else must decide it.');
    await accessible(page);
    await dialog(page).getByRole('button', { name: 'Keep it' }).click();
    expect(await onHand(request, PLACES.showroom), 'still 5').toBe(5);
  });
});

test.describe('owner, rejecting the adjustment', () => {
  test.use({ storageState: stateFor('owner') });

  test('rejects it with a reason: nothing changes, and the draft is back with its maker', async ({ page, request }) => {
    await page.goto('/stock/approvals');
    const adjustments = page.getByRole('region', { name: 'Adjustments' });
    await adjustments.getByRole('button', { name: /^Review what .* asked$/ }).last().click();
    await expect(adjustments.getByRole('heading', { level: 3, name: /^Asked by / })).toBeVisible({ timeout: 15_000 });
    await adjustments.getByRole('button', { name: 'Reject', exact: true }).click();
    await dialog(page).getByLabel('Reason').fill('Count the showroom again first');
    await accessible(page);
    await dialog(page).getByRole('button', { name: 'Reject', exact: true }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(status(page, 'Rejected').first()).toBeAttached();
    expect(await onHand(request, PLACES.showroom), 'still 5').toBe(5);
  });
});

test.describe('admin, asking again', () => {
  test.use({ storageState: stateFor('admin') });

  test('sends the same adjustment again', async ({ page }) => {
    await page.goto(run.adjustmentUrl);
    await expect(page.getByText('This draft hasn’t been sent for approval. Nothing changes in stock until someone else approves it.')).toBeVisible();
    await btn(page, 'Send for approval').click();
    await dialog(page).getByRole('button', { name: 'Send for approval' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByText('This is waiting for someone else’s approval. Nothing has changed in stock yet; approving it posts it.')).toBeVisible();
  });
});

test.describe('owner, approving the adjustment', () => {
  test.use({ storageState: stateFor('owner') });

  test('approving it posts the loss: 3 in the showroom', async ({ page, request }) => {
    await page.goto('/stock/approvals');
    const adjustments = page.getByRole('region', { name: 'Adjustments' });
    await adjustments.getByRole('button', { name: /^Review what .* asked$/ }).last().click();
    await expect(adjustments.getByRole('heading', { level: 3, name: /^Asked by / })).toBeVisible({ timeout: 15_000 });
    await adjustments.getByRole('button', { name: 'Approve and post' }).click();
    await dialog(page).getByRole('button', { name: 'Approve and post' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(status(page, 'Approved and posted').first()).toBeAttached();
    expect(await onHand(request, PLACES.showroom)).toBe(3);
    expect(await onHand(request, PLACES.stockroom)).toBe(12);
    await page.goto(run.adjustmentUrl);
    await expect(page.getByRole('heading', { level: 1, name: /^Adjustment \S+/ })).toBeVisible();
    await expect(bar(page).getByRole('listitem')).toHaveText(['Draft (done)', 'Posted (now)']);
    await accessible(page);
    await screenOnHand(page, PLACES.showroom, '3');
  });
});

test.describe('stores, undoing a transfer', () => {
  test.use({ storageState: stateFor('stores'), expectedStatuses: [403, 409, 422] });

  test('the first transfer cannot be undone: 2 of its 5 have gone from the showroom', async ({ page, request }) => {
    await page.goto(run.firstTransferUrl);
    await btn(page, 'Cancel it').click();
    await dialog(page).getByLabel('Reason').fill('Sent to the wrong place');
    await dialog(page).getByRole('button', { name: 'Cancel it' }).click();
    await expect(dialog(page).getByRole('alert')).toContainText('The goods have moved on since, so this can’t be undone.');
    await accessible(page);
    await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await onHand(request, PLACES.showroom)).toBe(3);
  });

  test('a second transfer of 1 is undone by its mirror: the stock goes back', async ({ page, request }) => {
    await transfer(page, '1', 'One more for the window', '12');
    expect(await onHand(request, PLACES.stockroom)).toBe(11);
    expect(await onHand(request, PLACES.showroom)).toBe(4);
    await btn(page, 'Cancel it').click();
    await dialog(page).getByLabel('Reason').fill('The window is full');
    await accessible(page);
    await dialog(page).getByRole('button', { name: 'Cancel it' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(status(page, 'Cancelled').first()).toBeAttached();
    await expect(bar(page).getByRole('listitem')).toHaveText(['Draft (done)', 'Posted (done)', 'Cancelled (now)']);
    expect(await onHand(request, PLACES.stockroom)).toBe(12);
    expect(await onHand(request, PLACES.showroom)).toBe(3);
    await accessible(page);
  });
});
