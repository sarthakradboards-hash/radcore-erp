// RAD-140 (M4-05; ADR-008 §4, §8, §12, §15; ADR-006 §6, F4; RC-129) on a real PostgreSQL, as the runtime login:
// supplier returns of unbilled rejects. Each test makes its own supplier, item, places and placed PO, receives it with a
// reject, then returns it, each save in a committed transaction, as the routes run them. Bills can't post yet (RAD-138
// PR 3), so every reject here is unbilled; the billed variant and its debit note join when they can.
import { randomBytes, randomUUID } from 'node:crypto';
import { addParty, journalEntryById, journalPage, openFinancialYear } from '@radcore/lib-accounts';
import { percentString, quantityString, unitPriceString } from '@radcore/lib-common';
import { putGstRate } from '@radcore/lib-gst';
import { AppError, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import {
  addOrder, addReceipt, addReturn, cancelReceiptNow, cancelReturnNow, closeOrder, getOrderById, getReceiptById, getReturnById, placeOrder,
  postReceipt, postReturn,
} from '@radcore/lib-purchasing';
import { addCategory, addItem, addPlace } from '@radcore/lib-stock';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
// A fixed past day, so no test reads the run date (RC-156).
const DATE = '2026-11-15';
const KEYS = ['purchasing:read', 'purchasing:write', 'inward:write', 'inward:qc', 'supplier_returns:write', 'parties:write', 'parties:manage',
  'items:write', 'locations:write', 'cost:read', 'gst:write', 'journal:read', 'stock:read'];
const tag = () => randomBytes(3).toString('hex').toUpperCase();
const q = (s: string) => quantityString().parse(s);
const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof AppError ? e.code : String(e)));

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the supplier return tests must run, not skip');
});

describe.skipIf(!url || !superUrl)('supplier returns', { timeout: 30_000 }, () => {
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

  /** F2's start: a serialised scooter ordered 3 at 62,000.00, received with 2 accepted into Stores and S-5 rejected into
   * Rejected; and a second rejects place and another supplier. */
  async function received() {
    const staff = await staffWithLimit();
    const serials = ['3', '4', '5'].map((n) => `S-000${n}-${tag()}`) as [string, string, string];
    const made = await run(async (ctx) => {
      await openFinancialYear(ctx, DATE);
      const supplier = async () => (await addParty(ctx, { name: `Supplier ${tag()}`, kinds: ['supplier'], gstin: null, pan: null, composition: false,
        stateCode: '27', phone: null, email: null, addressLine1: null, addressLine2: null, city: null, pincode: null })).id;
      const supplierId = await supplier();
      const otherSupplierId = await supplier();
      const { id: categoryId } = await addCategory(ctx, { name: `Test ${tag()}` });
      const hsn = `8711${String(randomBytes(2).readUInt16BE() % 10000).padStart(4, '0')}`;
      await putGstRate(ctx, { hsn, effectiveFrom: DATE, rate: percentString().parse('5'), source: 'Test', note: null, reason: 'Test' });
      const { id: itemId } = await addItem(ctx, { sku: `R-${tag()}`, name: 'Scooter', categoryId, hsn, unit: 'NOS', barcode: null,
        serialised: true, hasChassis: false, purchasePrice: unitPriceString().parse('62000') });
      const stores = (await addPlace(ctx, { code: `S${tag()}`, name: `Stores ${tag()}`, kind: 'stores' })).id;
      const rejects = (await addPlace(ctx, { code: `R${tag()}`, name: `Rejected ${tag()}`, kind: 'rejected' })).id;
      const { id: poId } = await addOrder(ctx, { supplierId, businessDate: DATE, expectedBy: null, notes: null,
        lines: [{ itemId, qty: q('3'), rate: unitPriceString().parse('62000') }] });
      await placeOrder(ctx, { id: poId });
      const poLineId = (await getOrderById(ctx, { id: poId })).lines[0]?.id ?? '';
      return { supplierId, otherSupplierId, itemId, stores, rejects, poId, poLineId };
    }, staff);
    const receive = async (qty: string, accepted: string[], rejected: string[]) => {
      const { id } = await run((ctx) => addReceipt(ctx, { orderId: made.poId, businessDate: DATE, locationId: made.stores,
        rejectsLocationId: made.rejects, supplierRef: null, notes: null, lines: [{ orderLineId: made.poLineId, received: q(qty) }] }), staff);
      const lineId = (await run((ctx) => getReceiptById(ctx, { id }), staff)).lines[0]?.id ?? '';
      await run((ctx) => postReceipt(ctx, { id, lines: [{ lineId, batches: [{ batchNo: 'L1', accepted: q(String(accepted.length)),
        rejected: q(String(rejected.length)) }], rejectReason: rejected.length > 0 ? 'Dented panel' : null,
        serials: [...accepted.map((s) => ({ serialNo: s, chassisNo: null, batchNo: 'L1', rejected: false })),
          ...rejected.map((s) => ({ serialNo: s, chassisNo: null, batchNo: 'L1', rejected: true }))] }] }), staff);
      return { id, lineId };
    };
    const receipt = await receive('3', [serials[0], serials[1]], [serials[2]]);
    const batchId = (await pool.query<{ id: string }>('select id from radcore.batches where item_id = $1 and supplier_id = $2',
      [made.itemId, made.supplierId])).rows[0]?.id ?? '';
    return { ...made, staff, serials, receipt, batchId, receive };
  }
  type At = Awaited<ReturnType<typeof received>>;
  const draft = (at: At, o: { qty?: string; serials?: string[]; supplierId?: string; locationId?: string; batchId?: string } = {}) =>
    run((ctx) => addReturn(ctx, { supplierId: o.supplierId ?? at.supplierId, businessDate: DATE, locationId: o.locationId ?? at.rejects,
      reason: 'Dented in transit', notes: null, lines: [{ receiptLineId: at.receipt.lineId, qty: q(o.qty ?? '1'),
        batches: [{ batchId: o.batchId ?? at.batchId, qty: q(o.qty ?? '1') }], serials: o.serials ?? [at.serials[2]] }] }), at.staff);
  const onHand = async (itemId: string, locationId: string) => (await pool.query<{ qty: string; value: string }>(`select
    coalesce(sum(case direction when 'in' then qty when 'out' then -qty else 0 end), 0)::numeric(18, 0)::text as qty,
    coalesce(sum(case direction when 'out' then -value else value end), 0)::numeric(18, 2)::text as value
    from radcore.stock_movements where item_id = $1 and location_id = $2`, [itemId, locationId])).rows[0];
  const entryOf = (at: At, id: string) => run(async (ctx) => {
    const page = await journalPage(ctx, { limit: 100, filter: { from: DATE, to: DATE, kind: 'supplier_return' } });
    const entry = page.items.find((e) => e.source.id === id && e.reversesEntryId === null)?.id ?? '';
    return (await journalEntryById(ctx, { id: entry })).lines.map((l) => `${l.account.name} ${l.debit} ${l.credit}`);
  }, at.staff);
  const unit = async (serialNo: string) => (await pool.query<{ ownership: string; condition: string; location_id: string | null }>(
    'select ownership, condition, location_id from radcore.units where serial_no = $1', [serialNo])).rows[0];
  const order = (at: At) => run((ctx) => getOrderById(ctx, { id: at.poId }), at.staff);

  // F4 (RC-129): the unbilled reject back at its value, Dr Goods Received Not Billed, Cr Stock in Hand; its unit gone. The
  // return takes it off the PO line (Sarthak, 23 Nov), so the PO its receipt closed opens for the replacement, which
  // comes in on the same PO and closes it again.
  it('posts F4, reopens the PO, and takes the replacement on the same PO', async () => {
    const at = await received();
    const closed = (await order(at)).status;
    const { id } = await draft(at);
    const posted = await run((ctx) => postReturn(ctx, { id }), at.staff);
    const r = await run((ctx) => getReturnById(ctx, { id }), at.staff);
    const reopened = await order(at);
    expect(posted).toEqual({ number: expect.stringMatching(/^SR\/\d{2}-\d{2}\/\d{5}$/) as string, debitNoteNumber: null });
    expect([r.status, r.unbilledValue, r.lines.map((l) => [l.qty, l.unbilledQty, l.unbilledValue, l.billed.length])])
      .toEqual(['posted', '62000.00', [['1.000', '1.000', '62000.00', 0]]]);
    expect(await entryOf(at, id)).toEqual(['Goods Received Not Billed 62000.00 0.00', 'Stock in Hand 0.00 62000.00']);
    expect([await onHand(at.itemId, at.rejects), await unit(at.serials[2])]).toEqual([{ qty: '0', value: '0.00' },
      { ownership: 'gone', condition: 'damaged', location_id: null }]);
    expect([closed, reopened.status, reopened.lines[0]?.received]).toEqual(['closed', 'placed', '2.000']);
    await at.receive('1', [`S-0006-${tag()}`], []);
    expect((await order(at)).status).toBe('closed');
  });

  // The architect on RAD-140 (F4's second variant): Rejected holds A's reject at 62,000.00 and B's at 60,000.00. Each goes
  // out at the place's average, 61,000.00, while Goods Received Not Billed gets back what each receipt accrued; the
  // difference goes to Cost of Goods Sold, and nets to nothing once both are back.
  it('returns rejects of two rates at the place’s average, GRNI at each receipt’s rate, the difference to COGS', async () => {
    const at = await received();
    const sB = `S-0008-${tag()}`;
    const b = await run(async (ctx) => {
      const { id: poId } = await addOrder(ctx, { supplierId: at.supplierId, businessDate: DATE, expectedBy: null, notes: null,
        lines: [{ itemId: at.itemId, qty: q('1'), rate: unitPriceString().parse('60000') }] });
      await placeOrder(ctx, { id: poId });
      const orderLineId = (await getOrderById(ctx, { id: poId })).lines[0]?.id ?? '';
      const { id } = await addReceipt(ctx, { orderId: poId, businessDate: DATE, locationId: at.stores, rejectsLocationId: at.rejects,
        supplierRef: null, notes: null, lines: [{ orderLineId, received: q('1') }] });
      const lineId = (await getReceiptById(ctx, { id })).lines[0]?.id ?? '';
      await postReceipt(ctx, { id, lines: [{ lineId, batches: [{ batchNo: 'L1', accepted: q('0'), rejected: q('1') }], rejectReason: 'Scratched',
        serials: [{ serialNo: sB, chassisNo: null, batchNo: 'L1', rejected: true }] }] });
      return { lineId };
    }, at.staff);
    const { id: first } = await draft(at);
    await run((ctx) => postReturn(ctx, { id: first }), at.staff);
    const { id: second } = await run((ctx) => addReturn(ctx, { supplierId: at.supplierId, businessDate: DATE, locationId: at.rejects,
      reason: 'Scratched', notes: null, lines: [{ receiptLineId: b.lineId, qty: q('1'), batches: [{ batchId: at.batchId, qty: q('1') }],
        serials: [sB] }] }), at.staff);
    await run((ctx) => postReturn(ctx, { id: second }), at.staff);
    expect([await entryOf(at, first), await entryOf(at, second)]).toEqual([
      ['Goods Received Not Billed 62000.00 0.00', 'Stock in Hand 0.00 61000.00', 'Cost of Goods Sold 0.00 1000.00'],
      ['Goods Received Not Billed 60000.00 0.00', 'Stock in Hand 0.00 61000.00', 'Cost of Goods Sold 1000.00 0.00']]);
    expect([await onHand(at.itemId, at.rejects), (await run((ctx) => getReturnById(ctx, { id: first }), at.staff)).unbilledValue])
      .toEqual([{ qty: '0', value: '0.00' }, '62000.00']);
  });

  // RC-129: a return is undone. Its mirror puts the reject back at Rejected at its value, the unit `received` there, and
  // the PO line's count back up, closing the PO again.
  it('cancels a return: the reject, its unit and the PO as they were', async () => {
    const at = await received();
    const { id } = await draft(at);
    await run((ctx) => postReturn(ctx, { id }), at.staff);
    await run((ctx) => cancelReturnNow(ctx, { id, businessDate: DATE, reason: 'The supplier refused it' }), at.staff);
    const o = await order(at);
    expect([(await run((ctx) => getReturnById(ctx, { id }), at.staff)).status, await onHand(at.itemId, at.rejects), await unit(at.serials[2]),
      o.status, o.lines[0]?.received]).toEqual(['cancelled', { qty: '1', value: '62000.00' },
      { ownership: 'ours', condition: 'damaged', location_id: at.rejects }, 'closed', '3.000']);
  });

  // Once the replacement is in, undoing the return would leave the PO line holding more than it ordered.
  it('refuses to cancel a return once its replacement came in on the PO (replacement_received)', async () => {
    const at = await received();
    const { id } = await draft(at);
    await run((ctx) => postReturn(ctx, { id }), at.staff);
    await at.receive('1', [`S-0007-${tag()}`], []);
    expect(await code(run((ctx) => cancelReturnNow(ctx, { id, businessDate: DATE, reason: 'Too late' }), at.staff))).toBe('replacement_received');
  });

  // A PO closed short with a reason stays closed: no replacement is coming.
  it('leaves a PO closed short closed when its rejects go back', async () => {
    const at = await received();
    // Received 3 of 3, then returned: the PO is closed by its receipts; closing short applies to one still open.
    const { id } = await draft(at);
    await run((ctx) => postReturn(ctx, { id }), at.staff);
    await run((ctx) => closeOrder(ctx, { id: at.poId, reason: 'No replacement coming' }), at.staff);
    await run((ctx) => cancelReturnNow(ctx, { id, businessDate: DATE, reason: 'Entered in error' }), at.staff);
    const { id: again } = await draft(at);
    await run((ctx) => postReturn(ctx, { id: again }), at.staff);
    const o = await order(at);
    expect([o.status, o.closedReason]).toEqual(['closed', 'No replacement coming']);
  });

  // §8: each line is its own receipt line's, its supplier's, from a rejects place, never more than came in on it less what
  // other returns sent; and a receipt whose goods went back can't be cancelled.
  it('refuses another supplier, a sellable place, another batch, and more than came in; and the receipt’s cancel once returned', async () => {
    const at = await received();
    const other = await code(draft(at, { supplierId: at.otherSupplierId }));
    const shelf = await code(draft(at, { locationId: at.stores }));
    const batch = await code(draft(at, { batchId: randomUUID() }));
    const more = await code(draft(at, { qty: '4', serials: [at.serials[2], 'X1', 'X2', 'X3'] }));
    const { id } = await draft(at);
    // A second draft counts the first, drafts included: 3 came in, so 3 more on top of the first 1 is too many.
    const twice = await code(draft(at, { qty: '3', serials: [at.serials[0], at.serials[1], at.serials[2]] }));
    await run((ctx) => postReturn(ctx, { id }), at.staff);
    const inUse = await code(run((ctx) => cancelReceiptNow(ctx, { id: at.receipt.id, businessDate: DATE, reason: 'Wrong order' }), at.staff));
    expect([other, shelf, batch, more, twice, inUse]).toEqual(['other_supplier', 'not_a_rejects_place', 'unknown_batch', 'over_received',
      'over_received', 'receipt_in_use']);
  });
});
