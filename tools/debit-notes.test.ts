// RAD-140 PR 2 (M4-05; ADR-008 §7, §8, §12, §15; ADR-006 §6, F4's billed variant; the architect on RAD-140) on a real
// PostgreSQL, as the runtime login: a supplier return's billed part, its debit note. Each test makes its own registered
// supplier (so its input GST is claimed), item at 5%, places, PO and posted receipt with a reject, posts its bills, then
// returns. The unbilled part goes back against Goods Received Not Billed first, the billed part against its bills latest
// first at their rates; the debit note is applied to them, and undoing the return opens them again.
import { randomBytes, randomUUID } from 'node:crypto';
import { addParty, allocatePayment, journalEntryById, journalPage, openFinancialYear, paidOf, recordPayment } from '@radcore/lib-accounts';
import { gstinCheckChar, moneyString, percentString, quantityString, unitPriceString } from '@radcore/lib-common';
import { putGstRate } from '@radcore/lib-gst';
import { AppError, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import {
  addBill, addOrder, addReceipt, addReturn, cancelBillNow, cancelReturnNow, getOrderById, getReceiptById, getReturnById, placeOrder, postBillNow,
  postReceipt, postReturn,
} from '@radcore/lib-purchasing';
import { getSupplierReturn } from '@radcore/lib-purchasing/contract';
import { addCategory, addItem, addPlace } from '@radcore/lib-stock';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
// A fixed past day, so no test reads the run date (RC-156).
const DATE = '2026-11-15';
const KEYS = ['purchasing:read', 'purchasing:write', 'inward:write', 'inward:qc', 'bills:write', 'supplier_returns:write', 'parties:write',
  'parties:manage', 'items:write', 'locations:write', 'cost:read', 'gst:write', 'journal:read', 'stock:read', 'payments:read', 'payments:write'];
const tag = () => randomBytes(3).toString('hex').toUpperCase();
const q = (s: string) => quantityString().parse(s);
const letters = (n: number) => [...randomBytes(n)].map((b) => String.fromCharCode(65 + (b % 26))).join('');
const gstin = () => {
  const first14 = `27${letters(3)}C${letters(1)}${String(randomBytes(2).readUInt16BE() % 10000).padStart(4, '0')}${letters(1)}1Z`;
  return `${first14}${gstinCheckChar(first14)}`;
};
const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof AppError ? e.code : String(e)));

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the debit note tests must run, not skip');
});

describe.skipIf(!url || !superUrl)('debit notes', { timeout: 60_000 }, () => {
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  const su = new pg.Pool({ connectionString: superUrl, max: 2 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
    await su.end();
  });
  const run = <T>(fn: (ctx: Ctx) => Promise<T>, as: Principal) => runInTransaction(db, WRITE, as, randomUUID(), fn);
  const asSu = async (fn: (c: pg.PoolClient) => Promise<void>) => {
    const c = await su.connect();
    try {
      await c.query('begin');
      await c.query("select set_config('app.principal', 'system:test', true)");
      await fn(c);
      await c.query('commit');
    } finally {
      c.release();
    }
  };
  const person = async (): Promise<Principal> => {
    const key = `t_${letters(10).toLowerCase()}`;
    let userId = '';
    await asSu(async (c) => {
      await c.query("insert into radcore.roles (key, name, description, second_factor_required) values ($1, $1, 'Test', false)", [key]);
      await c.query("insert into radcore.purchase_order_limits (role, max_total) values ($1, '100000000')", [key]);
      userId = (await c.query<{ id: string }>(`insert into radcore.users (email, display_name, role) values ($1, 'Test person', $2) returning id`,
        [`debits-${randomUUID()}@example.test`, key])).rows[0]?.id ?? '';
    });
    return { kind: 'user', userId, permissions: KEYS, role: key };
  };
  const file = async () => {
    const id = randomUUID();
    await asSu(async (c) => {
      await c.query(`insert into radcore.files (id, kind, store_key, filename, content_type, size, status)
        values ($1, 'purchase_bill', $2, 'bill.pdf', 'application/pdf', 2048, 'ready')`, [id, `purchase_bill/${id}`]);
    });
    return id;
  };

  /** F2's start: a PO for `accepted + rejected` SCOOTERs at 62,000.00, received with the rejects in Rejected. */
  async function setup(accepted: string, rejected: string, o: { registered: boolean } = { registered: true }) {
    const staff = await person();
    const made = await run(async (ctx) => {
      await openFinancialYear(ctx, DATE);
      const supplierGstin = o.registered ? gstin() : null;
      const { id: supplierId } = await addParty(ctx, { name: `Supplier ${tag()}`, kinds: ['supplier'], gstin: supplierGstin, pan: null, composition: false,
        stateCode: '27', phone: null, email: null, addressLine1: null, addressLine2: null, city: null, pincode: null });
      const { id: categoryId } = await addCategory(ctx, { name: `Test ${tag()}` });
      const hsn = `8711${String(randomBytes(2).readUInt16BE() % 10000).padStart(4, '0')}`;
      await putGstRate(ctx, { hsn, effectiveFrom: '2026-04-01', rate: percentString().parse('5'), source: 'Test', note: null, reason: 'Test' });
      const { id: itemId } = await addItem(ctx, { sku: `D-${tag()}`, name: 'Scooter', categoryId, hsn, unit: 'NOS', barcode: null, serialised: false,
        hasChassis: false, purchasePrice: unitPriceString().parse('62000') });
      const stores = (await addPlace(ctx, { code: `S${tag()}`, name: `Stores ${tag()}`, kind: 'stores' })).id;
      const rejects = (await addPlace(ctx, { code: `R${tag()}`, name: `Rejected ${tag()}`, kind: 'rejected' })).id;
      return { supplierId, supplierGstin, itemId, stores, rejects };
    }, staff);
    const bought = await run(async (ctx) => {
      const total = String(Number(accepted) + Number(rejected));
      const { id: orderId } = await addOrder(ctx, { supplierId: made.supplierId, businessDate: DATE, expectedBy: null, notes: null,
        lines: [{ itemId: made.itemId, qty: q(total), rate: unitPriceString().parse('62000') }] });
      await placeOrder(ctx, { id: orderId });
      const poLineId = (await getOrderById(ctx, { id: orderId })).lines[0]?.id ?? '';
      const { id: receiptId } = await addReceipt(ctx, { orderId, businessDate: DATE, locationId: made.stores, rejectsLocationId: made.rejects,
        supplierRef: null, notes: null, lines: [{ orderLineId: poLineId, received: q(total) }] });
      const receiptLineId = (await getReceiptById(ctx, { id: receiptId })).lines[0]?.id ?? '';
      await postReceipt(ctx, { id: receiptId, lines: [{ lineId: receiptLineId, batches: [{ batchNo: 'L1', accepted: q(accepted), rejected: q(rejected) }],
        serials: [], rejectReason: 'Dented panel' }] });
      return { poLineId, receiptLineId };
    }, staff);
    const batchId = (await pool.query<{ id: string }>('select id from radcore.batches where item_id = $1', [made.itemId])).rows[0]?.id ?? '';
    return { ...made, ...bought, staff, batchId };
  }
  type At = Awaited<ReturnType<typeof setup>>;
  /** A posted bill of `qty` of the receipt line at `rate` plus 5%, stated to the rupee. */
  const bill = async (at: At, qty: string, rate: string) => {
    const taxable = Number(qty) * Number(rate);
    const fileId = await file();
    const { id } = await run((ctx) => addBill(ctx, { supplierId: at.supplierId, businessDate: DATE, supplierInvoiceNumber: `INV/${tag()}`,
      supplierInvoiceDate: DATE, supplierGstin: at.supplierGstin, statedTotal: moneyString().parse(String(Math.round(taxable * 1.05))), fileId,
      notes: null, lines: [{ kind: 'goods', poLineId: at.poLineId, receiptLineId: at.receiptLineId, qty: q(qty), rate: unitPriceString().parse(rate) }] }),
    at.staff);
    expect((await run((ctx) => postBillNow(ctx, { id }), at.staff)).status).toBe('posted');
    return id;
  };
  const giveBack = async (at: At, qty: string) => {
    const { id } = await run((ctx) => addReturn(ctx, { supplierId: at.supplierId, businessDate: DATE, locationId: at.rejects, reason: 'Dented in transit',
      notes: null, lines: [{ receiptLineId: at.receiptLineId, qty: q(qty), batches: [{ batchId: at.batchId, qty: q(qty) }], serials: [] }] }), at.staff);
    return { id, posted: await run((ctx) => postReturn(ctx, { id }), at.staff) };
  };
  const entryOf = (at: At, id: string) => run(async (ctx) => {
    const page = await journalPage(ctx, { limit: 100, filter: { from: DATE, to: DATE, kind: 'supplier_return' } });
    const entry = page.items.find((e) => e.source.id === id && e.reversesEntryId === null)?.id ?? '';
    return (await journalEntryById(ctx, { id: entry })).lines.map((l) => `${l.account.name} ${l.debit} ${l.credit}`).sort();
  }, at.staff);
  const paid = (at: At, billId: string) => run(async (ctx) => (await paidOf(ctx, 'purchase_bills', [billId])).get(billId)?.paid ?? '0.00', at.staff);
  const onHand = async (itemId: string, locationId: string) => (await pool.query<{ qty: string; value: string }>(`select
    coalesce(sum(case direction when 'in' then qty when 'out' then -qty else 0 end), 0)::numeric(18, 0)::text as qty,
    coalesce(sum(case direction when 'out' then -value else value end), 0)::numeric(18, 2)::text as value
    from radcore.stock_movements where item_id = $1 and location_id = $2`, [itemId, locationId])).rows[0];

  // F4's billed variant: the reject billed at 62,000.00 plus 5%; its return is a debit note, Dr Creditors 65,100.00, Cr
  // Stock in Hand 62,000.00, Cr Input CGST and SGST 1,550.00 each, applied to the bill.
  it('debits a billed reject against its bill at the bill’s rates (F4’s billed variant), applied to that bill', async () => {
    const at = await setup('2', '1');
    const billId = await bill(at, '3', '62000');
    const { id, posted } = await giveBack(at, '1');
    const r = await run((ctx) => getReturnById(ctx, { id }), at.staff);
    expect(posted.debitNoteNumber).toMatch(/^DBN\/\d{2}-\d{2}\/\d{5}$/);
    expect(await entryOf(at, id)).toEqual(['Creditors 65100.00 0.00', 'Input CGST 0.00 1550.00', 'Input SGST 0.00 1550.00',
      'Stock in Hand 0.00 62000.00'].sort());
    expect([r.lines[0]?.unbilledQty, r.lines[0]?.billed.map((b) => [b.billId, b.qty, b.taxable, b.cgst]), r.debitNote?.total, r.debitTotal])
      .toEqual(['0.000', [[billId, '1.000', '62000.00', '1550.00']], '65100.00', '65100.00']);
    expect([r.applications.map((a) => [a.documentId, a.amount, a.reversed]), await paid(at, billId)]).toEqual([[[billId, '65100.00', false]], '65100.00']);
    expect(getSupplierReturn.output.safeParse(r).error).toBeUndefined();
  });

  // §8: unbilled first. 2 accepted and 2 rejected; the bill takes the 2 accepted and 1 reject. Two rejects back: 1 still
  // unbilled goes back against Goods Received Not Billed, the other is debited.
  it('splits a return unbilled first, then billed', async () => {
    const at = await setup('2', '2');
    await bill(at, '3', '62000');
    const { id } = await giveBack(at, '2');
    const r = await run((ctx) => getReturnById(ctx, { id }), at.staff);
    expect([r.lines[0]?.unbilledQty, r.lines[0]?.unbilledValue, r.lines[0]?.billed.map((b) => b.qty), r.debitNote?.total])
      .toEqual(['1.000', '62000.00', ['1.000'], '65100.00']);
    expect(await entryOf(at, id)).toEqual(['Creditors 65100.00 0.00', 'Goods Received Not Billed 62000.00 0.00', 'Input CGST 0.00 1550.00',
      'Input SGST 0.00 1550.00', 'Stock in Hand 0.00 124000.00'].sort());
  });

  // The architect on RAD-140: a line billed by two bills is debited against the later first. Bill A takes the 2 accepted
  // at 62,000.00, bill B the reject at 63,000.00 (within the 2% tolerance), so the reject's return is B's, at its rate.
  it('debits the later of two bills on one receipt line first, at its rate', async () => {
    const at = await setup('2', '1');
    const first = await bill(at, '2', '62000');
    const later = await bill(at, '1', '63000');
    const { id } = await giveBack(at, '1');
    const r = await run((ctx) => getReturnById(ctx, { id }), at.staff);
    expect(r.lines[0]?.billed.map((b) => [b.billId, b.rate.startsWith('63000'), b.taxable])).toEqual([[later, true, '63000.00']]);
    expect([r.debitNote?.total, await paid(at, later), await paid(at, first)]).toEqual(['66150.00', '66150.00', '0.00']);
    // B revalued the reject to what it billed, so it leaves at 63,000.00 and nothing goes to Cost of Goods Sold.
    expect(await entryOf(at, id)).toEqual(['Creditors 66150.00 0.00', 'Input CGST 0.00 1575.00', 'Input SGST 0.00 1575.00',
      'Stock in Hand 0.00 63000.00'].sort());
  });

  // auditor-2 on #396: the reversal follows what the bill claimed, as its entry posted it. A supplier that turns composition
  // after the bill still has the bill's GST reversed; an unregistered supplier's bill claimed none, so none is reversed
  // (its GST was part of the reject's cost, F3's rule, and leaves with it).
  it('reverses input GST as the bill claimed it: after the supplier turns composition, and none for an unregistered one', async () => {
    const at = await setup('2', '1');
    await bill(at, '3', '62000');
    await asSu(async (c) => { await c.query('update radcore.parties set composition = true where id = $1', [at.supplierId]); });
    const { id } = await giveBack(at, '1');
    const plain = await setup('2', '1', { registered: false });
    await bill(plain, '3', '62000');
    const { id: other } = await giveBack(plain, '1');
    expect([await entryOf(at, id), await entryOf(plain, other)]).toEqual([
      ['Creditors 65100.00 0.00', 'Input CGST 0.00 1550.00', 'Input SGST 0.00 1550.00', 'Stock in Hand 0.00 62000.00'].sort(),
      ['Creditors 65100.00 0.00', 'Stock in Hand 0.00 65100.00'].sort()]);
  });

  // §8: applied only while the bill has anything open. Paid 150,000.00 of its 195,300.00, the bill takes 45,300.00 of the
  // 65,100.00 note; the rest stays as credit with the supplier.
  it('applies to a part-paid bill only what is open on it', async () => {
    const at = await setup('2', '1');
    const billId = await bill(at, '3', '62000');
    const bank = (await su.query<{ id: string }>("select id from radcore.accounts where system_key = 'bank'")).rows[0]?.id ?? '';
    await run(async (ctx) => {
      const { id: paymentId } = await recordPayment(ctx, { kind: 'payment', partyId: at.supplierId, businessDate: DATE, amount: moneyString().parse('150000'),
        accountId: bank });
      await allocatePayment(ctx, { id: paymentId, businessDate: DATE, lines: [{ documentTable: 'purchase_bills', documentId: billId,
        amount: moneyString().parse('150000') }] });
    }, at.staff);
    const { id } = await giveBack(at, '1');
    const r = await run((ctx) => getReturnById(ctx, { id }), at.staff);
    expect([r.applications.map((a) => a.amount), await paid(at, billId)]).toEqual([['45300.00'], '195300.00']);
  });

  // RC-129 and §7: undoing the return reverses its debit note's application, so the bill is open again; until then the
  // bill can't be cancelled (bill_returned).
  it('cancels a debit note: the bill open again, the reject back; the bill stays until then', async () => {
    const at = await setup('2', '1');
    const billId = await bill(at, '3', '62000');
    const { id } = await giveBack(at, '1');
    const held = await code(run((ctx) => cancelBillNow(ctx, { id: billId, businessDate: DATE, reason: 'Wrong supplier' }), at.staff));
    await run((ctx) => cancelReturnNow(ctx, { id, businessDate: DATE, reason: 'The supplier refused it' }), at.staff);
    const r = await run((ctx) => getReturnById(ctx, { id }), at.staff);
    expect([held, r.status, r.applications.map((a) => a.reversed), await paid(at, billId), await onHand(at.itemId, at.rejects)])
      .toEqual(['bill_returned', 'cancelled', [true], '0.00', { qty: '1', value: '62000.00' }]);
  });
});
