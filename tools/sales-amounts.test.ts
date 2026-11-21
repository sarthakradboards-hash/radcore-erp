// Part of RAD-112 (the architect on RAD-112, ruled on RAD-125) on a real PostgreSQL, as the runtime login: a quote's and
// an order's amounts, worked out as an invoice's are (lib-gst's rate on the document's date, the place of supply, the
// totals rounded to the rupee). A draft's are worked out on read; sending a quote or confirming an order freezes them,
// and a later rate doesn't move them. The confirmation's credit check judges the total it freezes. Each order line
// answers what's been delivered (net of returns) and invoiced, worked out on read. The company profile must stay unset
// for company.test.ts, so it's set inside transactions that roll back.
import { randomBytes, randomUUID } from 'node:crypto';
import { addParty, openFinancialYear, setCompanyProfile, setCreditTerms } from '@radcore/lib-accounts';
import { moneyString, percentString, quantityString, unitPriceString } from '@radcore/lib-common';
import { putGstRate } from '@radcore/lib-gst';
import { AppError, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import {
  addDelivery, addDeliveryReturn, addInvoice, addOrder, addQuote, confirmOrderNow, getDeliveryById, getOrderById, getQuoteById,
  postDeliveryNow, postDeliveryReturnNow, postInvoiceNow, sendQuoteNow,
} from '@radcore/lib-sales';
import { addCategory, addItem, addPlace } from '@radcore/lib-stock';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { priceListFrom } from './price-list-fixture.ts';
import { postDocument, SOURCE_TABLE } from './stock-posting.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
// A fixed past day, so no test reads the run date (RC-156).
const DATE = '2026-11-15';
const KEYS = ['sales:read', 'sales:write', 'deliveries:write', 'invoices:write', 'parties:write', 'parties:manage', 'items:write',
  'locations:write', 'cost:read', 'gst:write', 'company:write'];
const staff: Principal = { kind: 'user', userId: randomUUID(), permissions: KEYS };
const tag = () => randomBytes(3).toString('hex').toUpperCase();
const q = (s: string) => quantityString().parse(s);
// The company, in Maharashtra (27).
const COMPANY = { legalName: 'Radboards Pvt Ltd', gstin: '27AAPFU0939F1ZV', addressLine1: 'Plot 4, Bhosari MIDC', addressLine2: null,
  city: 'Pune', pincode: '411019', reason: 'Amounts in a test' };
class RolledBack extends Error {}

describe.skipIf(!url || !superUrl)('quote and order amounts', () => {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  const su = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
    await su.end();
  });
  const run = <T>(fn: (ctx: Ctx) => Promise<T>) => runInTransaction(db, WRITE, staff, randomUUID(), fn);
  const failure = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof AppError ? e.code : String(e)));
  async function inBooks<R>(fn: (ctx: Ctx) => Promise<R>): Promise<R> {
    let out: R | undefined;
    await run(async (ctx) => {
      await setCompanyProfile(ctx, COMPANY);
      out = await fn(ctx);
      throw new RolledBack();
    }).catch((e: unknown) => {
      if (!(e instanceof RolledBack)) throw e;
    });
    return out as R;
  }

  /** A customer in `state` with credit up to `limit`, an item rated 5% on its own HSN, priced on the party's list at
   * 80,000.00, and a store holding 3 of it. */
  async function setup(o: { state?: string; limit?: string } = {}) {
    const made = await run(async (ctx) => {
      await openFinancialYear(ctx, DATE);
      const { id: partyId } = await addParty(ctx, { name: `Party ${tag()}`, kinds: ['customer'], gstin: null, pan: null, composition: false,
        stateCode: o.state ?? '27', phone: null, email: null, addressLine1: '12 MG Road', addressLine2: null, city: 'Pune', pincode: '411001' });
      await setCreditTerms(ctx, { id: partyId, creditDays: 30, creditLimit: moneyString().parse(o.limit ?? '100000000'), reason: 'Test' });
      const { id: categoryId } = await addCategory(ctx, { name: `Test ${tag()}` });
      const hsn = `8716${String(randomBytes(2).readUInt16BE() % 10000).padStart(4, '0')}`;
      await putGstRate(ctx, { hsn, effectiveFrom: DATE, rate: percentString().parse('5'), source: 'Notification 1/2017-CT(R)', note: null,
        reason: 'Test' });
      const { id: itemId } = await addItem(ctx, { sku: `A-${tag()}`, name: 'Scooter', categoryId, hsn, unit: 'NOS', barcode: null,
        serialised: false, hasChassis: false, purchasePrice: unitPriceString().parse('1') });
      const { id: placeId } = await addPlace(ctx, { code: `L${tag()}`, name: `Store ${tag()}`, kind: 'store' });
      await postDocument(ctx, { sourceTable: SOURCE_TABLE, sourceId: randomUUID(), businessDate: DATE, ins: [{ itemId, locationId: placeId,
        qty: q('3'), rate: unitPriceString().parse('61250'), batches: [{ batchNo: 'B1', qty: q('3') }] }] });
      return { partyId, itemId, placeId, hsn };
    });
    await priceListFrom(su, DATE, { [made.itemId]: '80000' }, { partyId: made.partyId });
    const { rows: [batch] } = await su.query<{ id: string }>('select id from radcore.batches where item_id = $1', [made.itemId]);
    return { ...made, batchId: batch?.id ?? '' };
  }
  type At = Awaited<ReturnType<typeof setup>>;
  const lines = (at: At, qty = '1') => [{ itemId: at.itemId, qty: q(qty), rate: unitPriceString().parse('80000'),
    discountPercent: percentString({ max: '100' }).parse('0') }];

  // F6's figures on a quote: 80,000.00 at 5% within the state is CGST and SGST 2,000.00 each, 84,000.00. Sent, they're
  // frozen: a rate corrected afterwards moves a new draft's, never the sent quote's.
  it('works a draft quote’s amounts out on read, freezes them when it’s sent, and a later rate moves only a new draft', async () => {
    const at = await setup();
    const out = await inBooks(async (ctx) => {
      const { id } = await addQuote(ctx, { partyId: at.partyId, businessDate: DATE, validUntil: null, notes: null, lines: lines(at) });
      const draft = await getQuoteById(ctx, { id });
      await sendQuoteNow(ctx, { id });
      await putGstRate(ctx, { hsn: at.hsn, effectiveFrom: DATE, rate: percentString().parse('12'), source: 'A later notification', note: null,
        reason: 'Test' });
      const sent = await getQuoteById(ctx, { id });
      const { id: later } = await addQuote(ctx, { partyId: at.partyId, businessDate: DATE, validUntil: null, notes: null, lines: lines(at) });
      return { draft: draft.amounts, sameLines: JSON.stringify(sent.lines.map((l) => l.amounts)) === JSON.stringify(draft.lines.map((l) => l.amounts)),
        sent: sent.amounts, source: sent.lines[0]?.amounts?.gstRateSource, later: (await getQuoteById(ctx, { id: later })).amounts?.total };
    });
    const f6 = { placeOfSupply: '27', taxable: '80000.00', cgst: '2000.00', sgst: '2000.00', igst: '0.00', roundOff: '0.00', total: '84000.00' };
    expect(out).toEqual({ draft: f6, sameLines: true, sent: f6, source: 'Notification 1/2017-CT(R)', later: '89600.00' });
  });

  // CA-08: a party in another state is charged IGST at the whole rate.
  it('charges IGST between states', async () => {
    const at = await setup({ state: '29' });
    const out = await inBooks(async (ctx) => {
      const { id } = await addQuote(ctx, { partyId: at.partyId, businessDate: DATE, validUntil: null, notes: null, lines: lines(at) });
      return (await getQuoteById(ctx, { id })).amounts;
    });
    expect(out).toEqual({ placeOfSupply: '29', taxable: '80000.00', cgst: '0.00', sgst: '0.00', igst: '4000.00', roundOff: '0.00', total: '84000.00' });
  });

  // RC-112: no company profile, no state to judge the place of supply by. A draft still opens, without amounts; it
  // can't be sent.
  it('shows a draft no amounts before the company profile is set, and refuses to send it', async () => {
    const at = await setup();
    const { id } = await run((ctx) => addQuote(ctx, { partyId: at.partyId, businessDate: DATE, validUntil: null, notes: null, lines: lines(at) }));
    const draft = await run((ctx) => getQuoteById(ctx, { id }));
    expect([draft.amounts, draft.lines[0]?.amounts, await failure(run((ctx) => sendQuoteNow(ctx, { id })))])
      .toEqual([null, null, 'company_profile_incomplete']);
  });

  // The confirmation's credit check judges the total it freezes (84,000.00): a limit of 83,999.99 stops it, one of
  // 84,000.00 doesn't, and the confirmed order keeps that total.
  it('judges the credit limit by the total it freezes at confirmation', async () => {
    const short = await setup({ limit: '83999.99' });
    const enough = await setup({ limit: '84000' });
    const out = await inBooks(async (ctx) => {
      const order = async (at: At) => (await addOrder(ctx, { partyId: at.partyId, businessDate: DATE, notes: null, lines: lines(at) })).id;
      const stopped = await failure(confirmOrderNow(ctx, { id: await order(short) }));
      const id = await order(enough);
      await confirmOrderNow(ctx, { id });
      const o = await getOrderById(ctx, { id });
      return { stopped, total: o.amounts?.total, line: o.lines[0]?.amounts?.lineTotal };
    });
    expect(out).toEqual({ stopped: 'needs_override', total: '84000.00', line: '84000.00' });
  });

  // An order line's progress, on read: 3 ordered, 2 delivered, 1 taken back, 1 invoiced.
  it('answers each order line’s delivered, net of returns, and invoiced', async () => {
    const at = await setup();
    const out = await inBooks(async (ctx) => {
      const { id } = await addOrder(ctx, { partyId: at.partyId, businessDate: DATE, notes: null, lines: lines(at, '3') });
      await confirmOrderNow(ctx, { id });
      const orderLineId = (await getOrderById(ctx, { id })).lines[0]?.id ?? '';
      const { id: deliveryId } = await addDelivery(ctx, { orderId: id, locationId: at.placeId, businessDate: DATE, notes: null,
        lines: [{ orderLineId, qty: q('2'), batches: [{ batchId: at.batchId, qty: q('2') }], serials: [] }] });
      await postDeliveryNow(ctx, { id: deliveryId });
      const deliveryLineId = (await getDeliveryById(ctx, { id: deliveryId })).lines[0]?.id ?? '';
      const { id: back } = await addDeliveryReturn(ctx, { deliveryId, locationId: at.placeId, businessDate: DATE, notes: null,
        lines: [{ deliveryLineId, qty: q('1'), batches: [{ batchId: at.batchId, qty: q('1') }], serials: [] }] });
      await postDeliveryReturnNow(ctx, { id: back });
      const { id: invoiceId } = await addInvoice(ctx, { partyId: at.partyId, businessDate: DATE, notes: null, shipTo: null,
        lines: [{ deliveryLineId, qty: q('1') }] });
      await postInvoiceNow(ctx, { id: invoiceId });
      const line = (await getOrderById(ctx, { id })).lines[0];
      return [line?.qty, line?.delivered, line?.invoiced];
    });
    expect(out).toEqual(['3.000', '1.000', '1.000']);
  });
});
