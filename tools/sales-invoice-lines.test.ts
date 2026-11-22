// Part of RAD-112 on a real PostgreSQL, as the runtime login, against the run's committed company profile:
// - an invoice line answers its item's SKU and name (RAD-125's screens), and its delivery line's one condition when it
//   isn't new, as the units left on the delivery (the architect, with stock.sell_damaged_units); a delivery line holds
//   units of one condition only (mixed_condition);
// - a delivery line answers how much of it is still to invoice (auditor-3 on #285), worked out on read, and delivery and
//   return lines their item; a delivery's returns are counted by status (auditor-3 on #288);
// - a confirmed order's change holds the period, so a locked one refuses it and the order keeps its total (auditor-2 on
//   #282). The lock is set by the superuser in a transaction that rolls back, so no other file sees it.
import { randomBytes, randomUUID } from 'node:crypto';
import { addParty, openFinancialYear, setCreditTerms } from '@radcore/lib-accounts';
import { moneyString, percentString, quantityString, requestFor, unitPriceString, type UnitCondition } from '@radcore/lib-common';
import { putGstRate } from '@radcore/lib-gst';
import { AppError, loadConfig, Settings, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import {
  addDelivery, addDeliveryReturn, addInvoice, addOrder, changeOrder, confirmOrderNow, deliveryReturnCounts, getDeliveryById,
  getDeliveryReturnById, getInvoiceById, getOrderById, listToInvoicePage, postDeliveryNow, postDeliveryReturnNow, postInvoiceNow,
} from '@radcore/lib-sales';
import { postDelivery } from '@radcore/lib-sales/contract';
import { addCategory, addItem, addPlace } from '@radcore/lib-stock';
import { testSettings } from '@radcore/test-helpers';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createApp, listen } from '../apps/api/src/app.ts';
import salesRoutes from '../apps/api/src/routes/sales.ts';
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

  // Damaged units sell only where stock.sell_damaged_units allows; the test turns it on for its own posting only.
  const sellingDamaged = (ctx: Ctx): Ctx => ({ ...ctx, settings: new Settings([{ key: 'stock.sell_damaged_units', value: true }]) });
  /** A confirmed order with one line per serial, each delivered with its own unit, posted with damaged units allowed:
   * the posting's outcome and the delivery's lines' ids, in the serials' order. With `oneLine`, all go on one line. */
  async function deliveredEach(at: At, oneLine = false) {
    return run(async (ctx) => {
      const n = String(at.serials.length);
      const { id } = await addOrder(ctx, { partyId: at.partyId, businessDate: DATE, notes: null,
        lines: oneLine ? lines(at, n) : at.serials.flatMap(() => lines(at, '1')) });
      await confirmOrderNow(ctx, { id });
      const orderLines = (await getOrderById(ctx, { id })).lines;
      const { id: deliveryId } = await addDelivery(ctx, { orderId: id, locationId: at.placeId, businessDate: DATE, notes: null,
        lines: oneLine
          ? [{ orderLineId: orderLines[0]?.id ?? '', qty: q(n), batches: [{ batchId: at.batchId, qty: q(n) }], serials: at.serials }]
          : at.serials.map((serial, i) => ({ orderLineId: orderLines[i]?.id ?? '', qty: q('1'), batches: [{ batchId: at.batchId, qty: q('1') }],
            serials: [serial] })) });
      const posted = await failure(postDeliveryNow(sellingDamaged(ctx), { id: deliveryId }));
      return { posted, lineIds: posted === 'ok' ? (await getDeliveryById(ctx, { id: deliveryId })).lines.map((l) => l.id) : [] };
    });
  }
  const conditionsOf = async (invoiceId: string) => (await run((ctx) => getInvoiceById(ctx, { id: invoiceId }))).lines.map((l) => l.unitCondition);

  // The architect on RAD-112: a serialised delivery line holds units of one condition, so its invoice line carries that
  // condition. A damaged and a new unit on one line are refused, naming the odd unit.
  it('refuses a delivery line whose units are of two conditions', async () => {
    const at = await setup({ stock: '2', conditions: ['damaged', 'new'] });
    expect((await deliveredEach(at, true)).posted).toBe('mixed_condition');
  });

  // On two lines they post, and each invoice line shows its own delivery line's condition, billed together or apart.
  it('shows each invoice line its own delivery line’s condition, billed together or apart', async () => {
    const together = await setup({ stock: '2', conditions: ['damaged', 'new'] });
    const apart = await setup({ stock: '2', conditions: ['damaged', 'new'] });
    const both = await deliveredEach(together);
    const { id: one } = await run((ctx) => addInvoice(ctx, { partyId: together.partyId, businessDate: DATE, notes: null, shipTo: null,
      lines: both.lineIds.map((deliveryLineId) => ({ deliveryLineId, qty: q('1') })) }));
    await run((ctx) => postInvoiceNow(ctx, { id: one }));
    const each = await deliveredEach(apart);
    const split: (string | null)[] = [];
    for (const deliveryLineId of each.lineIds) {
      const { id } = await bill(apart, deliveryLineId, '1');
      await run((ctx) => postInvoiceNow(ctx, { id }));
      split.push(...await conditionsOf(id));
    }
    expect([await conditionsOf(one), split]).toEqual([['damaged', null], ['damaged', null]]);
  });

  // An ex-demo unit at a sellable place, still demo, shows "demo" on the draft and once posted, with the line's item; a
  // new unit's line shows nothing. Each delivered event records the unit's own condition (the architect).
  it('answers each invoice line’s item and its units’ condition as they left on the delivery, and a new one none', async () => {
    const demo = await setup({ stock: '1', conditions: ['demo'] });
    const fresh = await setup({ stock: '1', conditions: ['new'] });
    const out = [];
    for (const at of [demo, fresh]) {
      const { lineIds: [deliveryLineId = ''] } = await deliveredEach(at);
      const { id } = await bill(at, deliveryLineId, '1');
      const draft = (await run((ctx) => getInvoiceById(ctx, { id }))).lines[0];
      await run((ctx) => postInvoiceNow(ctx, { id }));
      const posted = (await run((ctx) => getInvoiceById(ctx, { id }))).lines[0];
      const { rows: [event] } = await su.query<{ recorded: string | null; own: string }>(`select e.condition as recorded, u.condition as own
        from radcore.unit_events e join radcore.units u on u.item_id = e.item_id and u.serial_key = upper(e.serial_no)
        where e.kind = 'delivered' and e.sale_line_id = $1`, [deliveryLineId]);
      out.push([draft?.sku === at.sku, draft?.name, draft?.unitCondition, posted?.unitCondition, event?.recorded === event?.own]);
    }
    expect(out).toEqual([[true, 'Scooter', 'demo', 'demo', true], [true, 'Scooter', null, null, true]]);
  });

  // 3 delivered, 1 taken back, 1 invoiced: 1 is still to invoice, in getDelivery and in the to-invoice list. Delivery
  // and return lines answer their item and their batches' numbers, and the delivery's returns are counted by status
  // (auditor-3 on #288; #293).
  it('answers each delivery line’s quantity still to invoice, its item, and the delivery’s returns by status', async () => {
    const at = await setup({ stock: '4' });
    const { deliveryId, deliveryLineId } = await delivered(at, '4', '3');
    const backId = await run(async (ctx) => {
      const { id } = await addDeliveryReturn(ctx, { deliveryId, locationId: at.placeId, businessDate: DATE, notes: null,
        lines: [{ deliveryLineId, qty: q('1'), batches: [{ batchId: at.batchId, qty: q('1') }], serials: [] }] });
      await postDeliveryReturnNow(ctx, { id });
      return id;
    });
    const { id: invoiceId } = await bill(at, deliveryLineId, '1');
    await run((ctx) => postInvoiceNow(ctx, { id: invoiceId }));
    const one = await run((ctx) => getDeliveryById(ctx, { id: deliveryId }));
    const back = await run((ctx) => getDeliveryReturnById(ctx, { id: backId }));
    const counts = await run((ctx) => deliveryReturnCounts(ctx, { deliveryId }));
    const listed = (await run((ctx) => listToInvoicePage(ctx, { limit: 200, filter: { partyId: at.partyId } }))).items
      .find((d) => d.id === deliveryId);
    expect({
      left: one.lines[0]?.qtyToInvoice,
      labels: [one.lines[0]?.sku === at.sku, one.lines[0]?.name, back.lines[0]?.sku === at.sku, back.lines[0]?.name],
      // Each batch picked, by its number, for the return form (#293).
      batches: [one.lines[0]?.batches.map((b) => [b.batchId === at.batchId, b.batchNo]), back.lines[0]?.batches.map((b) => b.batchNo)],
      counts: counts.byStatus, listed: listed?.lines.map((l) => [l.id === deliveryLineId, l.sku === at.sku, l.qtyToInvoice]),
    }).toEqual({ left: '1.000', labels: [true, 'Scooter', true, 'Scooter'], batches: [[[true, 'B1']], ['B1']], counts: { draft: 0, posted: 1, cancelled: 0 },
      listed: [[true, true, '1.000']] });
  });

  // auditor-2 on #289: a refusal the service raises answers by name only if its route declares it (apps/api's handler
  // answers anything else as a 500). Over the real route, a mixed line is the business-rule 422 `mixed_condition`.
  it('answers a mixed delivery line over the real route as 422 mixed_condition, not a 500', async () => {
    const at = await setup({ stock: '2', conditions: ['used', 'new'] });
    const deliveryId = await run(async (ctx) => {
      const { id } = await addOrder(ctx, { partyId: at.partyId, businessDate: DATE, notes: null, lines: lines(at, '2') });
      await confirmOrderNow(ctx, { id });
      const orderLineId = (await getOrderById(ctx, { id })).lines[0]?.id ?? '';
      return (await addDelivery(ctx, { orderId: id, locationId: at.placeId, businessDate: DATE, notes: null,
        lines: [{ orderLineId, qty: q('2'), batches: [{ batchId: at.batchId, qty: q('2') }], serials: at.serials }] })).id;
    });
    const cfg = loadConfig(testSettings(), 'api');
    const server = await listen(createApp(cfg, { info: vi.fn(), error: vi.fn() }, { db, authenticate: async () => staff, routes: salesRoutes }),
      0, '127.0.0.1');
    try {
      const sent = requestFor(postDelivery, { id: deliveryId });
      const res = await fetch(`http://127.0.0.1:${server.port}${sent.path}`, { method: sent.method, body: sent.body ?? null,
        headers: { 'content-type': 'application/json', origin: cfg.publicOrigin, 'sec-fetch-site': 'same-origin', 'idempotency-key': randomUUID() } });
      expect([res.status, ((await res.json()) as { code?: string }).code]).toEqual([422, 'mixed_condition']);
    } finally {
      await server.stop();
    }
  });

  // auditor-2 on #282: a confirmed order's change holds the period first, so with its date locked the change is refused
  // `period_locked`, and the order keeps the total it was confirmed at. Nothing is delivered on it, so the lock alone
  // stops the change (auditor-2 on #289).
  it('refuses a confirmed order’s change in a locked period, and keeps its total', async () => {
    const at = await setup({ stock: '1' });
    const { id: orderId } = await run((ctx) => addOrder(ctx, { partyId: at.partyId, businessDate: DATE, notes: null, lines: lines(at, '2') }));
    await run((ctx) => confirmOrderNow(ctx, { id: orderId }));
    let refused = '';
    await runInTransaction(superDb, WRITE, staff, randomUUID(), async (ctx) => {
      // ADR-006 §1's order, as holdPeriod takes it: the company row, then the period lock (RAD-76: the other way round deadlocked).
      await rawOf(ctx.tx).execute(sql`select id from radcore.company for share`);
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
