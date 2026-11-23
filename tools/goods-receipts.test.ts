// RAD-137 (M4-02; ADR-008 §5, §6, §12, §15; ADR-006 §4a, §5, §6, F2, F21; RC-028, RC-205) on a real PostgreSQL, as the
// runtime login: goods receipts and QC. Each test makes its own supplier, item, places and placed purchase order, then
// its receipts, each in a committed transaction, as the routes run them.
import { randomBytes, randomUUID } from 'node:crypto';
import { addParty, JOURNAL_SERIES, journalEntryById, journalPage, openFinancialYear } from '@radcore/lib-accounts';
import { percentString, quantityString, unitPriceString } from '@radcore/lib-common';
import { putGstRate } from '@radcore/lib-gst';
import { AppError, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import {
  addOrder, addReceipt, cancelOrder, cancelReceiptNow, changeOrder, getOrderById, getReceiptById, placeOrder, postReceipt, RECEIPT_SERIES,
} from '@radcore/lib-purchasing';
import { addCategory, addItem, addPlace } from '@radcore/lib-stock';
import pg from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { turnsHeldBy } from './books-turn.ts';
import { postDocument, SOURCE_TABLE } from './stock-posting.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
// A fixed past day, so no test reads the run date (RC-156).
const DATE = '2026-11-15';
const KEYS = ['purchasing:read', 'purchasing:write', 'inward:write', 'inward:qc', 'parties:write', 'parties:manage', 'items:write',
  'locations:write', 'cost:read', 'gst:write', 'journal:read', 'stock:read'];
const tag = () => randomBytes(3).toString('hex').toUpperCase();
const q = (s: string) => quantityString().parse(s);
const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof AppError ? e.code : String(e)));

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the goods receipt tests must run, not skip');
});

describe.skipIf(!url || !superUrl)('goods receipts and QC', { timeout: 30_000 }, () => {
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  const su = new pg.Pool({ connectionString: superUrl, max: 2 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
    await su.end();
  });

  // A role of the test's own with a PO limit high enough to place at once, so no built-in role another file reads changes.
  const staffWithLimit = async (): Promise<Principal> => {
    const key = `t_${[...randomBytes(10)].map((b) => String.fromCharCode(97 + (b % 26))).join('')}`;
    const c = await su.connect();
    try {
      await c.query('begin');
      await c.query("select set_config('app.principal', 'system:test', true)");
      await c.query("insert into radcore.roles (key, name, description, second_factor_required) values ($1, $1, 'Test', false)", [key]);
      await c.query("insert into radcore.purchase_order_limits (role, max_total) values ($1, '100000000')", [key]);
      await c.query('commit');
    } finally {
      c.release();
    }
    return { kind: 'user', userId: randomUUID(), permissions: KEYS, role: key };
  };
  const run = <T>(fn: (ctx: Ctx) => Promise<T>, as: Principal) => runInTransaction(db, WRITE, as, randomUUID(), fn);

  type Setup = { serialised?: boolean; rate: string; ordered: string; stock?: { qty: string; rate: string; serials?: string[] } };
  /** A supplier, an item at 5% GST, a Stores and a Rejected place, any opening stock at Stores, and a placed PO of
   * `ordered` at `rate`. */
  async function setup(o: Setup) {
    const staff = await staffWithLimit();
    const made = await run(async (ctx) => {
      await openFinancialYear(ctx, DATE);
      const supplier = async () => (await addParty(ctx, { name: `Supplier ${tag()}`, kinds: ['supplier'], gstin: null, pan: null, composition: false,
        stateCode: '27', phone: null, email: null, addressLine1: null, addressLine2: null, city: null, pincode: null })).id;
      const supplierId = await supplier();
      const otherSupplierId = await supplier();
      const { id: categoryId } = await addCategory(ctx, { name: `Test ${tag()}` });
      const hsn = `8711${String(randomBytes(2).readUInt16BE() % 10000).padStart(4, '0')}`;
      await putGstRate(ctx, { hsn, effectiveFrom: DATE, rate: percentString().parse('5'), source: 'Test', note: null, reason: 'Test' });
      const { id: itemId } = await addItem(ctx, { sku: `G-${tag()}`, name: 'Scooter', categoryId, hsn, unit: 'NOS', barcode: null,
        serialised: o.serialised === true, hasChassis: false, purchasePrice: unitPriceString().parse(o.rate) });
      const stores = (await addPlace(ctx, { code: `S${tag()}`, name: `Stores ${tag()}`, kind: 'stores' })).id;
      const rejects = (await addPlace(ctx, { code: `R${tag()}`, name: `Rejected ${tag()}`, kind: 'rejected' })).id;
      if (o.stock !== undefined) {
        await postDocument(ctx, { sourceTable: SOURCE_TABLE, sourceId: randomUUID(), businessDate: DATE, ins: [{ itemId, locationId: stores,
          qty: q(o.stock.qty), rate: unitPriceString().parse(o.stock.rate), batches: [{ batchNo: 'OPEN', qty: q(o.stock.qty) }],
          ...(o.stock.serials === undefined ? {} : { units: o.stock.serials.map((serialNo) => ({ serialNo })) }) }] });
      }
      return { supplierId, otherSupplierId, itemId, stores, rejects };
    }, staff);
    const order = (supplierId: string, qty: string) => run(async (ctx) => {
      const { id } = await addOrder(ctx, { supplierId, businessDate: DATE, expectedBy: null, notes: null,
        lines: [{ itemId: made.itemId, qty: q(qty), rate: unitPriceString().parse(o.rate) }] });
      await placeOrder(ctx, { id });
      return { id, lineId: (await getOrderById(ctx, { id })).lines[0]?.id ?? '' };
    }, staff);
    return { ...made, staff, po: await order(made.supplierId, o.ordered), order };
  }
  type At = Awaited<ReturnType<typeof setup>>;
  const arrive = (at: At, received: string, po = at.po) => run((ctx) => addReceipt(ctx, { orderId: po.id, businessDate: DATE,
    locationId: at.stores, rejectsLocationId: at.rejects, supplierRef: 'DC-1', notes: null, lines: [{ orderLineId: po.lineId, received: q(received) }] }), at.staff);
  type QcIn = Parameters<typeof postReceipt>[1]['lines'][number];
  const inspect = async (at: At, id: string, qc: Omit<QcIn, 'lineId'>) => {
    const lineId = (await run((ctx) => getReceiptById(ctx, { id }), at.staff)).lines[0]?.id ?? '';
    return run((ctx) => postReceipt(ctx, { id, lines: [{ lineId, ...qc }] }), at.staff);
  };
  const onHand = async (itemId: string, locationId: string) => (await pool.query<{ qty: string; value: string }>(`select
    coalesce(sum(case direction when 'in' then qty when 'out' then -qty else 0 end), 0)::numeric(18, 0)::text as qty,
    coalesce(sum(case direction when 'out' then -value else value end), 0)::numeric(18, 2)::text as value
    from radcore.stock_movements where item_id = $1 and location_id = $2`, [itemId, locationId])).rows[0];
  const entryOf = (at: At, receiptId: string) => run(async (ctx) => {
    const page = await journalPage(ctx, { limit: 100, filter: { from: DATE, to: DATE, kind: 'goods_receipt' } });
    const id = page.items.find((e) => e.source.id === receiptId && e.reversesEntryId === null)?.id ?? '';
    return (await journalEntryById(ctx, { id })).lines.map((l) => `${l.account.name} ${l.debit} ${l.credit}`);
  }, at.staff);
  const unitsOf = async (itemId: string) => (await pool.query<{ serial_no: string; ownership: string; condition: string; location_id: string | null }>(
    'select serial_no, ownership, condition, location_id from radcore.units where item_id = $1 order by serial_no', [itemId])).rows;

  // F2 (RC-205): 3 scooters at the order rate of 62,000.00; QC accepts 2 and rejects 1, in one save. The reject is at
  // Rejected, damaged, so Stores averages 61,000.00, not v1's 61,200.00.
  it('posts F2: 2 accepted into Stores and 1 rejected into Rejected, at the PO rate, Cr Goods Received Not Billed', async () => {
    const s = (n: string) => `S-000${n}-${tag()}`;
    const [s1, s2, s3, s4, s5] = ['1', '2', '3', '4', '5'].map(s) as [string, string, string, string, string];
    const at = await setup({ serialised: true, rate: '62000', ordered: '3', stock: { qty: '2', rate: '60000', serials: [s1, s2] } });
    const { id } = await arrive(at, '3');
    const posted = await inspect(at, id, { batches: [{ batchNo: null, accepted: q('2'), rejected: q('1') }], rejectReason: 'Dented panel',
      serials: [{ serialNo: s3, chassisNo: null, batchNo: null, rejected: false }, { serialNo: s4, chassisNo: null, batchNo: null, rejected: false },
        { serialNo: s5, chassisNo: null, batchNo: null, rejected: true }] });
    const r = await run((ctx) => getReceiptById(ctx, { id }), at.staff);
    const o = await run((ctx) => getOrderById(ctx, { id: at.po.id }), at.staff);
    expect(posted.number).toMatch(/^GRN\/\d{2}-\d{2}\/\d{5}$/);
    expect([r.status, r.value, r.lines.map((l) => [l.accepted, l.rejected, l.acceptedValue, l.rejectedValue, l.rejectReason])]).toEqual(['posted',
      '186000.00', [['2.000', '1.000', '124000.00', '62000.00', 'Dented panel']]]);
    expect(await entryOf(at, id)).toEqual(['Stock in Hand 124000.00 0.00', 'Stock in Hand 62000.00 0.00', 'Goods Received Not Billed 0.00 186000.00']);
    expect([await onHand(at.itemId, at.stores), await onHand(at.itemId, at.rejects)]).toEqual([{ qty: '4', value: '244000.00' },
      { qty: '1', value: '62000.00' }]);
    const units = await unitsOf(at.itemId);
    expect(units.filter((u) => [s3, s4, s5].includes(u.serial_no)).map((u) => [u.serial_no, u.condition, u.location_id])).toEqual([[s3, 'new', at.stores],
      [s4, 'new', at.stores], [s5, 'damaged', at.rejects]]);
    // Everything ordered has come in, so the PO is closed.
    expect([o.status, o.lines[0]?.received]).toEqual(['closed', '3.000']);
  });

  // §6: a serial already sold is refused by name, as is one already in stock; one that went back to its supplier comes in.
  it('refuses a sold serial (serial_sold) and one in stock (serial_in_stock)', async () => {
    const [held, sold] = [`S-${tag()}`, `S-${tag()}`];
    const at = await setup({ serialised: true, rate: '62000', ordered: '2', stock: { qty: '2', rate: '60000', serials: [held, sold] } });
    const batchId = (await pool.query<{ id: string }>('select id from radcore.batches where item_id = $1', [at.itemId])).rows[0]?.id ?? '';
    // A sale of it, delivered on a line (RA008), so it's the customer's.
    await run((ctx) => postDocument(ctx, { sourceTable: SOURCE_TABLE, sourceId: randomUUID(), businessDate: DATE, outs: [{ itemId: at.itemId,
      locationId: at.stores, qty: q('1'), sourceLineId: randomUUID(), batches: [{ batchId, qty: q('1') }], units: [{ serialNo: sold }] }] }), at.staff);
    const { id } = await arrive(at, '1');
    const one = (serialNo: string) => code(inspect(at, id, { batches: [{ batchNo: null, accepted: q('1'), rejected: q('0') }], rejectReason: null,
      serials: [{ serialNo, chassisNo: null, batchNo: null, rejected: false }] }));
    expect([await one(sold), await one(held)]).toEqual(['serial_sold', 'serial_in_stock']);
  });

  // F21 and RC-028: one line in the supplier's two lots, and another supplier's own L1, kept apart as two batches; goods
  // that name no lot take the receipt's number as their batch.
  it('receives F21’s lots as the supplier’s batches, two suppliers’ L1 as two, and an unnamed lot under the GRN number', async () => {
    const at = await setup({ rate: '200', ordered: '10' });
    const { id } = await arrive(at, '10');
    await inspect(at, id, { batches: [{ batchNo: 'L1', accepted: q('6'), rejected: q('0') }, { batchNo: 'l-2', accepted: q('4'), rejected: q('0') }],
      rejectReason: null, serials: [] });
    const other = await at.order(at.otherSupplierId, '3');
    const { id: second } = await arrive(at, '3', other);
    const { number } = await inspect(at, second, { batches: [{ batchNo: 'L1', accepted: q('2'), rejected: q('0') },
      { batchNo: null, accepted: q('1'), rejected: q('0') }], rejectReason: null, serials: [] });
    const batches = (await pool.query<{ supplier_id: string; batch_no: string }>(
      'select supplier_id, batch_no from radcore.batches where item_id = $1 order by batch_no, supplier_id', [at.itemId])).rows;
    const who = (b: { supplier_id: string }) => (b.supplier_id === at.supplierId ? 'A' : 'B');
    expect(batches.map((b) => `${who(b)} ${b.batch_no}`).toSorted()).toEqual([`B ${number}`, 'A L1', 'B L1', 'A l-2'].toSorted());
    expect(await entryOf(at, id)).toEqual(['Stock in Hand 2000.00 0.00', 'Goods Received Not Billed 0.00 2000.00']);
  });

  // §5: no more than ordered, counting the PO line's other receipts, drafts included, with no tolerance.
  it('refuses more than ordered (over_ordered), counting the line’s other receipts', async () => {
    const at = await setup({ rate: '200', ordered: '5' });
    const over = await code(arrive(at, '6'));
    await arrive(at, '3');
    expect([over, await code(arrive(at, '3')), await code(arrive(at, '2'))]).toEqual(['over_ordered', 'over_ordered', 'ok']);
  });

  // §6: cancelled by its mirror while nothing on it has moved on, the PO open again and its received back; refused once
  // its goods have gone (receipt_in_use).
  it('cancels a receipt, its PO open again, and refuses once its goods have moved on (receipt_in_use)', async () => {
    const at = await setup({ rate: '200', ordered: '4' });
    const qc = { batches: [{ batchNo: 'L1', accepted: q('4'), rejected: q('0') }], rejectReason: null, serials: [] };
    const { id } = await arrive(at, '4');
    await inspect(at, id, qc);
    const closed = (await run((ctx) => getOrderById(ctx, { id: at.po.id }), at.staff)).status;
    await run((ctx) => cancelReceiptNow(ctx, { id, businessDate: DATE, reason: 'Entered against the wrong order' }), at.staff);
    const o = await run((ctx) => getOrderById(ctx, { id: at.po.id }), at.staff);
    const { id: again } = await arrive(at, '4');
    await inspect(at, again, qc);
    const batch = (await pool.query<{ id: string }>('select id from radcore.batches where item_id = $1', [at.itemId])).rows[0]?.id ?? '';
    await run((ctx) => postDocument(ctx, { sourceTable: SOURCE_TABLE, sourceId: randomUUID(), businessDate: DATE, outs: [{ itemId: at.itemId,
      locationId: at.stores, qty: q('3'), batches: [{ batchId: batch, qty: q('3') }] }] }), at.staff);
    const late = await code(run((ctx) => cancelReceiptNow(ctx, { id: again, businessDate: DATE, reason: 'Too late' }), at.staff));
    expect([closed, o.status, o.lines[0]?.received, (await run((ctx) => getReceiptById(ctx, { id }), at.staff)).status, late])
      .toEqual(['closed', 'placed', '0.000', 'cancelled', 'receipt_in_use']);
  });

  // §5 and #340's owed check: a placed PO keeps what has come in: no line below it, and no cancelling once goods came.
  it('keeps a PO line at or above what has come in (po_received), and refuses to cancel it once goods have', async () => {
    const at = await setup({ rate: '200', ordered: '5' });
    const { id } = await arrive(at, '3');
    await inspect(at, id, { batches: [{ batchNo: null, accepted: q('3'), rejected: q('0') }], rejectReason: null, serials: [] });
    const change = (qty: string) => code(run((ctx) => changeOrder(ctx, { id: at.po.id, supplierId: at.supplierId, businessDate: DATE,
      expectedBy: null, notes: null, lines: [{ itemId: at.itemId, qty: q(qty), rate: unitPriceString().parse('200') }] }), at.staff));
    const below = await change('2');
    const fine = await change('4');
    const lineAfter = (await run((ctx) => getOrderById(ctx, { id: at.po.id }), at.staff)).lines[0];
    expect([below, fine, lineAfter?.id, lineAfter?.qty, await code(run((ctx) => cancelOrder(ctx, { id: at.po.id, reason: 'Not needed' }), at.staff))])
      .toEqual(['po_received', 'ok', at.po.lineId, '4.000', 'po_received']);
  });

  // ADR-006 §1 for a document whose number names a batch (the architect on RAD-141): while another save holds the item's
  // stock, the receipt waits on it holding neither the journal's turn nor GRN's.
  it('waits for its stock before it takes the journal and GRN turns', async () => {
    const at = await setup({ rate: '200', ordered: '2', stock: { qty: '1', rate: '200' } });
    const { id } = await arrive(at, '2');
    const lineId = (await run((ctx) => getReceiptById(ctx, { id }), at.staff)).lines[0]?.id ?? '';
    const holder = await su.connect();
    try {
      await holder.query('begin');
      await holder.query('select 1 from radcore.stock_positions where item_id = $1 and location_id = $2 for update', [at.itemId, at.stores]);
      const pid = (await holder.query<{ pid: number }>('select pg_backend_pid() pid')).rows[0]?.pid;
      const posting = code(run((ctx) => postReceipt(ctx, { id, lines: [{ lineId, batches: [{ batchNo: null, accepted: q('2'), rejected: q('0') }],
        rejectReason: null, serials: [] }] }), at.staff));
      await vi.waitFor(async () => expect((await su.query<{ n: number }>(
        'select count(*)::int n from pg_stat_activity where $1 = any(pg_blocking_pids(pid))', [pid])).rows[0]?.n).toBe(1), { timeout: 10_000 });
      // The one waiter on this test's own stock row is the receipt: the turns it holds, not whether they're free.
      const waiter = (await su.query<{ pid: number }>('select pid from pg_stat_activity where $1 = any(pg_blocking_pids(pid))', [pid])).rows[0]?.pid;
      const held = await turnsHeldBy(su, waiter, [JOURNAL_SERIES.key, RECEIPT_SERIES.key]);
      await holder.query('commit');
      expect([held, await posting]).toEqual([0, 'ok']);
    } finally {
      await holder.query('rollback').catch(() => undefined);
      holder.release();
    }
  });
});
