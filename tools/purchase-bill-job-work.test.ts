// RAD-142 (ADR-008 §7, §11, §12; ADR-006 §4, §6, F16; the architect's sketch on RAD-142) on a real PostgreSQL, as the
// runtime login: a job worker's bill. Each test makes its own job worker (registered, so its input GST is claimed),
// KIT and FRAME, places and F16's challan and receipt (3 FRAME made at 150.00, 450.00 to be billed), then bills the
// charge: Job Work Charges to be Billed cleared by exactly what was accrued, the difference to the frames' stock, the
// rate held to the receipt's charge rate by the tolerance, and the receipt kept while a bill names its charges.
import { randomBytes, randomUUID } from 'node:crypto';
import { addParty, journalEntryById, journalPage, openFinancialYear } from '@radcore/lib-accounts';
import { gstinCheckChar, moneyString, percentString, quantityString, unitPriceString } from '@radcore/lib-common';
import { putGstRate } from '@radcore/lib-gst';
import { AppError, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import { addBill, cancelBillNow, getBillById, postBillNow } from '@radcore/lib-purchasing';
import { addCategory, addChallan, addItem, addPlace, addReceipt, cancelReceiptNow, getChallanById, getReceiptById } from '@radcore/lib-stock';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { postDocument, SOURCE_TABLE } from './stock-posting.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
const DATE = '2026-11-15';
const KEYS = ['purchasing:read', 'bills:write', 'stock:read', 'job_work:write', 'items:write', 'locations:write', 'cost:read', 'journal:read',
  'parties:write', 'parties:manage', 'gst:write'];
const tag = () => randomBytes(3).toString('hex').toUpperCase();
const q = (s: string) => quantityString().parse(s);
const letters = (n: number) => [...randomBytes(n)].map((b) => String.fromCharCode(65 + (b % 26))).join('');
const gstin = () => {
  const first14 = `27${letters(3)}C${letters(1)}${String(randomBytes(2).readUInt16BE() % 10000).padStart(4, '0')}${letters(1)}1Z`;
  return `${first14}${gstinCheckChar(first14)}`;
};
const none = () => ({ qty: q('0'), batches: [], serials: [] });

describe.skipIf(!url || !superUrl)('a job worker’s bill', { timeout: 60_000 }, () => {
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  const su = new pg.Pool({ connectionString: superUrl, max: 2 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
    await su.end();
  });
  const run = <T>(fn: (ctx: Ctx) => Promise<T>, as: Principal) => runInTransaction(db, WRITE, as, randomUUID(), fn);
  // A service's refusal, or the database guard's constraint (a route maps it through dbErrors; the service call doesn't).
  const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof AppError ? e.code
    : (e as { cause?: { constraint?: string } }).cause?.constraint ?? String(e)));

  // A person made now, as the approval engine reads their account's age (RAD-38).
  const person = async (): Promise<Principal> => {
    const key = `t_${letters(10).toLowerCase()}`;
    const c = await su.connect();
    try {
      await c.query('begin');
      await c.query("select set_config('app.principal', 'system:test', true)");
      await c.query("insert into radcore.roles (key, name, description, second_factor_required) values ($1, $1, 'Test', false)", [key]);
      const { rows } = await c.query<{ id: string }>(`insert into radcore.users (email, display_name, role) values ($1, 'Test person', $2) returning id`,
        [`jw-bills-${randomUUID()}@example.test`, key]);
      await c.query('commit');
      return { kind: 'user', userId: rows[0]?.id ?? '', permissions: KEYS, ownScope: [], role: key };
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

  /** F16: 4 KIT at 1,000.00 sent to the job worker; 3 FRAME made from 3 at 150.00 a frame, 1 kit lost; job work at 18%. */
  async function setup() {
    const staff = await person();
    const made = await run(async (ctx) => {
      await openFinancialYear(ctx, DATE);
      await putGstRate(ctx, { hsn: '9988', effectiveFrom: '2026-04-01', rate: percentString().parse('18'), source: 'Test', note: null, reason: 'Test' })
        .catch(() => undefined);
      const { id: categoryId } = await addCategory(ctx, { name: `Test ${tag()}` });
      const item = (name: string) => addItem(ctx, { sku: `${name}-${tag()}`, name, categoryId, hsn: '8714', unit: 'NOS', barcode: null,
        serialised: false, hasChassis: false, purchasePrice: unitPriceString().parse('1') });
      const [kit, frame] = [(await item('KIT')).id, (await item('FRAME')).id];
      const supplierGstin = gstin();
      const { id: partyId } = await addParty(ctx, { name: `Job worker ${tag()}`, kinds: ['supplier'], gstin: supplierGstin, pan: null,
        composition: false, stateCode: '27', phone: null, email: null, addressLine1: '1 Works Road', addressLine2: null, city: 'Pune', pincode: '411019' });
      const place = async (kind: 'stores' | 'job_work', party: string | null = null) =>
        (await addPlace(ctx, { code: `L${tag()}`, name: `${kind} ${tag()}`, kind, partyId: party })).id;
      const [stores, jobWorker] = [await place('stores'), await place('job_work', partyId)];
      await postDocument(ctx, { sourceTable: SOURCE_TABLE, sourceId: randomUUID(), businessDate: DATE, ins: [{ itemId: kit, locationId: stores,
        qty: q('4'), rate: unitPriceString().parse('1000'), batches: [{ batchNo: 'B1', qty: q('4') }] }] });
      return { kit, frame, partyId, supplierGstin, stores, jobWorker };
    }, staff);
    const batch = (await pool.query<{ id: string }>('select id from radcore.batches where item_id = $1', [made.kit])).rows[0]?.id ?? '';
    const sent = await run((ctx) => addChallan(ctx, { fromId: made.stores, partyId: made.partyId, businessDate: DATE, notes: null,
      lines: [{ itemId: made.kit, qty: q('4'), batches: [{ batchId: batch, qty: q('4') }], serials: [] }] }), staff);
    const challanLine = (await run((ctx) => getChallanById(ctx, { id: sent.id }), staff)).lines[0]?.id ?? '';
    const back = await run((ctx) => addReceipt(ctx, { challanId: sent.id, locationId: made.stores, businessDate: DATE, notes: null,
      lines: [{ challanLineId: challanLine, made: { itemId: made.frame, qty: q('3'), chargeRate: unitPriceString().parse('150'), serials: [] },
        used: { qty: q('3'), batches: [{ batchId: batch, qty: q('3') }], serials: [] }, back: none(),
        lost: { qty: q('1'), batches: [{ batchId: batch, qty: q('1') }], serials: [] } }] }), staff);
    const line = (await run((ctx) => getReceiptById(ctx, { id: back.id }), staff)).lines[0]?.id ?? '';
    return { ...made, staff, receiptId: back.id, line };
  }
  type At = Awaited<ReturnType<typeof setup>>;
  const charge = (at: At, qty: string, rate: string) => ({ kind: 'job_work' as const, jobWorkReceiptLineId: at.line, qty: q(qty),
    rate: unitPriceString().parse(rate), hsn: '9988' });
  const draft = async (at: At, lines: ReturnType<typeof charge>[], total: string, supplierId = at.partyId, supplierGstin: string | null = at.supplierGstin) =>
    run(async (ctx) => addBill(ctx, { supplierId, businessDate: DATE, supplierInvoiceNumber: `JW/${tag()}`, supplierInvoiceDate: DATE,
      supplierGstin, statedTotal: moneyString().parse(total), fileId: await file(), notes: null, lines }), at.staff);
  const post = (at: At, id: string) => run((ctx) => postBillNow(ctx, { id }), at.staff);
  const entryOf = (at: At, billId: string) => run(async (ctx) => {
    const page = await journalPage(ctx, { limit: 100, filter: { from: DATE, to: DATE, kind: 'purchase_bill' } });
    const id = page.items.find((e) => e.source.id === billId && e.reversesEntryId === null)?.id ?? '';
    return (await journalEntryById(ctx, { id })).lines.map((l) => `${l.account.name} ${l.debit} ${l.credit}`).sort();
  }, at.staff);
  const jwcbOf = async (billId: string) => (await pool.query<{ v: string | null }>(
    'select jwcb_value::text as v from radcore.purchase_bill_lines where bill_id = $1', [billId])).rows.map((r) => r.v);
  const frames = async (at: At) => (await pool.query<{ value: string }>(`select coalesce(sum(case direction when 'out' then -value else value end),
    0)::numeric(18, 2)::text as value from radcore.stock_movements where item_id = $1 and location_id = $2`, [at.frame, at.stores])).rows[0]?.value;

  it('posts the job worker’s bill for F16’s 450.00: Dr Job Work Charges to be Billed, Input GST, Cr Creditors', async () => {
    const at = await setup();
    const { id } = await draft(at, [charge(at, '3', '150')], '531');
    expect((await post(at, id)).status).toBe('posted');
    expect(await entryOf(at, id)).toEqual(['Creditors 0.00 531.00', 'Input CGST 40.50 0.00', 'Input SGST 40.50 0.00',
      'Job Work Charges to be Billed 450.00 0.00'].sort());
    expect(await jwcbOf(id)).toEqual(['450.00']);
    const b = await run((ctx) => getBillById(ctx, { id }), at.staff);
    expect(b.lines[0]).toMatchObject({ kind: 'job_work', itemId: at.frame, chargeRate: '150.000000', overTolerance: false });
  });

  it('bills a line no further than it made, and puts a difference within the tolerance on the frames still held', async () => {
    const at = await setup();
    const { id: all } = await draft(at, [charge(at, '4', '150')], '708');
    expect(await code(post(at, all))).toBe('over_received');
    // 2 at 153.00 is 2% over 150.00: within the tolerance. It clears 300.00 of the 450.00 and puts 6.00 on the 3 frames.
    const { id: two } = await draft(at, [charge(at, '2', '153')], '361.08');
    await post(at, two);
    expect((await entryOf(at, two)).filter((l) => /^(Job Work|Stock|Cost of)/.test(l)))
      .toEqual(['Job Work Charges to be Billed 300.00 0.00', 'Stock in Hand 6.00 0.00']);
    expect(await frames(at)).toBe('3456.00');
    // The last one clears what's left, exactly; one more is over_received.
    const { id: last } = await draft(at, [charge(at, '1', '150')], '177');
    await post(at, last);
    expect(await jwcbOf(last)).toEqual(['150.00']);
    const { id: more } = await draft(at, [charge(at, '1', '150')], '177');
    expect(await code(post(at, more))).toBe('over_received');
  });

  it('waits for bills:approve on a charge past the tolerance, and refuses another job worker’s receipt', async () => {
    const at = await setup();
    const { id } = await draft(at, [charge(at, '1', '153.01')], '180.55');
    expect((await post(at, id)).status).toBe('pending_approval');
    const other = await run((ctx) => addParty(ctx, { name: `Supplier ${tag()}`, kinds: ['supplier'], gstin: null, pan: null, composition: false,
      stateCode: '27', phone: null, email: null, addressLine1: null, addressLine2: null, city: null, pincode: null }), at.staff);
    expect(await code(draft(at, [charge(at, '1', '150')], '177', other.id, null))).toBe('other_supplier');
  });

  it('keeps a receipt whose charges a bill names (charges_billed), and undoes it once the bill is cancelled', async () => {
    const at = await setup();
    const { id } = await draft(at, [charge(at, '3', '150')], '531');
    const undo = () => run((ctx) => cancelReceiptNow(ctx, { id: at.receiptId, businessDate: DATE, reason: 'Entered against the wrong challan' }), at.staff);
    // A draft names it too: the guard counts every bill that isn't cancelled.
    expect(await code(undo())).toBe('job_work_charges_billed');
    await post(at, id);
    expect(await code(undo())).toBe('job_work_charges_billed');
    await run((ctx) => cancelBillNow(ctx, { id, businessDate: DATE, reason: 'Billed in error' }), at.staff);
    expect(await code(undo())).toBe('ok');
  });

  it('holds each line to one source in the database: a goods receipt line or a job-work receipt line, never both', async () => {
    const at = await setup();
    const { id } = await draft(at, [charge(at, '1', '150')], '177');
    const c = await su.connect();
    try {
      await c.query('begin');
      await c.query("set local app.principal = 'system:test'");
      const both = await c.query(`update radcore.purchase_bill_lines set receipt_line_id = gen_random_uuid()
        where bill_id = $1`, [id]).then(() => 'ok', (e: { constraint?: string }) => e.constraint);
      expect(both).toMatch(/^ck_purchase_bill_lines_(one_source|receipt)$/);
    } finally {
      await c.query('rollback');
      c.release();
    }
  });
});
