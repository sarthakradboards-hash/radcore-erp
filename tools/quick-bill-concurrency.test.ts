// ADR-006 §1 for a save that posts several documents (the architect on RAD-115), on PostgreSQL 16 as M2-05's
// concurrency test: the quick bill takes every class of lock for its order, delivery, invoice and receipts first, in
// §1's order (period, party, stock, then its series, journal first), so it never holds one while waiting on a plain
// save that holds the next. A quick bill alongside a plain receipt, a plain delivery of the same item and a plain
// invoice to the same party each finish (no 40P01), and the numbers they draw stay gapless. In a database of its own: the
// run's rolled-back test wrappers draw several series in their files' own order, which these committed saves would meet.
import { randomBytes, randomUUID } from 'node:crypto';
import { addParty, openFinancialYear, recordPayment, setCreditTerms, systemAccountId } from '@radcore/lib-accounts';
import { moneyString, percentString, quantityString, unitPriceString } from '@radcore/lib-common';
import { putGstRate } from '@radcore/lib-gst';
import type { Ctx, Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import { addDelivery, addInvoice, addOrder, confirmOrderNow, getDeliveryById, getOrderById, postDeliveryNow, postInvoiceNow, quickBill } from '@radcore/lib-sales';
import { addCategory, addItem, addPlace } from '@radcore/lib-stock';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { priceListFrom } from './price-list-fixture.ts';
import { postDocument, SOURCE_TABLE } from './stock-posting.ts';
import { freshDatabase } from './test-database.ts';

const adminUrl = process.env['TEST_DATABASE_ADMIN_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
// A fixed past day, so no test reads the run date (RC-156).
const DATE = '2026-11-15';
const staff: Principal = { kind: 'user', userId: randomUUID(), permissions: ['sales:read', 'sales:write', 'deliveries:write', 'invoices:write',
  'parties:write', 'parties:manage', 'items:write', 'locations:write', 'cost:read', 'gst:write', 'payments:write'] };
const tag = () => randomBytes(3).toString('hex').toUpperCase();
const q = (s: string) => quantityString().parse(s);
const m = (s: string) => moneyString().parse(s);
const ROUNDS = 3;

it.runIf(process.env['CI'] && !adminUrl)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_ADMIN_URL is not set: in CI the quick bill concurrency tests must run, not skip');
});

describe.skipIf(!adminUrl)('a quick bill alongside plain saves', { timeout: 60_000 }, () => {
  let own: Awaited<ReturnType<typeof freshDatabase>>;
  let pool: pg.Pool;
  let su: pg.Pool;
  let db: ReturnType<typeof createDatabase>;
  beforeAll(async () => {
    own = await freshDatabase(adminUrl ?? '');
    pool = new pg.Pool({ connectionString: own.appUrl, max: 6 });
    su = new pg.Pool({ connectionString: own.superUrl, max: 2 });
    db = createDatabase(pool);
    // Its company profile, as test-database.ts commits the run's.
    const c = await su.connect();
    try {
      await c.query('begin');
      await c.query("set local app.principal = 'system:test'");
      await c.query(`insert into radcore.company (legal_name, gstin, address_line1, city, pincode)
        values ('Radboards Pvt Ltd', '27AAPFU0939F1ZV', 'Plot 4, Bhosari MIDC', 'Pune', '411019')`);
      await c.query('commit');
    } finally {
      c.release();
    }
  }, 120_000);
  afterAll(async () => {
    await pool.end();
    await su.end();
    await own.drop();
  });
  const run = <T>(fn: (ctx: Ctx) => Promise<T>) => runInTransaction(db, WRITE, staff, randomUUID(), fn);

  /** A named customer with ample credit, an item rated 5% priced 50.00 on its list, and a store holding 100 in B1. */
  async function setup() {
    const made = await run(async (ctx) => {
      await openFinancialYear(ctx, DATE);
      const { id: partyId } = await addParty(ctx, { name: `Party ${tag()}`, kinds: ['customer'], gstin: null, pan: null, composition: false,
        stateCode: '27', phone: null, email: null, addressLine1: '1 Main Road', addressLine2: null, city: 'Pune', pincode: '411001' });
      await setCreditTerms(ctx, { id: partyId, creditDays: 30, creditLimit: m('10000000'), reason: 'Test' });
      const { id: categoryId } = await addCategory(ctx, { name: `Test ${tag()}` });
      const hsn = `8713${String(randomBytes(2).readUInt16BE() % 10000).padStart(4, '0')}`;
      await putGstRate(ctx, { hsn, effectiveFrom: DATE, rate: percentString().parse('5'), source: 'Test', note: null, reason: 'Test' });
      const { id: itemId } = await addItem(ctx, { sku: `C-${tag()}`, name: 'Battery pack', categoryId, hsn, unit: 'NOS', barcode: null,
        serialised: false, hasChassis: false, purchasePrice: unitPriceString().parse('30') });
      const { id: placeId } = await addPlace(ctx, { code: `L${tag()}`, name: `Store ${tag()}`, kind: 'store' });
      await postDocument(ctx, { sourceTable: SOURCE_TABLE, sourceId: randomUUID(), businessDate: DATE, ins: [{ itemId, locationId: placeId,
        qty: q('100'), rate: unitPriceString().parse('30'), batches: [{ batchNo: 'B1', qty: q('100') }] }] });
      return { partyId, itemId, placeId };
    });
    await priceListFrom(su, DATE, { [made.itemId]: '50' }, { partyId: made.partyId });
    const { rows: [batch] } = await su.query<{ id: string }>('select id from radcore.batches where item_id = $1', [made.itemId]);
    return { ...made, batchId: batch?.id ?? '' };
  }
  type At = Awaited<ReturnType<typeof setup>>;
  const line = (at: At) => ({ itemId: at.itemId, qty: q('1'), rate: unitPriceString().parse('50'), discountPercent: percentString({ max: '100' }).parse('0') });
  // One at 50.00 and 5% is 52.50, billed as 53.00, paid in cash.
  type Pay = Parameters<typeof quickBill>[1]['payments'][number];
  const bill = (at: At, pay: Pay = { method: 'cash', amount: m('53') }) => run((ctx) => quickBill(ctx, { partyId: at.partyId, businessDate: DATE,
    locationId: at.placeId, notes: null, payments: [pay], lines: [{ ...line(at), batches: [{ batchId: at.batchId, qty: q('1') }], serials: [] }] }));
  /** A confirmed order for one, and its delivery, a draft. */
  const draftDelivery = (at: At) => run(async (ctx) => {
    const { id: orderId } = await addOrder(ctx, { partyId: at.partyId, businessDate: DATE, notes: null, lines: [line(at)] });
    await confirmOrderNow(ctx, { id: orderId });
    const orderLineId = (await getOrderById(ctx, { id: orderId })).lines[0]?.id ?? '';
    return (await addDelivery(ctx, { orderId, locationId: at.placeId, businessDate: DATE, notes: null,
      lines: [{ orderLineId, qty: q('1'), batches: [{ batchId: at.batchId, qty: q('1') }], serials: [] }] })).id;
  });
  /** A posted delivery of one, and its invoice, a draft. */
  const draftInvoice = async (at: At) => {
    const deliveryId = await draftDelivery(at);
    await run((ctx) => postDeliveryNow(ctx, { id: deliveryId }));
    return run(async (ctx) => {
      const deliveryLineId = (await getDeliveryById(ctx, { id: deliveryId })).lines[0]?.id ?? '';
      return (await addInvoice(ctx, { partyId: at.partyId, businessDate: DATE, notes: null, shipTo: null,
        lines: [{ deliveryLineId, qty: q('1'), rate: unitPriceString().parse('50') }] })).id;
    });
  };
  const outcome = (r: PromiseSettledResult<unknown>) => (r.status === 'fulfilled' ? 'ok' : String((r.reason as { code?: string }).code ?? r.reason));
  /** The series whose committed numbers this year aren't exactly 1 to their counter's last: skipped or shared. */
  async function gaps(): Promise<string[]> {
    const { rows } = await su.query<{ series: string; ok: boolean }>(`with drawn as (
        select 'sales.invoice' as series, number from radcore.invoices where number is not null
        union all select 'sales.delivery', number from radcore.deliveries where number is not null
        union all select 'sales.order', number from radcore.sales_orders where number is not null
        union all select 'accounts.receipt', number from radcore.payments where kind = 'receipt' and number is not null),
      counted as (select series, split_part(number, '/', 2) as year, count(*) as n, count(distinct number) as d,
        max(split_part(number, '/', 3)::int) as top from drawn group by series, split_part(number, '/', 2))
      select c.series || ' ' || c.year as series, (c.n = c.d and c.top = k.last and c.n = k.last) as ok from counted c
      join radcore.number_counters k on k.series = c.series and right(k.financial_year, 5) = c.year`);
    return rows.filter((r) => !r.ok).map((r) => r.series);
  }

  /**
   * A plain save's locks, taken by hand so the order is certain: `first` (a stock position, or the party), then, once
   * the quick bill is waiting on it, the journal series' turn, as a delivery or invoice takes it at its draw. With §1's
   * order the quick bill waits at `first` holding no series, so both finish; a quick bill that drew its receipts' journal
   * number first would hold that turn, and the two would deadlock (40P01).
   */
  async function plainSaveAgainst(first: string, values: unknown[], quick: () => Promise<unknown>): Promise<string[]> {
    const plain = await su.connect();
    try {
      await plain.query('begin');
      await plain.query("set local app.principal = 'system:test'");
      await plain.query(first, values);
      const pid = (await plain.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]?.pid;
      let done = false;
      const saved = quick().finally(() => { done = true; });
      const waiting = async () => (await su.query<{ n: number }>('select count(*)::int as n from pg_stat_activity where $1 = any(pg_blocking_pids(pid))',
        [pid])).rows[0]?.n ?? 0;
      await vi.waitFor(async () => expect(done || await waiting() > 0).toBe(true), { timeout: 10_000 });
      const turn = await plain.query("select pg_advisory_xact_lock(hashtextextended('numbering.accounts.journal', 0))")
        .then(() => 'ok', (e: unknown) => String((e as { code?: string }).code ?? e));
      await plain.query(turn === 'ok' ? 'commit' : 'rollback');
      return [turn, outcome((await Promise.allSettled([saved]))[0] as PromiseSettledResult<unknown>)];
    } finally {
      plain.release();
    }
  }

  it('waits for a plain delivery holding its item’s position without holding a series, so both finish', async () => {
    const at = await setup();
    expect(await plainSaveAgainst('select 1 from radcore.stock_positions where item_id = $1 and location_id = $2 for update',
      [at.itemId, at.placeId], () => bill(at))).toEqual(['ok', 'ok']);
  });

  // Paid by bank, so its receipt doesn't take the party for a cash limit before its journal number.
  it('waits for a plain invoice holding its party without holding a series, so both finish', async () => {
    const at = await setup();
    const bank = await run((ctx) => systemAccountId(ctx, 'bank'));
    expect(await plainSaveAgainst('select 1 from radcore.parties where id = $1 for no key update', [at.partyId],
      () => bill(at, { method: 'bank', amount: m('53'), accountId: bank }))).toEqual(['ok', 'ok']);
  });

  it('finishes alongside a plain receipt, a plain delivery of the same item and a plain invoice to the same party', async () => {
    const at = await setup();
    const cash = await run((ctx) => systemAccountId(ctx, 'cash'));
    const out: string[] = [];
    for (let n = 0; n < ROUNDS; n += 1) {
      const deliveryId = await draftDelivery(at);
      const invoiceId = await draftInvoice(at);
      const all = await Promise.allSettled([
        bill(at), run((ctx) => recordPayment(ctx, { kind: 'receipt', partyId: at.partyId, businessDate: DATE, amount: m('10'), accountId: cash })),
        bill(at), run((ctx) => postDeliveryNow(ctx, { id: deliveryId })),
        bill(at), run((ctx) => postInvoiceNow(ctx, { id: invoiceId })),
      ]);
      out.push(...all.map(outcome));
    }
    expect(out).toEqual(Array.from({ length: 6 * ROUNDS }, () => 'ok'));
    expect(await gaps()).toEqual([]);
  });
});
