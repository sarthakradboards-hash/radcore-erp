// Flow 3 of the application plan, a dealer order (RAD-131, M3-32), in a real browser: sales quotes a dealer at the dealer price list,
// confirming the order stops at the dealer's credit limit and is let through by an override, stores delivers in parts, and each delivery
// is invoiced with IGST (the dealer is in another state). One person per step, each signed in as their built-in role, and every test
// ends with the books check (RAD-95).
// The dealer then pays through the Record a payment screen (RAD-126) and the receipts are applied over both invoices; the books check ends every test.
// The overrides are decided through the route the approvals screen will call (RAD-125, #299), until that screen is on dev.
import { randomUUID } from 'node:crypto';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { indiaDate } from '@radcore/lib-common';
import { expect, expectAccessible, test } from './fixtures.ts';
import { stateFor } from './people.ts';
import { openYearFor, receiveStock } from './seed-stock.ts';

test.describe.configure({ mode: 'serial', timeout: 180_000 });
// The credit stop is a 422 the journey expects, and the checks that need an override answer it again until someone decides.
test.use({ expectedStatuses: [422] });

const today = () => indiaDate(new Date());
const enc = (o: unknown) => encodeURIComponent(JSON.stringify(o));
const u = randomUUID().slice(0, 6).toUpperCase();

// The sales forms offer parties of kind customer only, so the dealer is both (a party holds several kinds).
// What the journey sells: two items at the dealer's prices, in a store of their own, to a dealer in Karnataka (the company is in
// Maharashtra, state 27), so the invoices carry IGST. The dealer's credit limit is below the order's value.
const DEALER = { name: `Dealer ${u} Traders`, state: '29' };
const ITEMS = [
  { name: `Dealer charger ${u}`, sku: `DC-${u}`, qty: 10, rate: '4000.00' },
  { name: `Dealer battery ${u}`, sku: `DB-${u}`, qty: 4, rate: '2500.00' },
].map((i) => ({ ...i, id: '', batchId: '' }));
const CREDIT_LIMIT = '50000.00';

// Handed from one step to the next (the steps run in order, in one worker).
const run = { dealerId: '', placeName: '', quoteNumber: '', orderUrl: '', orderNumber: '', deliveries: [] as string[], secondDelivery: '', invoices: [] as string[], invoiceNumbers: [] as string[] };

/** The repo's axe scan, from the top of the page: the sticky header overlaps what is scrolled under it, which axe's target-size reads as overlapping targets. */
const accessible = async (page: Page) => { await page.evaluate(() => window.scrollTo(0, 0)); await expectAccessible(page); };
const fact = (page: Page, term: string) => page.locator('dl[aria-label]').filter({ has: page.locator('dt', { hasText: term }) }).locator('dt', { hasText: new RegExp(`^${term}$`) }).locator('xpath=following-sibling::dd[1]');
/** The cells of one body row of a record's lines table. */
const cells = (page: Page, row: number) => page.getByRole('table', { name: /^Lines/ }).getByRole('row').nth(row).getByRole('cell');
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
async function api<T>(request: APIRequestContext, method: 'get' | 'post' | 'put', path: string, data?: unknown): Promise<T> {
  const origin = `http://127.0.0.1:${process.env['E2E_WEB_PORT'] ?? 3100}`;
  const res = method === 'get' ? await request.get(`/api${path}`) : await request[method](`/api${path}`, { data, headers: { 'idempotency-key': randomUUID(), origin } });
  expect(res.status(), `${method} ${path}: ${await res.text()}`).toBe(200);
  return (await res.json()) as T;
}

/** The person `request` is signed in as decides the pending override request of `kind` for a record: approved. The approvals screen
 * (RAD-125, #299) is not on dev yet; until it is, the decision goes through the route that screen will call. */
async function decide(request: APIRequestContext, kind: string, recordId: string) {
  const pending = await api<{ items: { id: string; recordId: string }[] }>(request, 'get', `/approvals/${kind}?input=${enc({ filter: {}, limit: 100 })}`);
  const mine = pending.items.find((p) => p.recordId === recordId);
  expect(mine, `the ${kind} request is in the queue`).toBeDefined();
  const one = await api<{ versionHash: string }>(request, 'get', `/approvals/${kind}/${mine!.id}?input=${enc({ id: mine!.id })}`);
  await api(request, 'post', `/approvals/${kind}/${mine!.id}/decision`, { id: mine!.id, decision: 'approve', versionHash: one.versionHash });
}

test.beforeAll(async ({ browser, baseURL }) => {
  const admin = await browser.newContext({ storageState: stateFor('admin'), baseURL: baseURL! });
  try {
    const r = admin.request;
    await openYearFor(today());
    await api(r, 'put', '/gst/rates', { hsn: '8708', effectiveFrom: '2020-01-01', rate: '28', source: 'E2E notification', note: null, reason: 'E2E: GST rate' });
    const { categories } = await api<{ categories: { id: string }[] }>(r, 'get', `/item-categories?input=${enc({})}`);
    const categoryId = categories[0]?.id ?? (await api<{ id: string }>(r, 'post', '/item-categories', { name: `Dealer goods ${u}` })).id;
    const { units } = await api<{ units: { code: string }[] }>(r, 'get', `/units-of-measure?input=${enc({})}`);
    for (const it of ITEMS) {
      it.id = (await api<{ id: string }>(r, 'post', '/items', { sku: it.sku, name: it.name, categoryId, hsn: '8708', unit: units[0]!.code,
        barcode: null, serialised: false, hasChassis: false, purchasePrice: '1000' })).id;
    }
    const place = { code: `DEAL-${u}`, name: `Dealer store ${u}`, kind: 'store' };
    const { id: placeId } = await api<{ id: string }>(r, 'post', '/stock/locations', place);
    run.placeName = place.name;
    const batches = await receiveStock(ITEMS.map((i) => ({ itemId: i.id, qty: '100', rate: '1000' })), placeId, today());
    for (const it of ITEMS) it.batchId = batches[it.id]!;
    const dealer = await api<{ id: string }>(r, 'post', '/parties', { name: DEALER.name, kinds: ['customer', 'dealer'], gstin: null, pan: null, composition: false,
      stateCode: DEALER.state, phone: null, email: null, addressLine1: `${u} Industrial Estate`, addressLine2: null, city: 'Bengaluru', pincode: '560001' });
    run.dealerId = dealer.id;
    await api(r, 'put', `/parties/${dealer.id}/credit`, { id: dealer.id, creditDays: 30, creditLimit: CREDIT_LIMIT, reason: 'E2E: the dealer’s terms' });
    // The dealer's price list, made the way the app makes one: a list and its rates drafted, sent for approval, approved by a second
    // person (the owner), and set as the dealer's own. It comes into force today, the day it is approved, and the journey sells today.
    const list = await api<{ id: string; draftId: string }>(r, 'post', '/price-lists', { name: `Dealer list ${u}`, taxInclusive: false });
    await api(r, 'put', `/price-lists/versions/${list.draftId}/rates`, { id: list.draftId, rates: ITEMS.map((i) => ({ itemId: i.id, rate: i.rate })) });
    await api(r, 'post', `/price-lists/versions/${list.draftId}/approval`, { id: list.draftId });
    const owner = await browser.newContext({ storageState: stateFor('owner'), baseURL: baseURL! });
    try {
      await decide(owner.request, 'price-list', list.draftId);
      await api(owner.request, 'put', `/sales/party-price-lists/${dealer.id}`, { partyId: dealer.id, priceListId: list.id, reason: 'E2E: the dealer’s price list' });
    } finally {
      await owner.close();
    }
  } finally {
    await admin.close();
  }
});

test.describe('sales', () => {
  test.use({ storageState: stateFor('sales') });

  test('quotes the dealer at the dealer price list, sends the quote, and the dealer accepts: a draft order', async ({ page }) => {
    await page.goto('/sales/quotes/new');
    await expect(page.getByRole('heading', { level: 1, name: 'New quote' })).toBeVisible();
    await pick(page, /^Customer/, DEALER.name);
    for (const [i, it] of ITEMS.entries()) {
      if (i > 0) await btn(page, 'Add a line').click();
      await pick(page, /^Item/, it.sku, lineSet(page, i + 1));
      await lineSet(page, i + 1).getByLabel('Quantity').fill(String(it.qty));
      await lineSet(page, i + 1).getByLabel('Rate').fill(it.rate);
    }
    await accessible(page);
    await btn(page, 'Save the quote').click();
    await expect(page).toHaveURL(/\/sales\/quotes\/[0-9a-f-]{36}$/);
    await btn(page, 'Send').click();
    await dialog(page).getByRole('button', { name: 'Send' }).click();
    await expect(page.getByRole('heading', { level: 1, name: /^Quote \S+/ })).toBeVisible();
    run.quoteNumber = (await page.getByRole('heading', { level: 1 }).innerText()).replace('Quote ', '').trim();
    await expect(bar(page).getByRole('listitem')).toHaveText(['Draft (done)', 'Sent (now)', 'Accepted']);
    await btn(page, 'Customer accepted').click();
    await dialog(page).getByRole('button', { name: 'Customer accepted' }).click();
    await expect(page).toHaveURL(/\/sales\/orders\/[0-9a-f-]{36}$/);
    run.orderUrl = new URL(page.url()).pathname;
    await expect(page.getByRole('heading', { level: 1, name: 'Draft order' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Lines' })).toContainText(ITEMS[0]!.name);
    await expect(page.getByRole('table', { name: 'Lines' })).toContainText(ITEMS[1]!.name);
    await accessible(page);
  });

  test('confirming the order stops at the dealer’s credit limit; asking for an override is not yet an answer', async ({ page }) => {
    await page.goto(run.orderUrl);
    await btn(page, 'Confirm').click();
    await dialog(page).getByRole('button', { name: 'Confirm' }).click();
    const alert = dialog(page).getByRole('alert').first();
    await expect(alert).toContainText('needs someone else to approve an override');
    await expect(dialog(page)).toContainText(/credit limit/i);
    await accessible(page);
    await dialog(page).getByRole('button', { name: 'Ask for an override' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(status(page, 'An override was asked for')).not.toHaveCount(0);
    await btn(page, 'Confirm').click();
    await dialog(page).getByRole('button', { name: 'Confirm' }).click();
    await expect(dialog(page).getByRole('alert').first()).toContainText('needs someone else to approve an override');
    await dialog(page).getByRole('button', { name: 'Keep it' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Draft order' })).toBeVisible();
  });
});

test.describe('accounts', () => {
  test.use({ storageState: stateFor('accounts') });

  test('decides the order’s override request: approved, and recorded', async ({ request }) => {
    await decide(request, 'sales-order-override', run.orderUrl.split('/').pop()!);
  });
});

test.describe('sales, again', () => {
  test.use({ storageState: stateFor('sales') });

  test('the order now confirms, and draws its number', async ({ page }) => {
    await page.goto(run.orderUrl);
    await btn(page, 'Confirm').click();
    await dialog(page).getByRole('button', { name: 'Confirm' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: /^Order \S+/ })).toBeVisible();
    run.orderNumber = (await page.getByRole('heading', { level: 1 }).innerText()).replace('Order ', '').trim();
    await expect(bar(page).getByRole('listitem')).toHaveText(['Draft (done)', 'Confirmed (now)', 'Closed']);
    await accessible(page);
  });
});

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

test.describe('stores', () => {
  test.use({ storageState: stateFor('stores') });

  async function draftDelivery(page: Page, qtys: [number, number]) {
    await page.goto('/sales/deliveries/new');
    await pickByLabel(page, page.getByLabel('Order', { exact: true }), `${run.orderNumber}, ${DEALER.name}`);
    await btn(page, 'Add its lines').click();
    await page.getByLabel('Deliver from').selectOption({ label: run.placeName });
    for (const [i, q] of qtys.entries()) {
      if (q === 0) continue;
      await lineSet(page, i + 1).getByLabel('Quantity to deliver').fill(String(q));
      await lineSet(page, i + 1).getByLabel(/^From batch B1/).fill(String(q));
    }
    await accessible(page);
    await btn(page, 'Save the delivery').click();
    await expect(page).toHaveURL(/\/sales\/deliveries\/[0-9a-f-]{36}$/);
    return new URL(page.url()).pathname;
  }
  async function postIt(page: Page) {
    await btn(page, 'Post').click();
    await dialog(page).getByRole('button', { name: 'Post' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: /^Delivery \S+/ })).toBeVisible();
    await expect(bar(page).getByRole('listitem')).toHaveText(['Draft (done)', 'Posted (now)']);
    run.deliveries.push((await page.getByRole('heading', { level: 1 }).innerText()).replace('Delivery ', '').trim());
  }

  test('delivers in parts: the first delivery takes 6 of the 10 chargers and all 4 batteries, and posts; the order stays open', async ({ page }) => {
    await draftDelivery(page, [6, 4]);
    await postIt(page);
    await expect(page.getByRole('table', { name: /^Lines of/ })).toContainText('6');
    await accessible(page);
    await page.goto(run.orderUrl);
    await expect(bar(page).getByRole('listitem')).toHaveText(['Draft (done)', 'Confirmed (now)', 'Closed']);
    // Item, Quantity, Delivered, Invoiced: 6 of 10 chargers and all 4 batteries have gone
    await expect(cells(page, 1).nth(1)).toHaveText('10');
    await expect(cells(page, 1).nth(2)).toHaveText('6');
    await expect(cells(page, 2).nth(1)).toHaveText('4');
    await expect(cells(page, 2).nth(2)).toHaveText('4');
  });

  test('the second delivery, the rest of the chargers, takes the dealer past the credit limit again: it stops, and an override is asked for', async ({ page }) => {
    run.secondDelivery = await draftDelivery(page, [4, 0]);
    await btn(page, 'Post').click();
    await dialog(page).getByRole('button', { name: 'Post' }).click();
    await expect(dialog(page).getByRole('alert').first()).toContainText('needs someone else to approve an override');
    await expect(dialog(page)).toContainText(/credit limit/i);
    await dialog(page).getByRole('button', { name: 'Ask for an override' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(status(page, 'An override was asked for')).not.toHaveCount(0);
  });
});

test.describe('accounts, deciding', () => {
  test.use({ storageState: stateFor('accounts') });

  test('decides the delivery’s override request: approved', async ({ request }) => {
    await decide(request, 'sales-delivery-override', run.secondDelivery.split('/').pop()!);
  });
});

test.describe('stores, again', () => {
  test.use({ storageState: stateFor('stores') });

  test('the second delivery now posts', async ({ page }) => {
    await page.goto(run.secondDelivery);
    await btn(page, 'Post').click();
    await dialog(page).getByRole('button', { name: 'Post' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(bar(page).getByRole('listitem')).toHaveText(['Draft (done)', 'Posted (now)']);
    run.deliveries.push((await page.getByRole('heading', { level: 1 }).innerText()).replace('Delivery ', '').trim());
    expect(run.deliveries).toHaveLength(2);
    await page.goto(run.orderUrl);
    await expect(page.getByRole('table', { name: 'Lines' })).toBeVisible();
    await accessible(page);
  });
});

test.describe('accounts, invoicing', () => {
  test.use({ storageState: stateFor('accounts') });

  test('writes an invoice for each delivery; the credit check stops both, and an override is asked for each', async ({ page }) => {
    for (const number of run.deliveries) {
      await page.goto('/sales/invoices/new');
      await pick(page, /^Customer/, DEALER.name);
      await pickByLabel(page, page.getByLabel('A delivery to bill'), number);
      await btn(page, 'Add its lines').click();
      await accessible(page);
      await btn(page, 'Save the invoice').click();
      await expect(page).toHaveURL(/\/sales\/invoices\/[0-9a-f-]{36}$/);
      run.invoices.push(new URL(page.url()).pathname);
      await btn(page, 'Post').click();
      await dialog(page).getByRole('button', { name: 'Post' }).click();
      await expect(dialog(page).getByRole('alert').first()).toContainText('needs someone else to approve an override');
      await dialog(page).getByRole('button', { name: 'Ask for an override' }).click();
      await expect(dialog(page)).toHaveCount(0);
      await expect(status(page, 'An override was asked for')).not.toHaveCount(0);
    }
  });
});

test.describe('owner', () => {
  test.use({ storageState: stateFor('owner') });

  test('decides both invoices’ override requests: approved', async ({ request }) => {
    for (const url of run.invoices) await decide(request, 'sales-invoice-override', url.split('/').pop()!);
  });
});

test.describe('accounts, posting', () => {
  test.use({ storageState: stateFor('accounts') });

  test('posts both invoices: each draws a number and carries IGST, never CGST and SGST', async ({ page }) => {
    const expected = [
      { taxable: '₹34,000.00', igst: '₹9,520.00', total: '₹43,520.00', lines: [['6', '₹24,000.00', '₹6,720.00', '₹30,720.00'], ['4', '₹10,000.00', '₹2,800.00', '₹12,800.00']] },
      { taxable: '₹16,000.00', igst: '₹4,480.00', total: '₹20,480.00', lines: [['4', '₹16,000.00', '₹4,480.00', '₹20,480.00']] },
    ];
    for (const [i, url] of run.invoices.entries()) {
      await page.goto(url);
      await btn(page, 'Post').click();
      await dialog(page).getByRole('button', { name: 'Post' }).click();
      await expect(dialog(page)).toHaveCount(0);
      await expect(page.getByRole('heading', { level: 1, name: /^Invoice \S+/ })).toBeVisible();
      run.invoiceNumbers.push((await page.getByRole('heading', { level: 1 }).innerText()).replace('Invoice ', '').trim());
      await expect(bar(page).getByRole('listitem')).toHaveText(['Draft (done)', 'Posted (now)']);
      await expect(fact(page, 'Place of supply')).toHaveText('Karnataka');
      const e = expected[i]!;
      for (const [r, [qty, taxable, igst, total]] of e.lines.entries()) {
        const c = cells(page, r + 1);
        await expect(c.nth(2)).toHaveText(qty!);
        await expect(c.nth(5)).toHaveText(taxable!);
        await expect(c.nth(6), 'no CGST').toHaveText('₹0.00');
        await expect(c.nth(7), 'no SGST').toHaveText('₹0.00');
        await expect(c.nth(8), 'IGST').toHaveText(igst!);
        await expect(c.nth(9)).toHaveText(total!);
      }
      await expect(fact(page, 'Taxable value')).toHaveText(e.taxable);
      await expect(fact(page, 'CGST')).toHaveText('₹0.00');
      await expect(fact(page, 'SGST')).toHaveText('₹0.00');
      await expect(fact(page, 'IGST')).toHaveText(e.igst);
      await expect(fact(page, 'Total').last()).toHaveText(e.total);
      await accessible(page);
    }
  });
});

test.describe('accounts, collecting', () => {
  test.use({ storageState: stateFor('accounts'), expectedStatuses: [422] });

  /** Money as the screens write it. */
  const rupees = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const dealerRow = (page: Page) => page.getByRole('row').filter({ hasText: DEALER.name });
  /** Finds the dealer on To collect, paging with "Show more" (earlier journeys leave debtors behind). */
  async function findDealer(page: Page) {
    await page.goto('/accounts/collect');
    const deadline = Date.now() + 60_000;
    while ((await dealerRow(page).count()) === 0) {
      const more = page.getByRole('button', { name: 'Show more' });
      if (Date.now() > deadline || !(await more.isVisible())) break;
      await more.click();
      await page.waitForTimeout(300);
    }
  }
  /** Records a receipt from the dealer through the screen; answers its number. */
  async function receive(page: Page, amount: string, reference: string): Promise<string> {
    await page.goto('/accounts/payments/new');
    await pick(page, /^Customer/, DEALER.name);
    await page.getByLabel('Amount', { exact: true }).fill(amount);
    const bank = (await page.getByLabel('Money account').locator('option').allTextContents()).find((o) => /bank/i.test(o))!;
    await page.getByLabel('Money account').selectOption({ label: bank });
    await page.getByLabel('Reference (optional)').fill(reference);
    await accessible(page);
    await btn(page, 'Record it').click();
    await expect(page.getByRole('heading', { level: 2, name: /^Receipt \S+/ })).toBeVisible();
    return (await page.getByRole('heading', { level: 2 }).first().innerText()).replace('Receipt ', '').trim();
  }
  const apply = (page: Page) => page.locator('section[aria-labelledby="payment-apply"]');
  const box = (page: Page, invoice: string) => apply(page).getByLabel(new RegExp(`^Apply to ${invoice}`));

  test('the dealer owes both invoices: To collect lists 64,000.00, and the statement shows the two open bills', async ({ page }) => {
    await findDealer(page);
    await expect(dealerRow(page)).toBeVisible();
    await expect(dealerRow(page).getByRole('cell').nth(1)).toHaveText(rupees(64000));
    await dealerRow(page).getByRole('link').click();
    await expect(page.getByRole('heading', { level: 1, name: `Statement: ${DEALER.name}` })).toBeVisible();
    const bills = page.getByRole('region', { name: 'Open bills' }).first().getByRole('row');
    for (const [i, amount] of [[0, 43520], [1, 20480]] as const) {
      await expect(bills.nth(i + 1).getByRole('link', { name: run.invoiceNumbers[i]! })).toBeVisible();
      await expect(bills.nth(i + 1).getByRole('cell').nth(3)).toHaveText(rupees(amount));
      await expect(bills.nth(i + 1).getByRole('cell').nth(5)).toHaveText(rupees(amount));
    }
    await accessible(page);
  });

  test('records a receipt of 50,000.00 and applies it over the two invoices: refusals worded first, then 43,520.00 to the first and 6,480.00 to the second', async ({ page }) => {
    const receipt = await receive(page, '50000', `UTR-${u}`);
    await expect(page.getByText(`Receipt ${receipt} recorded.`).first()).toBeVisible();
    await expect(apply(page)).toBeVisible();
    await expect(box(page, run.invoiceNumbers[0]!)).toBeVisible();
    await expect(box(page, run.invoiceNumbers[1]!)).toBeVisible();
    // more than a bill has open, and more than the receipt has left
    await box(page, run.invoiceNumbers[0]!).fill('43520');
    await box(page, run.invoiceNumbers[1]!).fill('20481');
    await expect(apply(page).getByText('Applied so far: ₹64,001.00 of ₹50,000.00.')).toBeVisible();
    await apply(page).getByRole('button', { name: 'Apply it' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /That is more than is left (to pay on a bill|of the receipt)\./ }).first()).toBeVisible();
    // the right split
    await box(page, run.invoiceNumbers[1]!).fill('6480');
    await expect(apply(page).getByText('Applied so far: ₹50,000.00 of ₹50,000.00.')).toBeVisible();
    await accessible(page);
    await apply(page).getByRole('button', { name: 'Apply it' }).click();
    await expect(status(page, 'Applied to 2 bill(s).').first()).toBeAttached();
    await expect(apply(page)).toHaveCount(0);
  });

  test('after the first receipt the dealer owes 14,000.00, all of it on the second invoice', async ({ page }) => {
    await findDealer(page);
    await expect(dealerRow(page).getByRole('cell').nth(1)).toHaveText(rupees(14000));
    await dealerRow(page).getByRole('link').click();
    const bills = page.getByRole('region', { name: 'Open bills' }).first().getByRole('row');
    await expect(bills).toHaveCount(2); // the header and one open bill
    await expect(bills.nth(1).getByRole('link', { name: run.invoiceNumbers[1]! })).toBeVisible();
    await expect(bills.nth(1).getByRole('cell').nth(5)).toHaveText(rupees(14000));
    await accessible(page);
  });

  test('a second receipt of 14,000.00 settles it: nothing is left to collect from the dealer, and the Payments list shows both receipts', async ({ page }) => {
    const receipt = await receive(page, '14000', `UTR2-${u}`);
    await expect(box(page, run.invoiceNumbers[1]!)).toBeVisible();
    await expect(apply(page).getByLabel(new RegExp(`^Apply to ${run.invoiceNumbers[0]!}`))).toHaveCount(0); // the first invoice is paid: not offered
    await box(page, run.invoiceNumbers[1]!).fill('14000');
    await apply(page).getByRole('button', { name: 'Apply it' }).click();
    await expect(status(page, 'Applied to 1 bill(s).').first()).toBeAttached();
    await findDealer(page);
    await expect(dealerRow(page)).toHaveCount(0);
    await page.goto('/accounts/payments');
    await expect(page.getByRole('heading', { level: 1, name: 'Payments' })).toBeVisible();
    const deadline = Date.now() + 60_000;
    while ((await page.getByRole('row').filter({ hasText: receipt }).count()) === 0 && Date.now() < deadline) {
      const more = page.getByRole('button', { name: 'Show more' });
      if (!(await more.isVisible())) break;
      await more.click();
      await page.waitForTimeout(300);
    }
    await expect(page.getByRole('row').filter({ hasText: receipt })).toContainText(rupees(14000));
    await expect(page.getByRole('row').filter({ hasText: `UTR-${u}` })).toContainText(rupees(50000));
    await accessible(page);
  });
});

test.describe('sales, looking back', () => {
  test.use({ storageState: stateFor('sales') });

  test('the order is closed by its last delivery, and shows all of it delivered and invoiced', async ({ page }) => {
    await page.goto(run.orderUrl);
    await expect(bar(page).getByRole('listitem')).toHaveText(['Draft (done)', 'Confirmed (done)', 'Closed (now)']);
    await expect(fact(page, 'Place of supply')).toHaveText('Karnataka');
    for (const [row, qty] of [[1, '10'], [2, '4']] as const) {
      await expect(cells(page, row).nth(1)).toHaveText(qty);
      await expect(cells(page, row).nth(2), 'delivered').toHaveText(qty);
      await expect(cells(page, row).nth(3), 'invoiced').toHaveText(qty);
    }
    await expect(fact(page, 'IGST')).toHaveText('₹14,000.00');
    await expect(fact(page, 'Total').last()).toHaveText('₹64,000.00');
    await accessible(page);
  });
});
