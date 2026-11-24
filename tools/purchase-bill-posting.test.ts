// RAD-138 PR 3 (M4-03; ADR-008 §7, §7a, §12, §15; ADR-006 §4, §6, F2, F3; RC-023, RC-056, RC-172) on a real PostgreSQL,
// as the runtime login: posting purchase bills. Each test makes its own supplier (registered, so its input GST is
// claimed), item at 5%, places, opening stock, placed PO and posted goods receipt, then bills it. Goods Received Not
// Billed is cleared by exactly what was accrued, accepted goods first; the price difference goes to stock across the
// sellable places holding the item, and to cost of goods sold for what's gone; a line past the tolerance waits for
// someone else's approval under bills:approve, which posts it.
import { randomBytes, randomUUID } from 'node:crypto';
import { addParty, allocatePayment, JOURNAL_SERIES, journalEntryById, journalPage, openFinancialYear, recordPayment } from '@radcore/lib-accounts';
import { gstinCheckChar, moneyString, percentString, quantityString, unitPriceString } from '@radcore/lib-common';
import { putGstRate } from '@radcore/lib-gst';
import { AppError, decideApproval, loadConfig, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import {
  addBill, addOrder, addReceipt, addReturn, BILL_SERIES, grniByReceiptLine, billApproval, cancelBillNow, cancelReceiptNow, getBillById, getOrderById, getReceiptById, placeOrder, postBillNow,
  postReceipt, postReturn,
} from '@radcore/lib-purchasing';
import { addCategory, addItem, addPlace, requalifyTransfer } from '@radcore/lib-stock';
import { testSettings } from '@radcore/test-helpers';
import pg from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { turnsHeldBy } from './books-turn.ts';
import { createApp, listen } from '../apps/api/src/app.ts';
import purchasingRoutes from '../apps/api/src/routes/purchasing.ts';
import { postDocument, SOURCE_TABLE } from './stock-posting.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
// A fixed past day, so no test reads the run date (RC-156).
const DATE = '2026-11-15';
const KEYS = ['purchasing:read', 'purchasing:write', 'inward:write', 'inward:qc', 'bills:write', 'parties:write', 'parties:manage', 'items:write',
  'locations:write', 'cost:read', 'gst:write', 'journal:read', 'stock:read',
  'supplier_returns:write', 'payments:read', 'payments:write'];
const tag = () => randomBytes(3).toString('hex').toUpperCase();
const q = (s: string) => quantityString().parse(s);
const letters = (n: number) => [...randomBytes(n)].map((b) => String.fromCharCode(65 + (b % 26))).join('');
const gstin = () => {
  const first14 = `27${letters(3)}C${letters(1)}${String(randomBytes(2).readUInt16BE() % 10000).padStart(4, '0')}${letters(1)}1Z`;
  return `${first14}${gstinCheckChar(first14)}`;
};

describe.skipIf(!url || !superUrl)('posting purchase bills', { timeout: 60_000 }, () => {
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  const su = new pg.Pool({ connectionString: superUrl, max: 2 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
    await su.end();
  });
  const run = <T>(fn: (ctx: Ctx) => Promise<T>, as: Principal) => runInTransaction(db, WRITE, as, randomUUID(), fn);
  const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof AppError ? e.code
    : (e as { cause?: { constraint?: string } }).cause?.constraint ?? String(e)));

  // A person made now, as the approval engine reads their account's age (RAD-38), with a role of the test's own whose PO
  // limit places at once.
  const person = async (permissions: string[], own: string[] = []): Promise<Principal> => {
    const key = `t_${letters(10).toLowerCase()}`;
    const c = await su.connect();
    try {
      await c.query('begin');
      await c.query("select set_config('app.principal', 'system:test', true)");
      await c.query("insert into radcore.roles (key, name, description, second_factor_required) values ($1, $1, 'Test', false)", [key]);
      await c.query("insert into radcore.purchase_order_limits (role, max_total) values ($1, '100000000')", [key]);
      const { rows } = await c.query<{ id: string }>(`insert into radcore.users (email, display_name, role) values ($1, 'Test person', $2) returning id`,
        [`bills-${randomUUID()}@example.test`, key]);
      await c.query('commit');
      return { kind: 'user', userId: rows[0]?.id ?? '', permissions, ownScope: own, role: key };
    } finally {
      c.release();
    }
  };
  const file = async () => {
    const id = randomUUID();
    const c = await su.connect();
    try {
      await c.query('begin');
      await c.query("set local app.principal = 'system:test'");
      await c.query(`insert into radcore.files (id, kind, store_key, filename, content_type, size, status)
        values ($1, 'purchase_bill', $2, 'bill.pdf', 'application/pdf', 2048, 'ready')`, [id, `purchase_bill/${id}`]);
      await c.query('commit');
    } finally {
      c.release();
    }
    return id;
  };

  type Setup = { stock?: Record<string, string>; ordered: string; received: { accepted: string; rejected: string } };
  /** F2's start, by default: SCOOTER at Stores 2 at 60,000.00 each, a PO for 3 at 62,000.00, and a receipt of 3 into Stores
   * of which QC accepts 2 and rejects 1 into Rejected. `stock` puts other opening stock at the named places instead. */
  async function setup(o: Setup = { ordered: '3', received: { accepted: '2', rejected: '1' } }, as?: Principal) {
    const staff = as ?? await person(KEYS);
    const made = await run(async (ctx) => {
      await openFinancialYear(ctx, DATE);
      const supplierGstin = gstin();
      const { id: supplierId } = await addParty(ctx, { name: `Supplier ${tag()}`, kinds: ['supplier'], gstin: supplierGstin, pan: null, composition: false,
        stateCode: '27', phone: null, email: null, addressLine1: null, addressLine2: null, city: null, pincode: null });
      const { id: categoryId } = await addCategory(ctx, { name: `Test ${tag()}` });
      const hsn = `8711${String(randomBytes(2).readUInt16BE() % 10000).padStart(4, '0')}`;
      await putGstRate(ctx, { hsn, effectiveFrom: '2026-04-01', rate: percentString().parse('5'), source: 'Test', note: null, reason: 'Test' });
      await putGstRate(ctx, { hsn: '9965', effectiveFrom: '2026-04-01', rate: percentString().parse('18'), source: 'Test', note: null, reason: 'Test' })
        .catch(() => undefined);
      const { id: itemId } = await addItem(ctx, { sku: `F-${tag()}`, name: 'Scooter', categoryId, hsn, unit: 'NOS', barcode: null, serialised: false,
        hasChassis: false, purchasePrice: unitPriceString().parse('62000') });
      const place = async (kind: string) => (await addPlace(ctx, { code: `${kind.slice(0, 2).toUpperCase()}${tag()}`, name: `${kind} ${tag()}`,
        kind: kind as 'stores' })).id;
      const places = { stores: await place('stores'), store: await place('store'), rejected: await place('rejected') };
      const stock = o.stock ?? { stores: '2' };
      const ins = Object.entries(stock).filter(([, n]) => n !== '0').map(([k, n]) => ({ itemId, locationId: places[k as 'stores'], qty: q(n),
        rate: unitPriceString().parse('60000'), batches: [{ batchNo: 'OPEN', qty: q(n) }] }));
      if (ins.length > 0) await postDocument(ctx, { sourceTable: SOURCE_TABLE, sourceId: randomUUID(), businessDate: DATE, ins });
      return { supplierId, supplierGstin, itemId, places };
    }, staff);
    // The order and receipt in a transaction of their own, so the opening stock's journal turn isn't held while the PO
    // draws its number: other files' setups take the PO's turn, then the journal's.
    const { supplierId, itemId, places } = made;
    const bought = await run(async (ctx) => {
      const { id: orderId } = await addOrder(ctx, { supplierId, businessDate: DATE, expectedBy: null, notes: null,
        lines: [{ itemId, qty: q(o.ordered), rate: unitPriceString().parse('62000') }] });
      await placeOrder(ctx, { id: orderId });
      const poLineId = (await getOrderById(ctx, { id: orderId })).lines[0]?.id ?? '';
      const received = dec2(o.received.accepted, o.received.rejected);
      const { id: receiptId } = await addReceipt(ctx, { orderId, businessDate: DATE, locationId: places.stores, rejectsLocationId: places.rejected,
        supplierRef: 'DC-1', notes: null, lines: [{ orderLineId: poLineId, received: q(received) }] });
      const receiptLineId = (await getReceiptById(ctx, { id: receiptId })).lines[0]?.id ?? '';
      await postReceipt(ctx, { id: receiptId, lines: [{ lineId: receiptLineId, batches: [{ batchNo: null, accepted: q(o.received.accepted),
        rejected: q(o.received.rejected) }], serials: [], rejectReason: o.received.rejected === '0' ? null : 'Dented panel' }] });
      return { orderId, poLineId, receiptId, receiptLineId };
    }, staff);
    return { ...made, ...bought, staff };
  }
  const dec2 = (a: string, b: string) => String(Number(a) + Number(b));
  type At = Awaited<ReturnType<typeof setup>>;
  const goods = (at: At, qty: string, rate: string, receiptLineId: string | null = at.receiptLineId) => ({ kind: 'goods' as const, poLineId: at.poLineId,
    receiptLineId, qty: q(qty), rate: unitPriceString().parse(rate) });
  const freight = (amount: string) => ({ kind: 'charge' as const, charge: 'freight' as const, description: 'Freight', hsn: '9965',
    amount: moneyString().parse(amount) });
  const draft = async (at: At, o: { lines: ReturnType<typeof goods | typeof freight>[]; total: string; file?: boolean; number?: string },
    as: Principal = at.staff) => {
    const fileId = o.file === false ? null : await file();
    return run((ctx) => addBill(ctx, { supplierId: at.supplierId, businessDate: DATE, supplierInvoiceNumber: o.number ?? `INV/${tag()}`,
      supplierInvoiceDate: DATE, supplierGstin: at.supplierGstin, statedTotal: moneyString().parse(o.total), fileId, notes: null, lines: o.lines }), as);
  };
  const post = (at: At, id: string, as: Principal = at.staff) => run((ctx) => postBillNow(ctx, { id }), as);
  const position = async (itemId: string, locationId: string) => (await pool.query<{ qty: string; value: string }>(`select
    coalesce(sum(case direction when 'in' then qty when 'out' then -qty else 0 end), 0)::numeric(18, 0)::text as qty,
    coalesce(sum(case direction when 'out' then -value else value end), 0)::numeric(18, 2)::text as value
    from radcore.stock_movements where item_id = $1 and location_id = $2`, [itemId, locationId])).rows[0];
  const entryOf = (at: At, billId: string) => run(async (ctx) => {
    const page = await journalPage(ctx, { limit: 100, filter: { from: DATE, to: DATE, kind: 'purchase_bill' } });
    const id = page.items.find((e) => e.source.id === billId && e.reversesEntryId === null)?.id ?? '';
    return (await journalEntryById(ctx, { id })).lines.map((l) => `${l.account.name} ${l.debit} ${l.credit}`).sort();
  }, at.staff);
  const grni = async (at: At, more: string[] = []) => (await pool.query<{ v: string }>(`select coalesce(sum(l.credit - l.debit), 0)::numeric(18, 2)::text as v
    from radcore.journal_lines l join radcore.accounts a on a.id = l.account_id join radcore.journal_entries e on e.id = l.entry_id
    where a.system_key = 'grni' and e.source_id = any($1::uuid[])`, [[at.receiptId, ...more, ...(await billIds(at))]])).rows[0]?.v;
  const billIds = async (at: At) => (await pool.query<{ id: string }>('select id from radcore.purchase_bills where party_id = $1', [at.supplierId]))
    .rows.map((r) => r.id);

  // F3: the 2 accepted billed at 62,500.00 against 62,000.00 accrued; Stores holds 4, at least the 2, so all 1,000.00
  // goes to stock there. Goods Received Not Billed is left with the reject's 62,000.00 (F4's start).
  it('posts F3: Dr GRNB 124,000.00, Stock 1,000.00, Input GST 3,125.00 each, Cr Creditors 131,250.00, numbered PB', async () => {
    const at = await setup();
    const { id } = await draft(at, { lines: [goods(at, '2', '62500')], total: '131250' });
    const posted = await post(at, id);
    expect([posted.status, posted.number]).toEqual(['posted', expect.stringMatching(/^PB\/\d{2}-\d{2}\/\d{5}$/) as unknown]);
    expect(await entryOf(at, id)).toEqual([`Creditors 0.00 131250.00`, `Goods Received Not Billed 124000.00 0.00`, `Input CGST 3125.00 0.00`,
      `Input SGST 3125.00 0.00`, `Stock in Hand 1000.00 0.00`].sort());
    expect(await position(at.itemId, at.places.stores)).toEqual({ qty: '4', value: '245000.00' });
    expect(await grni(at)).toBe('62000.00');
    const b = await run((ctx) => getBillById(ctx, { id }), at.staff);
    expect([b.status, b.total, b.amounts.cgst]).toEqual(['posted', '131250.00', '3125.00']);
  });

  it('posts F3’s variants: 1 held of the 2 billed splits 500.00 to stock and 500.00 to COGS; Stores 1 and Store 3 take 250.00 and 750.00', async () => {
    const one = await setup({ stock: {}, ordered: '3', received: { accepted: '2', rejected: '1' } });
    // The 2 accepted came into Stores; one has gone since, so 1 is held of the 2 billed.
    const batchId = (await pool.query<{ id: string }>('select id from radcore.batches where item_id = $1 limit 1', [one.itemId])).rows[0]?.id ?? null;
    await run((ctx) => postDocument(ctx, { sourceTable: SOURCE_TABLE, sourceId: randomUUID(), businessDate: DATE, outs: [{ itemId: one.itemId,
      locationId: one.places.stores, qty: q('1'), batches: [{ batchId, qty: q('1') }] }] }), one.staff);
    const { id } = await draft(one, { lines: [goods(one, '2', '62500')], total: '131250' });
    await post(one, id);
    expect((await entryOf(one, id)).filter((l) => l.startsWith('Stock in Hand') || l.startsWith('Cost of Goods Sold')))
      .toEqual(['Cost of Goods Sold 500.00 0.00', 'Stock in Hand 500.00 0.00']);
    const spread = await setup({ stock: { store: '3' }, ordered: '3', received: { accepted: '2', rejected: '1' } });
    const { id: b2 } = await draft(spread, { lines: [goods(spread, '2', '62500')], total: '131250' });
    await post(spread, b2);
    // Stores holds the 2 accepted (in at 124,000.00) and Store 3 (at 180,000.00): 4,000 split 2:3 of 5 is 400.00 and 600.00.
    expect([(await position(spread.itemId, spread.places.stores))?.value, (await position(spread.itemId, spread.places.store))?.value])
      .toEqual(['124400.00', '180600.00']);
  });

  it('leaves the reject unbilled when only the accepted are billed, and clears GRNB exactly when the reject is billed after', async () => {
    const at = await setup();
    const { id } = await draft(at, { lines: [goods(at, '2', '62000')], total: '130200' });
    await post(at, id);
    expect(await grni(at)).toBe('62000.00');
    // The reject billed at its own rate: its difference (0 here) onto Rejected, and GRNB at exactly 0.
    const { id: rest } = await draft(at, { lines: [goods(at, '1', '62000')], total: '65100' });
    await post(at, rest);
    expect(await grni(at)).toBe('0.00');
    // Nothing is left on that receipt line: one more is over_received.
    const { id: more } = await draft(at, { lines: [goods(at, '1', '62000')], total: '65100' });
    expect(await code(post(at, more))).toBe('over_received');
  });

  it('bills a receipt line less the rejects returned before it was billed, and GRNB ends at exactly 0 (ADR-008 §7)', async () => {
    const at = await setup({ stock: {}, ordered: '4', received: { accepted: '2', rejected: '2' } });
    const batchId = (await pool.query<{ id: string }>('select id from radcore.batches where item_id = $1 limit 1', [at.itemId])).rows[0]?.id ?? '';
    const { id: back } = await run((ctx) => addReturn(ctx, { supplierId: at.supplierId, businessDate: DATE, locationId: at.places.rejected,
      reason: 'Dented', notes: null, lines: [{ receiptLineId: at.receiptLineId, qty: q('1'), batches: [{ batchId, qty: q('1') }], serials: [] }] }),
    at.staff);
    await run((ctx) => postReturn(ctx, { id: back }), at.staff);
    // 4 came in and 1 went back: 4 is over_received, 3 posts.
    const { id: all } = await draft(at, { lines: [goods(at, '4', '62000')], total: '260400' });
    expect(await code(post(at, all))).toBe('over_received');
    const { id } = await draft(at, { lines: [goods(at, '3', '62000')], total: '195300' });
    await post(at, id);
    expect(await grni(at, [back])).toBe('0.00');
    // The books check's figures for that receipt line (RAD-95): 248,000.00 accrued, all of it cleared by the return and bill.
    expect((await run((ctx) => grniByReceiptLine(ctx), at.staff)).filter((l) => l.receiptLineId === at.receiptLineId))
      .toEqual([{ receiptLineId: at.receiptLineId, accrued: '248000.00', open: '0.00' }]);
  });

  // The architect on RAD-143: the bill list's open amount and `open` filter, for applying a payment out on screen. F3's
  // bill (131,250.00) with 100,000.00 of a payment allocated to it reads 31,250.00 open, through the real route; paid in
  // full, it leaves the open list; a draft is never on it.
  it('lists a supplier’s open bills with what is left to pay on each, through the route', async () => {
    const at = await setup();
    const { id } = await draft(at, { lines: [goods(at, '2', '62500')], total: '131250' });
    await post(at, id);
    await draft(at, { lines: [goods(at, '1', '62000')], total: '65100' });
    const bank = (await su.query<{ id: string }>("select id from radcore.accounts where system_key = 'bank'")).rows[0]?.id ?? '';
    const pay = (amount: string) => run(async (ctx) => {
      const { id: paymentId } = await recordPayment(ctx, { kind: 'payment', partyId: at.supplierId, businessDate: DATE, amount: moneyString().parse(amount),
        accountId: bank });
      await allocatePayment(ctx, { id: paymentId, businessDate: DATE, lines: [{ documentTable: 'purchase_bills', documentId: id,
        amount: moneyString().parse(amount) }] });
    }, at.staff);
    await pay('100000');
    const config = loadConfig(testSettings(), 'api');
    const app = createApp(config, { info: () => undefined, error: () => undefined }, { db, authenticate: async () => at.staff, routes: purchasingRoutes });
    const server = await listen(app, 0, '127.0.0.1');
    try {
      const list = async (filter: object) => {
        const res = await fetch(`http://127.0.0.1:${server.port}/purchasing/bills?input=${encodeURIComponent(JSON.stringify({ filter, limit: 50 }))}`,
          { headers: { origin: config.publicOrigin } });
        expect(res.status).toBe(200);
        return ((await res.json()) as { items: { id: string; status: string; open: string | null }[] }).items;
      };
      const all = await list({ supplierId: at.supplierId });
      expect(all.map((b) => [b.status, b.open]).sort()).toEqual([['draft', null], ['posted', '31250.00']]);
      expect((await list({ supplierId: at.supplierId, open: true })).map((b) => [b.id, b.open])).toEqual([[id, '31250.00']]);
      const page = await fetch(`http://127.0.0.1:${server.port}/purchasing/bills/${id}`, { headers: { origin: config.publicOrigin } });
      expect(((await page.json()) as { open: string }).open).toBe('31250.00');
      await pay('31250');
      expect(await list({ supplierId: at.supplierId, open: true })).toEqual([]);
    } finally {
      await server.stop();
    }
  });

  it('waits for bills:approve on a line 2.01% over its PO rate, posts one 2.00% over, and someone else’s approval posts it', async () => {
    const at = await setup();
    const approver = await person(['purchasing:read', 'bills:approve']);
    const { id: within } = await draft(at, { lines: [goods(at, '1', '63240')], total: '66402' });
    expect((await post(at, within)).status).toBe('posted');
    const { id: over } = await draft(at, { lines: [goods(at, '1', '63246.20')], total: '66409' });
    const asked = await post(at, over);
    expect([asked.status, asked.number]).toEqual(['pending_approval', null]);
    expect((await run((ctx) => getBillById(ctx, { id: over }), at.staff)).awaitingApproval).toBe(true);
    expect(await code(run((ctx) => decideApproval(ctx, billApproval, asked.approvalId ?? '', { decision: 'approve',
      versionHash: asked.versionHash ?? '' }), at.staff))).toBe('own_request');
    await run((ctx) => decideApproval(ctx, billApproval, asked.approvalId ?? '', { decision: 'approve', versionHash: asked.versionHash ?? '' }), approver);
    expect((await run((ctx) => getBillById(ctx, { id: over }), at.staff)).status).toBe('posted');
  });

  it('spreads freight over the goods into the price difference, within the tolerance', async () => {
    const at = await setup();
    // 2 at the PO rate, and 1,000.00 freight (0.8% of the goods) at 18%: the freight is the whole difference, to stock.
    const { id } = await draft(at, { lines: [goods(at, '2', '62000'), freight('1000')], total: '131380' });
    expect((await post(at, id)).status).toBe('posted');
    expect(await position(at.itemId, at.places.stores)).toEqual({ qty: '4', value: '245000.00' });
  });

  it('refuses a bill with no file, one naming no receipt yet, and a stated total that doesn’t match', async () => {
    const at = await setup();
    const { id: noFile } = await draft(at, { lines: [goods(at, '2', '62000')], total: '130200', file: false });
    expect(await code(post(at, noFile))).toBe('bill_file_required');
    const { id: early } = await draft(at, { lines: [goods(at, '2', '62000', null)], total: '130200' });
    expect(await code(post(at, early))).toBe('goods_not_received');
    expect((await run((ctx) => getBillById(ctx, { id: early }), at.staff)).status).toBe('draft');
    const { id: wrong } = await draft(at, { lines: [goods(at, '2', '62000')], total: '130500' });
    expect(await code(post(at, wrong))).toBe('total_mismatch');
  });

  it('stops an own-scope person billing past what a colleague’s posted bill has billed of the same receipt line', async () => {
    // The PO and receipt are the own-scope person's; a colleague at all scope bills all 3 first, out of their sight.
    const own = await person(KEYS, ['purchasing:read', 'bills:write']);
    const at = await setup(undefined, own);
    const colleague = await person(KEYS);
    const { id } = await draft(at, { lines: [goods(at, '3', '62000')], total: '195300' }, colleague);
    await post(at, id, colleague);
    // Still counted for them (billed.ts reads every posted bill): one more is over_received.
    const { id: second } = await draft(at, { lines: [goods(at, '1', '62000')], total: '65100' }, own);
    expect(await code(post(at, second, own))).toBe('over_received');
  });

  // The auditor on #380: a bill takes its POs FOR SHARE and only its receipts FOR UPDATE, so while another bill on the
  // same PO holds it FOR SHARE (as both do, mid-save), this one still posts: a FOR UPDATE on the receipts' join would also
  // take the PO, wait on that share, and the two bills would deadlock.
  it('posts a bill while another save holds its PO FOR SHARE, as a second bill on that PO does', async () => {
    const at = await setup();
    const { id } = await draft(at, { lines: [goods(at, '2', '62000')], total: '130200' });
    const holder = new pg.Client({ connectionString: superUrl });
    await holder.connect();
    try {
      await holder.query('begin');
      await holder.query('select id from radcore.purchase_orders where id = $1 for share', [at.orderId]);
      expect(await code(post(at, id))).toBe('ok');
      await holder.query('commit');
    } finally {
      await holder.end();
    }
  });

  // The auditor on #380: once the reject has left its rejects place (requalified into Stores, #372), its difference goes
  // where the goods are now, by ADR-006 §4, instead of refusing the bill nothing_to_revalue.
  it('sends a requalified reject’s difference to where it went, not to its emptied rejects place', async () => {
    const at = await setup();
    const batchId = (await pool.query<{ id: string }>(`select b.id from radcore.batches b join radcore.stock_movements m on m.item_id = b.item_id
      where b.item_id = $1 and m.location_id = $2 and b.batch_no <> 'OPEN' limit 1`, [at.itemId, at.places.rejected])).rows[0]?.id ?? null;
    await run((ctx) => requalifyTransfer(ctx, { fromId: at.places.rejected, toId: at.places.stores, businessDate: DATE, reason: 'Panel fixed',
      condition: 'new', lines: [{ itemId: at.itemId, qty: q('1'), batches: [{ batchId, qty: q('1') }], serials: [] }] }), at.staff);
    // All 3 billed at 62,500.00 (0.81% over, within the tolerance): 1,500.00 over what was accrued, all to Stores, which
    // holds the 2 opening, the 2 accepted and the requalified 1.
    const { id } = await draft(at, { lines: [goods(at, '3', '62500')], total: '196875' });
    expect(await code(post(at, id))).toBe('ok');
    expect(await position(at.itemId, at.places.stores)).toEqual({ qty: '5', value: '307500.00' });
    expect(await position(at.itemId, at.places.rejected)).toEqual({ qty: '0', value: '0.00' });
    expect(await grni(at)).toBe('0.00');
  });

  // Sells `qty` from a place, batch by batch, as a delivery would: issued at the average.
  const sell = async (at: At, locationId: string, qty: number) => {
    const { rows } = await pool.query<{ batch_id: string; q: string }>(`select smb.batch_id, sum(case m.direction when 'out' then -smb.qty else smb.qty end)::int::text as q
      from radcore.stock_movement_batches smb join radcore.stock_movements m on m.id = smb.movement_id
      where m.item_id = $1 and m.location_id = $2 group by smb.batch_id having sum(case m.direction when 'out' then -smb.qty else smb.qty end) > 0
      order by smb.batch_id`, [at.itemId, locationId]);
    let left = qty;
    const batches = rows.flatMap((r) => {
      const take = Math.min(left, Number(r.q));
      left -= take;
      return take > 0 ? [{ batchId: r.batch_id, qty: q(String(take)) }] : [];
    });
    await run((ctx) => postDocument(ctx, { sourceTable: SOURCE_TABLE, sourceId: randomUUID(), businessDate: DATE,
      outs: [{ itemId: at.itemId, locationId, qty: q(String(qty)), batches }] }), at.staff);
  };
  const undoneBy = (at: At, billId: string) => run(async (ctx) => {
    const page = await journalPage(ctx, { limit: 100, filter: { from: DATE, to: DATE, kind: 'revaluation' } });
    const id = page.items.find((e) => e.source.id === billId)?.id;
    return id === undefined ? [] : (await journalEntryById(ctx, { id })).lines.map((l) => `${l.account.name} ${l.debit} ${l.credit}`).sort();
  }, at.staff);

  // The architect on RAD-138: a cancel takes the price difference back by ADR-006 §4's split as things stand now. With
  // every unit sold since, its 1,000.00 comes back from Cost of Goods Sold, and Stores, at 0, isn't revalued (0044).
  it('cancels a bill after its goods were all sold: the stock share comes back from COGS, and nothing is revalued at 0', async () => {
    const at = await setup();
    const { id } = await draft(at, { lines: [goods(at, '2', '62500')], total: '131250' });
    await post(at, id);
    await sell(at, at.places.stores, 4);
    expect(await code(run((ctx) => cancelBillNow(ctx, { id, businessDate: DATE, reason: 'Wrong supplier' }), at.staff))).toBe('ok');
    expect(await position(at.itemId, at.places.stores)).toEqual({ qty: '0', value: '0.00' });
    expect(await undoneBy(at, id)).toEqual(['Cost of Goods Sold 0.00 1000.00', 'Stock in Hand 1000.00 0.00']);
    expect(await grni(at)).toBe('186000.00');
  });

  // Some sold: 1 left of the 2 the share covered, so half of it, 500.00, comes back from Stores, and 500.00 from COGS.
  it('cancels a bill after some of its goods were sold: half from the one still there, half from COGS', async () => {
    const at = await setup();
    const { id } = await draft(at, { lines: [goods(at, '2', '62500')], total: '131250' });
    await post(at, id);
    await sell(at, at.places.stores, 3);
    const before = await position(at.itemId, at.places.stores);
    await run((ctx) => cancelBillNow(ctx, { id, businessDate: DATE, reason: 'Wrong supplier' }), at.staff);
    const after = await position(at.itemId, at.places.stores);
    expect([before?.qty, after?.qty, (Number(before?.value) - Number(after?.value)).toFixed(2)]).toEqual(['1', '1', '500.00']);
    expect(await undoneBy(at, id)).toEqual(['Cost of Goods Sold 0.00 500.00', 'Stock in Hand 500.00 0.00']);
  });

  // ADR-006 §1 (the auditor on #380): a cancel holds the stock positions before any series' turn, so while another save
  // holds the item's Stores position, the cancel waits on it holding no journal turn.
  it('waits for the item’s stock before it takes the journal’s turn when cancelling', async () => {
    const at = await setup();
    const { id } = await draft(at, { lines: [goods(at, '2', '62500')], total: '131250' });
    await post(at, id);
    const holder = await su.connect();
    try {
      await holder.query('begin');
      await holder.query('select 1 from radcore.stock_positions where item_id = $1 and location_id = $2 for update', [at.itemId, at.places.stores]);
      const pid = (await holder.query<{ pid: number }>('select pg_backend_pid() pid')).rows[0]?.pid;
      const cancelling = code(run((ctx) => cancelBillNow(ctx, { id, businessDate: DATE, reason: 'Wrong supplier' }), at.staff));
      await vi.waitFor(async () => expect((await su.query<{ n: number }>(
        'select count(*)::int n from pg_stat_activity where $1 = any(pg_blocking_pids(pid))', [pid])).rows[0]?.n).toBe(1), { timeout: 10_000 });
      const waiter = (await su.query<{ pid: number }>('select pid from pg_stat_activity where $1 = any(pg_blocking_pids(pid))', [pid])).rows[0]?.pid;
      const held = await turnsHeldBy(su, waiter, [JOURNAL_SERIES.key, BILL_SERIES.key]);
      await holder.query('commit');
      expect([held, await cancelling]).toEqual([0, 'ok']);
    } finally {
      await holder.query('rollback').catch(() => undefined);
      holder.release();
    }
  });

  it('keeps a billed receipt (receipt_in_use), and cancels a bill back, its price difference and entry mirrored, its number reusable', async () => {
    const at = await setup();
    const number = `INV/${tag()}`;
    const { id } = await draft(at, { lines: [goods(at, '2', '62500')], total: '131250', number });
    await post(at, id);
    expect(await code(run((ctx) => cancelReceiptNow(ctx, { id: at.receiptId, businessDate: DATE, reason: 'Test' }), at.staff))).toBe('receipt_in_use');
    await run((ctx) => cancelBillNow(ctx, { id, businessDate: DATE, reason: 'Entered against the wrong PO' }), at.staff);
    expect(await position(at.itemId, at.places.stores)).toEqual({ qty: '4', value: '244000.00' });
    expect(await grni(at)).toBe('186000.00');
    // A cancelled bill's number can be entered again (RC-023).
    expect(await code(draft(at, { lines: [goods(at, '2', '62500')], total: '131250', number }))).toBe('ok');
  });
});
