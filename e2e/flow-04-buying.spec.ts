// The buying journey (RAD-145, M4), in a real browser: stores drafts a purchase order, and placing it asks for approval (the placing limit starts
// at 0, so every order does); an admin, a different person, approves it from the approvals screen, which places it; stores records the arrival
// against it, and QC splits it into accepted and rejected, which posts the receipt and moves the goods: the accepted into the sellable place,
// the rejects into the rejects place. One person per step, each signed in as their built-in role, and every test ends with the books check (RAD-95).
// Then the supplier's bills: the match view, one posted at once within the tolerance, one past it approved by someone else. Last, the rejects go
// back to the supplier: the supplier billed them too, so the return is settled on a debit note applied to that bill. Then accounts pays the supplier what is
// left on the bills, through Record a payment, and applies it to the first two bills; last, the return is cancelled, which puts the debit note's bill back to owing.
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

// The supplier's bills. The draft is made through the API (the bill form, ui's #404, is in review) with a supplier's bill file that is
// already "ready" (a fixture row, as the repo's own bill tests make it: the upload and its check are the files specs' own), then the
// journey goes through the screens: the match view, posting within the tolerance, and a bill past it waiting for someone else's approval.
const bills = { first: '', second: '', third: '', firstNumber: '', thirdNumber: '' };

/** A POST as the person `request` is signed in as. */
async function post<T>(request: APIRequestContext, path: string, data: unknown): Promise<T> {
  const origin = `http://127.0.0.1:${process.env['E2E_WEB_PORT'] ?? 3100}`;
  const res = await request.post(`/api${path}`, { data, headers: { 'idempotency-key': randomUUID(), origin } });
  expect(res.status(), `post ${path}: ${await res.text()}`).toBe(200);
  return (await res.json()) as T;
}
/** A purchase bill's file, ready (the supplier's own paper), made as the owner of the database. */
async function readyBillFile(): Promise<string> {
  const id = randomUUID();
  const su = new pg.Client({ connectionString: process.env['E2E_SEED_DATABASE_URL'] ?? 'postgres://radcore@127.0.0.1:5432/radcore_e2e' });
  await su.connect();
  try {
    await su.query('begin');
    await su.query("set local app.principal = 'system:e2e-seed'");
    await su.query(`insert into radcore.files (id, kind, store_key, filename, content_type, size, status)
      values ($1, 'purchase_bill', $2, 'bill.pdf', 'application/pdf', 2048, 'ready')`, [id, `purchase_bill/${id}`]);
    await su.query('commit');
  } finally { await su.end(); }
  return id;
}

test.describe('accounts, billing', () => {
  test.use({ storageState: stateFor('accounts') });

  test('drafts a bill for each receipt line, the first at the order’s rate and the second well above it (through the API)', async ({ request }) => {
    const receiptId = run.receiptUrl.split('/').pop()!;
    const receipt = await api<{ supplierId: string; lines: { id: string; orderLineId: string; name: string }[] }>(request, `/purchasing/receipts/${receiptId}`);
    expect(receipt.lines).toHaveLength(2);
    const draft = async (line: { id: string; orderLineId: string }, qty: string, rate: string, total: string, n: number) =>
      (await post<{ id: string }>(request, '/purchasing/bills', {
        supplierId: receipt.supplierId, businessDate: today(), supplierInvoiceNumber: `INV-${u}-${n}`, supplierInvoiceDate: today(), supplierGstin: null,
        statedTotal: total, fileId: await readyBillFile(), notes: null,
        lines: [{ kind: 'goods', poLineId: line.orderLineId, receiptLineId: line.id, qty, rate }] })).id;
    // 8 chargers accepted at 500.00 = 4,000.00, GST 18%: 4,720.00. 4 batteries at 1,500.00 (the order says 1,000.00) = 6,000.00, GST: 7,080.00.
    bills.first = `/purchases/bills/${await draft(receipt.lines[0]!, '8', '500.00', '4720.00', 1)}`;
    bills.second = `/purchases/bills/${await draft(receipt.lines[1]!, '4', '1500.00', '7080.00', 2)}`;
    // the supplier billed the 2 rejected chargers as well, at 500.00 = 1,000.00, GST 18%: 1,180.00 (it is the rejects' return that this bill makes debitable)
    bills.third = `/purchases/bills/${await draft(receipt.lines[0]!, '2', '500.00', '1180.00', 3)}`;
  });

  test('the first bill’s page shows the three-way match, within tolerance; Post it posts it at once and it draws its number', async ({ page }) => {
    await page.goto(bills.first);
    await expect(page.getByRole('heading', { level: 1, name: `Draft bill for invoice INV-${u}-1` })).toBeVisible();
    await expect(bar(page).getByRole('listitem')).toHaveText(['Draft (now)', 'Posted']);
    await expect(fact(page, 'Supplier')).toHaveText(SUPPLIER.name);
    await expect(fact(page, 'Supplier’s bill')).toHaveText('Attached');
    const match = page.getByRole('region', { name: 'Goods against their purchase orders and receipts' }).getByRole('row').nth(1);
    await expect(match).toContainText(ITEMS[0]!.name);
    await expect(match).toContainText(run.poNumber);
    await expect(match).toContainText('Received');
    await expect(match).toContainText('Within tolerance');
    await expect(page.getByText('₹4,720.00').first()).toBeVisible(); // the supplier's total, and the one worked out
    await accessible(page);
    await btn(page, 'Post it').click();
    await dialog(page).getByRole('button', { name: 'Post it' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: /^Purchase bill \S+/ })).toBeVisible();
    bills.firstNumber = (await page.getByRole('heading', { level: 1 }).innerText()).replace('Purchase bill ', '').trim();
    await expect(bar(page).getByRole('listitem')).toHaveText(['Draft (done)', 'Posted (now)']);
    await expect(fact(page, 'CGST')).toHaveText('₹360.00');
    await expect(fact(page, 'SGST')).toHaveText('₹360.00');
    await expect(fact(page, 'Total').last()).toHaveText('₹4,720.00');
    await accessible(page);
  });

  test('the second bill is past the tolerance: the match says so, and Post it asks for approval instead of posting', async ({ page }) => {
    await page.goto(bills.second);
    const match = page.getByRole('region', { name: 'Goods against their purchase orders and receipts' }).getByRole('row').nth(1);
    await expect(match).toContainText(ITEMS[1]!.name);
    await expect(match).toContainText('Past tolerance');
    await expect(match).toContainText('50%');
    await btn(page, 'Post it').click();
    await dialog(page).getByRole('button', { name: 'Post it' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(status(page, 'Above your limit, so it’s waiting for approval').first()).toBeAttached();
    await expect(page.getByText('This bill is waiting for someone else’s approval')).toBeVisible();
    await expect(btn(page, 'Post it')).toHaveCount(0);
    await accessible(page);
  });
});

test.describe('admin, approving the bill', () => {
  test.use({ storageState: stateFor('admin') });

  test('the approvals screen names the line past the tolerance and the totals; approving posts the bill', async ({ page }) => {
    await page.goto('/purchases/bills/approvals');
    await expect(page.getByRole('heading', { level: 1, name: 'Purchase bill approvals' })).toBeVisible();
    await page.getByRole('button', { name: /^Review the purchase order .* asked about/ }).last().click(); // the newest request: this bill's
    await expect(page.getByText(`INV-${u}-2`).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(`${ITEMS[1]!.name} on ${run.poNumber}: 50% above its PO rate`)).toBeVisible();
    await expect(page.getByText('₹7,080.00').first()).toBeVisible();
    await accessible(page);
    await btn(page, 'Approve and post').first().click();
    await dialog(page).getByRole('button', { name: 'Approve and post' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(status(page, 'Approved and posted').first()).toBeAttached();
  });
});

test.describe('accounts, after billing', () => {
  test.use({ storageState: stateFor('accounts') });

  test('the second bill is posted and the Purchase bills list shows both, newest first', async ({ page }) => {
    await page.goto(bills.second);
    await expect(page.getByRole('heading', { level: 1, name: /^Purchase bill \S+/ })).toBeVisible();
    await expect(bar(page).getByRole('listitem')).toHaveText(['Draft (done)', 'Posted (now)']);
    await expect(fact(page, 'Total').last()).toHaveText('₹7,080.00');
    await page.goto('/purchases/bills');
    await expect(page.getByRole('heading', { level: 1, name: 'Purchase bills' })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: `INV-${u}-1` })).toContainText(bills.firstNumber);
    await expect(page.getByRole('row').filter({ hasText: `INV-${u}-2` })).toBeVisible();
    await accessible(page);
  });

  test('the third bill, for the 2 rejects, is within tolerance and posts at once', async ({ page }) => {
    await page.goto(bills.third);
    await expect(page.getByRole('heading', { level: 1, name: `Draft bill for invoice INV-${u}-3` })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Goods against their purchase orders and receipts' }).getByRole('row').nth(1)).toContainText('Within tolerance');
    await btn(page, 'Post it').click();
    await dialog(page).getByRole('button', { name: 'Post it' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: /^Purchase bill \S+/ })).toBeVisible();
    bills.thirdNumber = (await page.getByRole('heading', { level: 1 }).innerText()).replace('Purchase bill ', '').trim();
    await expect(fact(page, 'Total').last()).toHaveText('₹1,180.00');
    await accessible(page);
  });
});

// The rejects go back. They are in the rejects place, and the supplier has billed them (the third bill), so the return is settled on a debit note
// for what was billed, applied to that bill, and what leaves the rejects place is the 2 chargers.
const back = { url: '', number: '', debitNumber: '' };

test.describe('stores, sending the rejects back', () => {
  test.use({ storageState: stateFor('stores') });

  test('drafts a return of the 2 cracked chargers from the receipt: the screen shows them as billed, and the debit note before it is numbered', async ({ page, request }) => {
    const onHand = async (itemId: string, locationId: string) =>
      Number((await api<{ position: string }>(request, `/stock/on-hand?input=${enc({ itemId, locationId, limit: 5 })}`)).position);
    expect(await onHand(ITEMS[0]!.id, PLACES.rejects.id), 'the rejects are in the rejects place').toBe(2);
    await page.goto('/purchases/returns/new');
    await pick(page, /^Supplier/, SUPPLIER.name);
    await page.getByLabel('Rejects place', { exact: true }).selectOption({ label: PLACES.rejects.name });
    await page.getByLabel('Why they go back').fill('Cracked cases');
    const receiptOption = page.getByLabel('Add rejects from a goods receipt').locator('option', { hasText: run.receiptNumber });
    await expect(receiptOption).toHaveCount(1, { timeout: 15_000 });
    await page.getByLabel('Add rejects from a goods receipt').selectOption({ label: (await receiptOption.innerText()).trim() });
    await expect(page.getByText(`${ITEMS[0]!.name} (${ITEMS[0]!.sku}): 2 rejected`)).toBeVisible();
    await btn(page, 'Send these back').click();
    await expect(page.getByRole('group', { name: /^Line 1: / })).toBeVisible();
    await accessible(page);
    await btn(page, 'Save the draft').click();
    await expect(page).toHaveURL(/\/purchases\/returns\/[0-9a-f-]{36}$/);
    back.url = new URL(page.url()).pathname;
    await expect(page.getByRole('heading', { level: 1, name: 'Draft supplier return' })).toBeVisible();
    await expect(fact(page, 'Supplier')).toHaveText(SUPPLIER.name);
    await expect(fact(page, 'Rejects place')).toHaveText(PLACES.rejects.name);
    await expect(fact(page, 'Why they go back')).toHaveText('Cracked cases');
    // all 2 were billed (the third bill), at its rate: 2 x 500.00 = 1,000.00 + GST 90.00 + 90.00; nothing is back against goods not yet billed
    const row = page.getByRole('row').filter({ hasText: ITEMS[0]!.sku });
    await expect(row).toContainText(run.receiptNumber);
    await expect(row).toContainText(bills.thirdNumber);
    await expect(row).toContainText('₹1,000.00');
    await expect(fact(page, 'Back against goods not yet billed')).toHaveText('₹0.00');
    const note = page.locator('dl[aria-label="Debit note"]');
    await expect(note.locator('dt', { hasText: /^Number$/ }).locator('xpath=following-sibling::dd[1]')).toHaveText('Numbered when the return posts');
    await expect(note.locator('dt', { hasText: /^CGST$/ }).locator('xpath=following-sibling::dd[1]')).toHaveText('₹90.00');
    await expect(note.locator('dt', { hasText: /^SGST$/ }).locator('xpath=following-sibling::dd[1]')).toHaveText('₹90.00');
    await expect(note.locator('dt', { hasText: /^Total$/ }).locator('xpath=following-sibling::dd[1]')).toHaveText('₹1,180.00');
    await accessible(page);
    expect(await onHand(ITEMS[0]!.id, PLACES.rejects.id), 'a draft moves nothing').toBe(2);
  });

  test('posting it takes the 2 out of the rejects place, numbers the return and its debit note, and applies the note to the bill', async ({ page, request }) => {
    await page.goto(back.url);
    await btn(page, 'Post it').click();
    await dialog(page).getByRole('button', { name: 'Post it' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(status(page, /^Return \S+ posted, with debit note \S+/).first()).toBeAttached();
    await expect(page.getByRole('heading', { level: 1, name: /^Supplier return \S+/ })).toBeVisible();
    back.number = (await page.getByRole('heading', { level: 1 }).innerText()).replace('Supplier return ', '').trim();
    await expect(bar(page).getByRole('listitem')).toHaveText(['Draft (done)', 'Posted (now)']);
    const note = page.locator('dl[aria-label="Debit note"]');
    back.debitNumber = (await note.locator('dt', { hasText: /^Number$/ }).locator('xpath=following-sibling::dd[1]').innerText()).trim();
    expect(back.debitNumber).not.toBe('Numbered when the return posts');
    await expect(page.getByText(new RegExp(`^${bills.thirdNumber}: ₹1,180\\.00, on `))).toBeVisible();
    await accessible(page);
    const rejects = Number((await api<{ position: string }>(request, `/stock/on-hand?input=${enc({ itemId: ITEMS[0]!.id, locationId: PLACES.rejects.id, limit: 5 })}`)).position);
    expect(rejects, 'the cracked chargers have left').toBe(0);
  });

  test('the returns list shows the posted return', async ({ page }) => {
    await page.goto('/purchases/returns');
    await expect(page.getByRole('heading', { level: 1, name: 'Supplier returns' })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: back.number })).toBeVisible({ timeout: 15_000 });
    await accessible(page);
  });
});

// The payment. What the supplier is owed after the debit note: the first bill 4,720.00 and the second 7,080.00 (the third, 1,180.00, is cleared by the
// debit note's 1,180.00), 11,800.00 in all. It is recorded through the Record a payment screen (a payment to a supplier). Applying it to the bills is
// API-only: no screen offers it, as the apply form is a receipt's, over a customer's open bills.
const paid = { number: '', url: '' };

test.describe('accounts, paying the supplier', () => {
  test.use({ storageState: stateFor('accounts') });

  test('records a payment of 11,800.00 to the supplier from the bank, through the screen', async ({ page }) => {
    await page.goto('/accounts/payments/new');
    await expect(page.getByRole('heading', { level: 1, name: 'Record a payment' })).toBeVisible();
    await page.getByLabel('A payment: money paid to a supplier').check();
    await pick(page, /^Supplier/, SUPPLIER.name);
    await page.getByLabel('Amount', { exact: true }).fill('11800');
    const bank = (await page.getByLabel('Money account').locator('option').allTextContents()).find((o) => /bank/i.test(o))!;
    await page.getByLabel('Money account').selectOption({ label: bank });
    await page.getByLabel(/^Reference/).fill(`UTR-${u}-PAY`);
    await accessible(page);
    await btn(page, 'Record it').click();
    await expect(page.getByRole('heading', { level: 2, name: /^Payment \S+/ })).toBeVisible();
    paid.number = (await page.getByRole('heading', { level: 2 }).first().innerText()).replace('Payment ', '').trim();
    await expect(page.locator('#main').getByText(`Payment ${paid.number} recorded.`)).toBeVisible();
    await expect(page.locator('#main').getByText('₹11,800.00')).toBeVisible();
    await accessible(page);
  });

  test('applies it to the first two bills (through the API): 4,720.00 and 7,080.00, nothing left', async ({ page, request }) => {
    await page.goto('/accounts/payments');
    await page.getByRole('link', { name: paid.number }).click();
    await expect(page).toHaveURL(/\/accounts\/payments\/[0-9a-f-]{36}$/);
    paid.url = new URL(page.url()).pathname;
    await expect(page.getByRole('heading', { level: 1, name: `Payment ${paid.number}` })).toBeVisible();
    await expect(page.getByText('It is not applied to any bill.')).toBeVisible();
    const billId = (url: string) => url.split('/').pop()!;
    await post(request, `/payments/${paid.url.split('/').pop()}/allocations`, { businessDate: today(), lines: [
      { documentTable: 'purchase_bills', documentId: billId(bills.first), amount: '4720.00' },
      { documentTable: 'purchase_bills', documentId: billId(bills.second), amount: '7080.00' },
    ] });
    await page.reload();
    await expect(fact(page, 'Party')).toHaveText(SUPPLIER.name);
    const cell = (label: string) => page.locator('dl[aria-label="In numbers"]').locator('div').filter({ has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) }).locator('dd');
    await expect(cell('Amount')).toHaveText('₹11,800.00');
    await expect(cell('Applied to bills')).toHaveText('₹11,800.00');
    await expect(cell('Left')).toHaveText('₹0.00');
    await expect(page.getByRole('row').filter({ hasText: '₹4,720.00' })).toHaveCount(1);
    await expect(page.getByRole('row').filter({ hasText: '₹7,080.00' })).toHaveCount(1);
    await accessible(page);
  });
});

test.describe('stores, taking the return back', () => {
  test.use({ storageState: stateFor('stores') });

  test('cancelling the return with a reason puts the 2 back in the rejects place and reverses the debit note', async ({ page, request }) => {
    await page.goto(back.url);
    await btn(page, 'Cancel it').click();
    await dialog(page).getByLabel('Reason').fill('Supplier will collect them instead');
    await accessible(page);
    await dialog(page).getByRole('button', { name: 'Cancel it' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(status(page, 'Return cancelled').first()).toBeAttached();
    await expect(bar(page).getByRole('listitem')).toHaveText(['Draft (done)', 'Posted (done)', 'Cancelled (now)']);
    await expect(page.getByText(new RegExp(`^${bills.thirdNumber}: ₹1,180\\.00, on .*, reversed$`))).toBeVisible();
    const rejects = Number((await api<{ position: string }>(request, `/stock/on-hand?input=${enc({ itemId: ITEMS[0]!.id, locationId: PLACES.rejects.id, limit: 5 })}`)).position);
    expect(rejects, 'the rejects are back').toBe(2);
    await accessible(page);
  });
});
