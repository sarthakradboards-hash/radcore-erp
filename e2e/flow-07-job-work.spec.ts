// Keeping stock right, part 2 (RAD-146, M4, flow 7): job work, in a real browser. stores sends 10 of an input from the stockroom to a job worker on
// a challan (it posts at once and the goods are at the job worker's own place); the job worker returns 4 made, with 8 of the input used, 1 sent
// back unused and 1 lost, and stores records that on a receipt against the challan, which closes it and prices the made goods at the inputs used
// plus the job worker's charge; stores then cancels the receipt, and the goods are out with the job worker again. Stock is received through the real
// stock engine (e2e/seed-stock.ts), and every step reads the quantity in each place from the API as well as the screen. Every test ends with the
// books check (RAD-95).
import { randomBytes, randomUUID } from 'node:crypto';
import { addParty, openFinancialYear } from '@radcore/lib-accounts';
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

// What the journey sends out and gets back: 20 sheets in the stockroom, 10 of them sent for job work, and the panels made from them.
const INPUT = { name: `Cut sheet ${u}`, sku: `CS-${u}`, id: '' };
const MADE = { name: `Finished panel ${u}`, sku: `FP-${u}`, id: '' };
const WORKER = { name: `Fabricator ${u} Works`, id: '' };
const PLACES = { stockroom: { name: `JW stockroom ${u}`, id: '' }, jobWork: { name: `Out at the works ${u}`, id: '' } };

// Handed from one step to the next (the steps run in order, in one worker).
const run = { challanUrl: '', challanNumber: '', receiptUrl: '' };

const accessible = async (page: Page) => { await page.evaluate(() => window.scrollTo(0, 0)); await expectAccessible(page); };
const fact = (page: Page, term: string) => page.locator('dl[aria-label]').filter({ has: page.locator('dt', { hasText: term }) }).locator('dt', { hasText: new RegExp(`^${term}$`) }).locator('xpath=following-sibling::dd[1]');
const dialog = (page: Page) => page.getByRole('dialog');
const btn = (page: Page, name: string | RegExp) => page.getByRole('button', { name });
const status = (page: Page, text: string | RegExp) => page.getByRole('status').filter({ hasText: text });
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
/** What the books say is in a place of an item, from the API. */
const onHand = async (request: APIRequestContext, item: { id: string }, place: { id: string }) =>
  Number((await api<{ position: string }>(request, `/stock/on-hand?input=${enc({ itemId: item.id, locationId: place.id, limit: 5 })}`)).position);

test.beforeAll(async () => {
  await seedCompany();
  await openYearFor(today());
  const pool = new pg.Pool({ connectionString: APP_URL, max: 3 });
  try {
    const staff: Principal = { kind: 'user', userId: randomUUID(), ownScope: [],
      permissions: ['parties:write', 'parties:manage', 'parties:contact', 'items:write', 'locations:write', 'gst:write', 'cost:read'] };
    await runInTransaction(createDatabase(pool), { readOnly: false, isolation: 'read committed' }, staff, randomUUID(), async (ctx: Ctx) => {
      await openFinancialYear(ctx, today());
      WORKER.id = (await addParty(ctx, { name: WORKER.name, kinds: ['supplier'], gstin: null, pan: null, composition: false, stateCode: '27',
        phone: '9876501234', email: `jw.${u.toLowerCase()}@example.test`, addressLine1: '9 Works Lane', addressLine2: 'Bhosari', city: 'Pune', pincode: '411026' })).id;
      const { id: categoryId } = await addCategory(ctx, { name: `JW cat ${u}` });
      const hsn = `7308${String(randomBytes(2).readUInt16BE() % 10000).padStart(4, '0')}`;
      await putGstRate(ctx, { hsn, effectiveFrom: '2025-04-01', rate: percentString().parse('18'), source: 'E2E', note: null, reason: 'E2E' });
      for (const i of [INPUT, MADE]) {
        i.id = (await addItem(ctx, { sku: i.sku, name: i.name, categoryId, hsn, unit: 'NOS', barcode: null, serialised: false, hasChassis: false, purchasePrice: null })).id;
      }
      PLACES.stockroom.id = (await addPlace(ctx, { code: `JS${u}`, name: PLACES.stockroom.name, kind: 'stores' })).id;
      PLACES.jobWork.id = (await addPlace(ctx, { code: `JW${u}`, name: PLACES.jobWork.name, kind: 'job_work', partyId: WORKER.id })).id;
    });
  } finally { await pool.end(); }
  await receiveStock([{ itemId: INPUT.id, qty: '20', rate: '100.00' }], PLACES.stockroom.id, today());
});

test.describe('stores, sending goods out', () => {
  test.use({ storageState: stateFor('stores') });

  test('sends 10 sheets to the job worker on a challan: it posts at once and the goods are at their place', async ({ page, request }) => {
    expect(await onHand(request, INPUT, PLACES.stockroom), 'received into the stockroom').toBe(20);
    await page.goto('/stock/job-work/new');
    await page.getByLabel('Sent from', { exact: true }).selectOption({ label: PLACES.stockroom.name });
    await pick(page, /^Job worker/, WORKER.name);
    await page.getByLabel('Notes').fill('Cut and bend to the drawing');
    await pick(page, /^Item/, INPUT.name, lineSet(page, 1));
    await lineSet(page, 1).getByLabel('Quantity', { exact: true }).fill('10');
    await lineSet(page, 1).getByLabel(/^From batch B1 \(on hand 20\)/).fill('10');
    await accessible(page);
    await btn(page, 'Send and number it').click();
    await expect(page).toHaveURL(/\/stock\/job-work\/[0-9a-f-]{36}$/);
    run.challanUrl = new URL(page.url()).pathname;
    await expect(page.getByRole('heading', { level: 1, name: /^Job work challan \S+/ })).toBeVisible();
    run.challanNumber = (await page.getByRole('heading', { level: 1 }).innerText()).replace('Job work challan ', '').trim();
    await expect(status(page, /^Challan \S+ sent/).first()).toBeAttached();
    await expect(fact(page, 'Sent from')).toHaveText(PLACES.stockroom.name);
    await expect(fact(page, 'Job worker')).toHaveText(WORKER.name);
    await expect(fact(page, 'Notes')).toHaveText('Cut and bend to the drawing');
    await expect(fact(page, 'Status')).toHaveText(/^Out for \d+ days$/);
    const row = page.getByRole('row').filter({ hasText: INPUT.sku });
    await expect(row.getByRole('cell').nth(1)).toHaveText('10');
    await expect(row.getByRole('cell').nth(2)).toHaveText('B1 (10)');
    await expect(row.getByRole('cell').nth(7)).toHaveText('10');
    await accessible(page);
    expect(await onHand(request, INPUT, PLACES.stockroom)).toBe(10);
    expect(await onHand(request, INPUT, PLACES.jobWork)).toBe(10);
  });

  test('the challan is listed as still out', async ({ page }) => {
    await page.goto('/stock/job-work');
    await expect(page.getByRole('heading', { level: 1, name: 'Job work challans' })).toBeVisible();
    await expect(page.getByRole('link', { name: run.challanNumber })).toBeVisible({ timeout: 15_000 });
    await accessible(page);
  });
});

test.describe('stores, receiving the work back', () => {
  test.use({ storageState: stateFor('stores') });

  test('records 4 panels made, 8 sheets used, 1 sent back and 1 lost: the challan closes and the panels are priced', async ({ page, request }) => {
    await page.goto(run.challanUrl);
    await page.getByRole('link', { name: 'Receive against it' }).click();
    await expect(page.getByRole('heading', { level: 1, name: new RegExp(`^Receipt against ${run.challanNumber}, `) })).toBeVisible();
    await page.getByLabel('Comes into', { exact: true }).selectOption({ label: PLACES.stockroom.name });
    const line = page.getByRole('group', { name: new RegExp(`^${INPUT.name} \\(${INPUT.sku}\\): 10 still out`) });
    const made = line.getByRole('group', { name: 'Made', exact: true });
    await pick(page, /^Item made/, MADE.name, made);
    await made.getByLabel('How many made').fill('4');
    await made.getByLabel('Charge for each').fill('150.00');
    const part = (name: string) => line.getByRole('group', { name, exact: true }).getByLabel(/^From batch B1 \(10 sent\)/);
    await part('Used').fill('8');
    await part('Sent back unused').fill('1');
    await part('Lost').fill('1');
    await accessible(page);
    await btn(page, 'Receive and number it').click();
    await expect(page).toHaveURL(/\/stock\/job-work\/receipts\/[0-9a-f-]{36}$/);
    run.receiptUrl = new URL(page.url()).pathname;
    await expect(page.getByRole('heading', { level: 1, name: /^Job work receipt \S+/ })).toBeVisible();
    await expect(status(page, /^Receipt \S+ posted/).first()).toBeAttached();
    await expect(fact(page, 'Challan')).toHaveText(run.challanNumber);
    await expect(fact(page, 'Job worker')).toHaveText(WORKER.name);
    await expect(fact(page, 'Comes into')).toHaveText(PLACES.stockroom.name);
    // 4 made at 150.00 each
    await expect(fact(page, 'Job worker’s charges')).toHaveText('₹600.00');
    const row = page.getByRole('row').filter({ hasText: INPUT.sku });
    await expect(row.getByRole('cell').nth(1)).toHaveText(`${MADE.name} (${MADE.sku}) 4`);
    await expect(row.getByRole('cell').nth(2)).toHaveText('₹600.00');
    // the 4 panels cost the 8 sheets used (8 x 100.00) and the charge (600.00); the 1 sheet lost is written off at 100.00
    await expect(row.getByRole('cell').nth(3)).toHaveText('₹1,400.00');
    await expect(row.getByRole('cell').nth(7)).toHaveText('₹100.00');
    await expect(row.getByRole('cell').nth(4)).toHaveText('8, B1 (8)');
    await expect(row.getByRole('cell').nth(5)).toHaveText('1, B1 (1)');
    await expect(row.getByRole('cell').nth(6)).toHaveText('1, B1 (1)');
    await accessible(page);
    // the sheets: 10 left in the stockroom and 1 back; none at the job worker; the panels are in the stockroom
    expect(await onHand(request, INPUT, PLACES.stockroom)).toBe(11);
    expect(await onHand(request, INPUT, PLACES.jobWork)).toBe(0);
    expect(await onHand(request, MADE, PLACES.stockroom)).toBe(4);
  });

  test('the challan now shows what became of the 10: 8 used, 1 back, 1 lost, nothing still out', async ({ page }) => {
    await page.goto(run.challanUrl);
    await expect(fact(page, 'Status')).toHaveText('All accounted for');
    const row = page.getByRole('row').filter({ hasText: INPUT.sku });
    await expect(row.getByRole('cell').nth(1)).toHaveText('10');
    await expect(row.getByRole('cell').nth(4)).toHaveText('8');
    await expect(row.getByRole('cell').nth(5)).toHaveText('1');
    await expect(row.getByRole('cell').nth(6)).toHaveText('1');
    await expect(row.getByRole('cell').nth(7)).toHaveText('0');
    await expect(page.getByRole('link', { name: /^JWR\// })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Receive against it' })).toHaveCount(0);
    await accessible(page);
  });
});

test.describe('stores, undoing the receipt', () => {
  test.use({ storageState: stateFor('stores') });

  test('cancelling the receipt with a reason puts the goods back at the job worker', async ({ page, request }) => {
    await page.goto(run.receiptUrl);
    await btn(page, 'Cancel it').click();
    await dialog(page).getByLabel('Reason').fill('Counted wrong at the gate');
    await accessible(page);
    await dialog(page).getByRole('button', { name: 'Cancel it' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(status(page, 'Cancelled').first()).toBeAttached();
    await expect(fact(page, 'Why it was cancelled')).toHaveText('Counted wrong at the gate');
    expect(await onHand(request, INPUT, PLACES.stockroom)).toBe(10);
    expect(await onHand(request, INPUT, PLACES.jobWork)).toBe(10);
    expect(await onHand(request, MADE, PLACES.stockroom)).toBe(0);
    await page.goto(run.challanUrl);
    await expect(fact(page, 'Status')).toHaveText(/^Out for \d+ days$/);
    await accessible(page);
  });
});
