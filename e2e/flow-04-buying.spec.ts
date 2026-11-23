// The buying journey (RAD-145, M4), in a real browser: stores drafts a purchase order, and placing it asks for approval (the placing limit starts
// at 0, so every order does); an admin, a different person, approves it from the approvals screen, which places it; stores records the arrival
// against it, and QC splits it into accepted and rejected, which posts the receipt and moves the goods: the accepted into the sellable place,
// the rejects into the rejects place. One person per step, each signed in as their built-in role, and every test ends with the books check (RAD-95).
// Not here yet, added as the screens land: the supplier's bill and its match to the receipt (RAD-143's bill screens), and the supplier return
// (RAD-140's debit note).
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

test.describe.configure({ mode: 'serial', timeout: 180_000 });

const APP_URL = process.env['E2E_DATABASE_URL'] ?? 'postgres://radcore_app@127.0.0.1:5432/radcore_e2e';
const today = () => indiaDate(new Date());
const enc = (o: unknown) => encodeURIComponent(JSON.stringify(o));
const u = randomBytes(3).toString('hex').toUpperCase();

// What the journey buys: two items from a supplier in the company's own state (Maharashtra, 27, so CGST and SGST), received into a store, with
// a place of the rejects kind beside it.
const SUPPLIER = { name: `Supplier ${u} Traders`, id: '' };
const ITEMS = [
  { name: `Buy charger ${u}`, sku: `BC-${u}`, qty: 10, rate: '500.00', id: '' },
  { name: `Buy battery ${u}`, sku: `BB-${u}`, qty: 4, rate: '1000.00', id: '' },
];
const PLACES = { store: { name: `Buy store ${u}`, id: '' }, rejects: { name: `Buy rejects ${u}`, id: '' } };

// Handed from one step to the next (the steps run in order, in one worker).
const run = { poUrl: '', poNumber: '', receiptUrl: '', receiptNumber: '' };

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
/** Chooses an option of a select by its label, paging with "Show more" until it is listed (lists page by id, not newest first). */
async function pickByLabel(page: Page, chooser: Locator, label: string) {
  const option = chooser.locator('option', { hasText: label });
  const deadline = Date.now() + 90_000;
  while ((await option.count()) === 0) {
    if (Date.now() > deadline) throw new Error(`"${label}" is on no page of the chooser`);
    const more = page.getByRole('button', { name: 'Show more' });
    if (await more.isVisible()) await more.click(); else await page.waitForTimeout(300);
  }
  await chooser.selectOption({ label: (await option.first().innerText()).trim() });
}
/** One call to the API as the person `request` is signed in as. */
async function api<T>(request: APIRequestContext, path: string): Promise<T> {
  const res = await request.get(`/api${path}`);
  expect(res.status(), `get ${path}: ${await res.text()}`).toBe(200);
  return (await res.json()) as T;
}

test.beforeAll(async () => {
  await seedCompany();
  const pool = new pg.Pool({ connectionString: APP_URL, max: 3 });
  try {
    const staff: Principal = { kind: 'user', userId: randomUUID(), ownScope: [],
      permissions: ['parties:write', 'parties:manage', 'parties:contact', 'items:write', 'locations:write', 'gst:write', 'cost:read'] };
    await runInTransaction(createDatabase(pool), { readOnly: false, isolation: 'read committed' }, staff, randomUUID(), async (ctx: Ctx) => {
      await openFinancialYear(ctx, today());
      const { id } = await addParty(ctx, { name: SUPPLIER.name, kinds: ['supplier'], gstin: null, pan: null, composition: false, stateCode: '27',
        phone: '9876501234', email: `buy.${u.toLowerCase()}@example.test`, addressLine1: '3 Mill Road', addressLine2: 'Camp', city: 'Pune', pincode: '411001' });
      SUPPLIER.id = id;
      const { id: categoryId } = await addCategory(ctx, { name: `Buy cat ${u}` });
      const hsn = `8507${String(randomBytes(2).readUInt16BE() % 10000).padStart(4, '0')}`;
      await putGstRate(ctx, { hsn, effectiveFrom: '2025-04-01', rate: percentString().parse('18'), source: 'E2E', note: null, reason: 'E2E' });
      for (const i of ITEMS) {
        i.id = (await addItem(ctx, { sku: i.sku, name: i.name, categoryId, hsn, unit: 'NOS', barcode: null, serialised: false, hasChassis: false, purchasePrice: null })).id;
      }
      PLACES.store.id = (await addPlace(ctx, { code: `BS${u}`, name: PLACES.store.name, kind: 'store' })).id;
      PLACES.rejects.id = (await addPlace(ctx, { code: `BR${u}`, name: PLACES.rejects.name, kind: 'rejected' })).id;
    });
  } finally { await pool.end(); }
});

test.describe('stores, ordering', () => {
  test.use({ storageState: stateFor('stores') });

  test('drafts a purchase order for the supplier, and placing it asks for approval: the limit starts at 0', async ({ page }) => {
    await page.goto('/purchases/orders/new');
    await pick(page, /^Supplier/, SUPPLIER.name);
    for (const [n, item] of ITEMS.entries()) {
      if (n > 0) await btn(page, 'Add a line').click();
      await pick(page, /^Item/, item.name, lineSet(page, n + 1));
      await lineSet(page, n + 1).getByLabel('Quantity').fill(String(item.qty));
      await lineSet(page, n + 1).getByLabel(/^Rate/).fill(item.rate);
    }
    await accessible(page);
    await btn(page, 'Save the draft').click();
    await expect(page).toHaveURL(/\/purchases\/orders\/[0-9a-f-]{36}$/);
    run.poUrl = new URL(page.url()).pathname;
    await expect(page.getByRole('heading', { level: 1, name: 'Draft purchase order' })).toBeVisible();
    await expect(bar(page).getByRole('listitem')).toHaveText(['Draft (now)', 'Placed', 'Closed']);
    await expect(fact(page, 'Supplier')).toHaveText(SUPPLIER.name);
    await btn(page, 'Place it').click();
    await dialog(page).getByRole('button', { name: 'Place it' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(status(page, 'Above your limit, so it’s waiting for approval').first()).toBeAttached();
    await expect(page.getByText('This purchase order is above its placer’s limit and waits for someone else’s approval.')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Draft purchase order' })).toBeVisible();
    await accessible(page);
  });
});

test.describe('admin, approving', () => {
  test.use({ storageState: stateFor('admin') });

  test('the approvals screen lists the request with the supplier and the total with GST; approving it places the order', async ({ page }) => {
    await page.goto('/purchases/approvals');
    await expect(page.getByRole('heading', { level: 1, name: 'Purchase order approvals' })).toBeVisible();
    // the list runs oldest first, and this journey's request is the newest (a failed earlier run may leave older ones)
    await page.getByRole('button', { name: /^Review the purchase order .* asked about/ }).last().click();
    await expect(page.getByText(SUPPLIER.name).first()).toBeVisible({ timeout: 15_000 });
    // 10 x 500.00 + 4 x 1,000.00 = 9,000.00 taxable, 18% GST: 10,620.00
    await expect(page.getByText('₹10,620.00').first()).toBeVisible();
    await accessible(page);
    await btn(page, 'Approve and place').first().click();
    await dialog(page).getByRole('button', { name: 'Approve and place' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(status(page, 'Approved and placed').first()).toBeAttached();
  });
});

test.describe('stores, looking at the order', () => {
  test.use({ storageState: stateFor('stores') });

  test('the order is placed now: it draws its number and carries CGST and SGST', async ({ page }) => {
    await page.goto(run.poUrl);
    await expect(page.getByRole('heading', { level: 1, name: /^Purchase order \S+/ })).toBeVisible();
    run.poNumber = (await page.getByRole('heading', { level: 1 }).innerText()).replace('Purchase order ', '').trim();
    await expect(bar(page).getByRole('listitem')).toHaveText(['Draft (done)', 'Placed (now)', 'Closed']);
    await expect(fact(page, 'Supplier')).toHaveText(SUPPLIER.name);
    await expect(fact(page, 'Taxable value')).toHaveText('₹9,000.00');
    await expect(fact(page, 'CGST')).toHaveText('₹810.00');
    await expect(fact(page, 'SGST')).toHaveText('₹810.00');
    await expect(fact(page, 'IGST')).toHaveText('₹0.00');
    await expect(fact(page, 'Total').last()).toHaveText('₹10,620.00');
    await accessible(page);
  });
});

test.describe('stores, receiving', () => {
  test.use({ storageState: stateFor('stores') });

  test('records the arrival against the order: its lines come in with what is left to come, into the store and the rejects place', async ({ page }) => {
    await page.goto('/purchases/receipts/new');
    await pickByLabel(page, page.getByLabel('Purchase order'), `${run.poNumber} (${SUPPLIER.name})`);
    await btn(page, 'Bring in its lines').click();
    await expect(page.getByText(`Against purchase order ${run.poNumber} from ${SUPPLIER.name}.`)).toBeVisible();
    await page.getByLabel('Accepted goods go to').selectOption({ label: PLACES.store.name });
    await page.getByLabel('Rejected goods go to').selectOption({ label: PLACES.rejects.name });
    await page.getByLabel(/^Supplier’s challan/).fill(`DC-${u}`);
    for (const [n, item] of ITEMS.entries()) await expect(lineSet(page, n + 1).getByLabel('Received')).toHaveValue(String(item.qty));
    await accessible(page);
    await btn(page, 'Save the arrival').click();
    await expect(page).toHaveURL(/\/purchases\/receipts\/[0-9a-f-]{36}$/);
    run.receiptUrl = new URL(page.url()).pathname;
    await expect(page.getByRole('heading', { level: 1, name: 'Goods receipt waiting for QC' })).toBeVisible();
    await expect(fact(page, 'Supplier')).toHaveText(SUPPLIER.name);
    await expect(fact(page, 'Accepted goods go to')).toHaveText(PLACES.store.name);
    await expect(fact(page, 'Rejected goods go to')).toHaveText(PLACES.rejects.name);
    await accessible(page);
  });

  test('QC splits the first line, 8 accepted and 2 rejected with a reason, takes the second whole, and posts the receipt: nothing is in stock before that', async ({ page, request }) => {
    const onHand = async (itemId: string, locationId: string) =>
      (await api<{ position: string }>(request, `/stock/on-hand?input=${enc({ itemId, locationId, limit: 5 })}`)).position;
    expect(Number(await onHand(ITEMS[0]!.id, PLACES.store.id)), 'nothing in stock before QC').toBe(0);
    await page.goto(run.receiptUrl);
    await page.getByRole('link', { name: 'Do QC and post' }).click();
    await expect(page).toHaveURL(/\/qc$/);
    const l1 = page.getByRole('group', { name: /^Line 1: / });
    await l1.getByLabel('Accepted', { exact: true }).fill('8');
    await l1.getByLabel('Rejected', { exact: true }).fill('2');
    await l1.getByLabel('Why anything was rejected').fill('Cracked cases');
    await accessible(page);
    await btn(page, 'Post the receipt').click();
    await expect(page).toHaveURL(new RegExp(`${run.receiptUrl}$`));
    await expect(page.getByRole('heading', { level: 1, name: /^Goods receipt \S+/ })).toBeVisible();
    run.receiptNumber = (await page.getByRole('heading', { level: 1 }).innerText()).replace('Goods receipt ', '').trim();
    await expect(bar(page).getByRole('listitem')).toHaveText(['Waiting for QC (done)', 'Posted (now)']);
    await expect(fact(page, 'Value at the order’s rates')).toBeVisible();
    await accessible(page);
    // the goods moved: the accepted into the store, the rejects into the rejects place
    expect(Number(await onHand(ITEMS[0]!.id, PLACES.store.id))).toBe(8);
    expect(Number(await onHand(ITEMS[0]!.id, PLACES.rejects.id))).toBe(2);
    expect(Number(await onHand(ITEMS[1]!.id, PLACES.store.id))).toBe(4);
  });

  test('the order shows what came: everything on it has arrived, so its last receipt closes it', async ({ page }) => {
    await page.goto(run.poUrl);
    await expect(bar(page).getByRole('listitem')).toHaveText(['Draft (done)', 'Placed (done)', 'Closed (now)']);
    await accessible(page);
  });
});
