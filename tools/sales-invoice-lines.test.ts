// Part of RAD-112 on a real PostgreSQL, as the runtime login, against the run's committed company profile:
// - an invoice line answers its item's SKU and name (RAD-125's screens), and the worst condition of the units it bills
//   when they aren't all new (the architect, with stock.sell_damaged_units): read as they stand while a draft, carried
//   once posted;
// - a delivery line answers how much of it is still to invoice (auditor-3 on #285), worked out on read;
// - a confirmed order's change holds the period, so a locked one refuses it and the order keeps its total (auditor-2 on
//   #282). The lock is set by the superuser in a transaction that rolls back, so no other file sees it.
import { randomBytes, randomUUID } from 'node:crypto';
import { addParty, openFinancialYear, setCreditTerms } from '@radcore/lib-accounts';
import { moneyString, percentString, quantityString, unitPriceString, type UnitCondition } from '@radcore/lib-common';
import { putGstRate } from '@radcore/lib-gst';
import { AppError, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import {
  addDelivery, addDeliveryReturn, addInvoice, addOrder, changeOrder, confirmOrderNow, getDeliveryById, getInvoiceById, getOrderById,
  listToInvoicePage, postDeliveryNow, postDeliveryReturnNow, postInvoiceNow,
} from '@radcore/lib-sales';
import { addCategory, addItem, addPlace } from '@radcore/lib-stock';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { rawOf } from '../packages/db/src/tx.ts';
import { priceListFrom } from './price-list-fixture.ts';
import { postDocument, SOURCE_TABLE } from './stock-posting.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
// A fixed past day, so no test reads the run date (RC-156).
const DATE = '2026-11-15';
const KEYS = ['sales:read', 'sales:write', 'deliveries:write', 'invoices:write', 'parties:write', 'parties:manage', 'items:write',
  'locations:write', 'cost:read', 'gst:write'];
const staff: Principal = { kind: 'user', userId: randomUUID(), permissions: KEYS };
const tag = () => randomBytes(3).toString('hex').toUpperCase();
const q = (s: string) => quantityString().parse(s);
class RolledBack extends Error {}

describe.skipIf(!url || !superUrl)('invoice and delivery lines', () => {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  const su = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  const superDb = createDatabase(su);
  afterAll(async () => {
    await pool.end();
    await su.end();
  });
  const run = <T>(fn: (ctx: Ctx) => Promise<T>) => runInTransaction(db, WRITE, staff, randomUUID(), fn);
  const failure = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof AppError ? e.code : String(e)));

  /** A customer with credit, an item rated 5% (serialised, with units in `conditions`, when given), priced on the
   * party's list at 1,000.00, and a store holding `stock` of it, in batch B1. */
  async function setup(o: { stock: string; conditions?: readonly UnitCondition[] }) {
    const serials = o.conditions?.map(() => `SN-${tag()}`);
    const made = await run(async (ctx) => {
      await openFinancialYear(ctx, DATE);
      const { id: partyId } = await addParty(ctx, { name: `Party ${tag()}`, kinds: ['customer'], gstin: null, pan: null, composition: false,
        stateCode: '27', phone: null, email: null, addressLine1: '12 MG Road', addressLine2: null, city: 'Pune', pincode: '411001' });
      await setCreditTerms(ctx, { id: partyId, creditDays: 30, creditLimit: moneyString().parse('100000000'), reason: 'Test' });
      const { id: categoryId } = await addCategory(ctx, { name: `Test ${tag()}` });
      const hsn = `8716${String(randomBytes(2).readUInt16BE() % 10000).padStart(4, '0')}`;
      await putGstRate(ctx, { hsn, effectiveFrom: DATE, rate: percentString().parse('5'), source: 'Test', note: null, reason: 'Test' });
      const sku = `IL-${tag()}`;
      const { id: itemId } = await addItem(ctx, { sku, name: 'Scooter', categoryId, hsn, unit: 'NOS', barcode: null,
        serialised: serials !== undefined, hasChassis: false, purchasePrice: unitPriceString().parse('1') });
      const { id: placeId } = await addPlace(ctx, { code: `L${tag()}`, name: `Store ${tag()}`, kind: 'store' });
      await postDocument(ctx, { sourceTable: SOURCE_TABLE, sourceId: randomUUID(), businessDate: DATE, ins: [{ itemId, locationId: placeId,
        qty: q(o.stock), rate: unitPriceString().parse('600'), batches: [{ batchNo: 'B1', qty: q(o.stock) }],
        ...(serials === undefined ? {} : { units: serials.map((serialNo, i) => ({ serialNo, condition: o.conditions?.[i] ?? 'new' })) }) }] });
      return { partyId, itemId, placeId, sku };
    });
    await priceListFrom(su, DATE, { [made.itemId]: '1000' }, { partyId: made.partyId });
    const { rows: [batch] } = await su.query<{ id: string }>('select id from radcore.batches where item_id = $1', [made.itemId]);
    return { ...made, batchId: batch?.id ?? '', serials: serials ?? [] };
  }
  type At = Awaited<ReturnType<typeof setup>>;
  const lines = (at: At, qty: string) => [{ itemId: at.itemId, qty: q(qty), rate: unitPriceString().parse('1000'),
    discountPercent: percentString({ max: '100' }).parse('0') }];
  /** A confirmed order of `qty`, delivered `sent` (with `serials`), posted: the delivery's id and its line's. */
  async function delivered(at: At, qty: string, sent: string, serials: string[] = []) {
    return run(async (ctx) => {
      const { id } = await addOrder(ctx, { partyId: at.partyId, businessDate: DATE, notes: null, lines: lines(at, qty) });
      await confirmOrderNow(ctx, { id });
      const orderLineId = (await getOrderById(ctx, { id })).lines[0]?.id ?? '';
      const { id: deliveryId } = await addDelivery(ctx, { orderId: id, locationId: at.placeId, businessDate: DATE, notes: null,
        lines: [{ orderLineId, qty: q(sent), batches: [{ batchId: at.batchId, qty: q(sent) }], serials }] });
      await postDeliveryNow(ctx, { id: deliveryId });
      return { orderId: id, deliveryId, deliveryLineId: (await getDeliveryById(ctx, { id: deliveryId })).lines[0]?.id ?? '' };
    });
  }
  const bill = (at: At, deliveryLineId: string, qty: string) => run((ctx) => addInvoice(ctx, { partyId: at.partyId, businessDate: DATE,
    notes: null, shipTo: null, lines: [{ deliveryLineId, qty: q(qty) }] }));

  // The worst of the units billed, as they stand on the draft and as the posted line carries them: one demo and one
  // used unit read "used"; all new read none.
  it('answers each invoice line’s item and its units’ worst condition, read on a draft and carried once posted', async () => {
    const mixed = await setup({ stock: '2', conditions: ['demo', 'used'] });
    const fresh = await setup({ stock: '1', conditions: ['new'] });
    const out = [];
    for (const at of [mixed, fresh]) {
      const n = String(at.serials.length);
      const { deliveryLineId } = await delivered(at, n, n, at.serials);
      const { id } = await bill(at, deliveryLineId, n);
      const draft = (await run((ctx) => getInvoiceById(ctx, { id }))).lines[0];
      await run((ctx) => postInvoiceNow(ctx, { id }));
      const posted = (await run((ctx) => getInvoiceById(ctx, { id }))).lines[0];
      out.push([draft?.sku === at.sku, draft?.name, draft?.unitCondition, posted?.unitCondition]);
    }
    expect(out).toEqual([[true, 'Scooter', 'used', 'used'], [true, 'Scooter', null, null]]);
  });

  // 3 delivered, 1 taken back, 1 invoiced: 1 is still to invoice, in getDelivery and in the to-invoice list. A draft
  // delivery has none to invoice yet.
  it('answers each delivery line’s quantity still to invoice, net of returns and posted invoices', async () => {
    const at = await setup({ stock: '4' });
    const { deliveryId, deliveryLineId } = await delivered(at, '4', '3');
    await run(async (ctx) => {
      const { id } = await addDeliveryReturn(ctx, { deliveryId, locationId: at.placeId, businessDate: DATE, notes: null,
        lines: [{ deliveryLineId, qty: q('1'), batches: [{ batchId: at.batchId, qty: q('1') }], serials: [] }] });
      await postDeliveryReturnNow(ctx, { id });
    });
    const { id: invoiceId } = await bill(at, deliveryLineId, '1');
    await run((ctx) => postInvoiceNow(ctx, { id: invoiceId }));
    const one = await run((ctx) => getDeliveryById(ctx, { id: deliveryId }));
    const listed = (await run((ctx) => listToInvoicePage(ctx, { limit: 200, filter: { partyId: at.partyId } }))).items
      .find((d) => d.id === deliveryId);
    expect([one.lines[0]?.qtyToInvoice, listed?.lines.map((l) => [l.id === deliveryLineId, l.sku === at.sku, l.qtyToInvoice])])
      .toEqual(['1.000', [[true, true, '1.000']]]);
  });

  // auditor-2 on #282: a confirmed order's change holds the period first, so with its date locked the change is refused
  // `period_locked`, and the order keeps the total it was confirmed at.
  it('refuses a confirmed order’s change in a locked period, and keeps its total', async () => {
    const at = await setup({ stock: '1' });
    const { orderId } = await delivered(at, '2', '1');
    let refused = '';
    await runInTransaction(superDb, WRITE, staff, randomUUID(), async (ctx) => {
      await rawOf(ctx.tx).execute(sql`update radcore.period_lock set locked_through = ${DATE}`);
      refused = await failure(changeOrder(ctx, { id: orderId, partyId: at.partyId, businessDate: DATE, notes: null, lines: lines(at, '3') }));
      throw new RolledBack();
    }).catch((e: unknown) => {
      if (!(e instanceof RolledBack)) throw e;
    });
    const o = await run((ctx) => getOrderById(ctx, { id: orderId }));
    expect([refused, o.lines[0]?.qty, o.amounts.total]).toEqual(['period_locked', '2.000', '2100.00']);
  });
});
