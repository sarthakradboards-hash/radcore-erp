// RAD-138 PR 2 (M4-03; ADR-008 §4, §7, §13, §15) on a real PostgreSQL, as the runtime login: purchase bills as drafts.
// A draft records what the supplier's bill says (its number, date and GSTIN as printed, its stated total and its file),
// its goods lines against a placed PO's lines, and its charges. The supplier's number is unique for that supplier in its
// financial year, compared in upper case and trimmed, for every bill not cancelled. A draft's tax is worked out on read,
// at the supplier's invoice date, with each goods line against its PO rate and the charges against the goods. Posting
// comes with goods receipts. Each test makes its own supplier, item and PO, so the shuffled order doesn't matter.
import { randomBytes, randomUUID } from 'node:crypto';
import { addParty, openFinancialYear } from '@radcore/lib-accounts';
import { gstinCheckChar, moneyString, percentString, PURCHASE_BILL_STATUSES, quantityString, STATE_TRANSITIONS, unitPriceString } from '@radcore/lib-common';
import { putGstRate } from '@radcore/lib-gst';
import { AppError, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import { addBill, addOrder, changeBill, changeOrder, dropBill, getBillById, getOrderById, listBillsPage, overPoRate } from '@radcore/lib-purchasing';
import { addCategory, addItem } from '@radcore/lib-stock';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
// Fixed past days, so no test reads the run date (RC-156).
const DATE = '2026-11-15';
const KEYS = ['purchasing:read', 'purchasing:write', 'bills:write', 'parties:write', 'parties:manage', 'items:write', 'cost:read', 'gst:write'];
const tag = () => randomBytes(3).toString('hex').toUpperCase();
const STAFF: Principal = { kind: 'user', userId: randomUUID(), permissions: KEYS };
// A registered supplier's GSTIN of the test's own: Maharashtra, a random PAN, entity 1, Z, and its check character.
const letters = (n: number) => [...randomBytes(n)].map((b) => String.fromCharCode(65 + (b % 26))).join('');
const GSTIN = () => {
  const first14 = `27${letters(3)}C${letters(1)}${String(randomBytes(2).readUInt16BE() % 10000).padStart(4, '0')}${letters(1)}1Z`;
  return `${first14}${gstinCheckChar(first14)}`;
};

describe.skipIf(!url || !superUrl)('purchase bills as drafts', () => {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  const su = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
    await su.end();
  });
  const run = <T>(fn: (ctx: Ctx) => Promise<T>, as: Principal = STAFF) => runInTransaction(db, WRITE, as, randomUUID(), fn);
  const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof AppError ? e.code
    : (e as { cause?: { constraint?: string } }).cause?.constraint ?? String(e)));

  // A file of the test's own, as lib-platform's store leaves one once checked.
  const file = async (kind = 'purchase_bill', status = 'ready') => {
    const id = randomUUID();
    const c = await su.connect();
    try {
      await c.query('begin');
      await c.query("set local app.principal = 'system:test'");
      await c.query(`insert into radcore.files (id, kind, store_key, filename, content_type, size, status)
        values ($1, $2, $3, 'bill.pdf', 'application/pdf', 2048, $4)`, [id, kind, `${kind}/${id}`, status]);
      await c.query('commit');
    } finally {
      c.release();
    }
    return id;
  };
  // A supplier (registered, unless `gstin` is null), an item with a 5% rate of its own and a SAC for freight at 18%,
  // and a PO for 2 of it at 50,000.00, placed (STAFF's role has no limit row, so the default 0 needs approval: placed
  // straight in the database instead, as the PO tests cover placing).
  async function setup(o: { gstin?: string | null; place?: boolean } = {}) {
    const gstin = o.gstin === undefined ? GSTIN() : o.gstin;
    const at = await run(async (ctx) => {
      await openFinancialYear(ctx, DATE);
      const { id: supplierId } = await addParty(ctx, { name: `Supplier ${tag()}`, kinds: ['supplier'], gstin, pan: null, composition: false,
        stateCode: '27', phone: null, email: null, addressLine1: null, addressLine2: null, city: null, pincode: null });
      const { id: categoryId } = await addCategory(ctx, { name: `Test ${tag()}` });
      const hsn = `8507${String(randomBytes(2).readUInt16BE() % 10000).padStart(4, '0')}`;
      await putGstRate(ctx, { hsn, effectiveFrom: '2026-04-01', rate: percentString().parse('5'), source: 'Test', note: null, reason: 'Test' });
      const { id: itemId } = await addItem(ctx, { sku: `B-${tag()}`, name: 'Battery pack', categoryId, hsn, unit: 'NOS', barcode: null,
        serialised: false, hasChassis: false, purchasePrice: unitPriceString().parse('50000') });
      const { id: orderId } = await addOrder(ctx, { supplierId, businessDate: DATE, expectedBy: null, notes: null,
        lines: [{ itemId, qty: quantityString().parse('2'), rate: unitPriceString().parse('50000') }] });
      return { supplierId, itemId, orderId, gstin };
    });
    if (o.place !== false) {
      const c = await su.connect();
      try {
        await c.query('begin');
        await c.query("set local app.principal = 'system:test'");
        await c.query(`update radcore.purchase_orders set status = 'placed', number = 'T-PO-' || id, place_of_supply = '27', taxable = 100000,
          cgst = 2500, sgst = 2500, igst = 0, round_off = 0, total = 105000 where id = $1`, [at.orderId]);
        await c.query(`update radcore.purchase_order_lines set gst_rate = 5, gst_rate_source = 'Test', taxable = 100000, cgst = 2500,
          sgst = 2500, igst = 0, line_total = 105000 where order_id = $1`, [at.orderId]);
        await c.query('commit');
      } finally {
        c.release();
      }
    }
    const poLineId = (await run((ctx) => getOrderById(ctx, { id: at.orderId }))).lines[0]?.id ?? '';
    return { ...at, poLineId };
  }
  const goods = (poLineId: string, qty = '2', rate = '50000') =>
    ({ kind: 'goods' as const, poLineId, receiptLineId: null as string | null, qty: quantityString().parse(qty), rate: unitPriceString().parse(rate) });
  const freight = (amount: string) => ({ kind: 'charge' as const, charge: 'freight' as const, description: 'Freight to Pune', hsn: '9965',
    amount: moneyString().parse(amount) });
  const bill = (at: { supplierId: string; gstin: string | null }, o: { number?: string; date?: string; supplierDate?: string;
    lines?: ReturnType<typeof goods | typeof freight>[]; fileId?: string | null; gstin?: string | null } = {}) => ({
    supplierId: at.supplierId, businessDate: o.date ?? DATE, supplierInvoiceNumber: o.number ?? `INV/${tag()}`,
    supplierInvoiceDate: o.supplierDate ?? o.date ?? DATE, supplierGstin: o.gstin === undefined ? at.gstin : o.gstin,
    statedTotal: moneyString().parse('105000'), fileId: o.fileId ?? null, notes: null, lines: o.lines ?? [] });

  it('keeps its statuses and transitions in step with the database', async () => {
    const { rows } = await su.query<{ f: string; t: string }>(
      "select from_status f, to_status t from radcore.state_transitions where document_table = 'purchase_bills' order by 1, 2");
    expect(rows.map((r) => [r.f, r.t])).toEqual([...(STATE_TRANSITIONS['purchase_bills'] ?? [])].map(([f, t]) => [f, t]).sort());
    const { rows: [ck] } = await su.query<{ def: string }>("select pg_get_constraintdef(oid) def from pg_constraint where conname = 'ck_purchase_bills_status'");
    for (const s of PURCHASE_BILL_STATUSES) expect(ck?.def).toContain(`'${s}'`);
  });

  it('records a draft with its file, its goods against the PO and its freight, its tax worked out at the supplier’s date', async () => {
    const at = await setup();
    // 18% on freight's SAC, from before the supplier's date.
    await run((ctx) => putGstRate(ctx, { hsn: '9965', effectiveFrom: '2026-04-01', rate: percentString().parse('18'), source: 'Test', note: null,
      reason: 'Test' })).catch(() => undefined);
    const fileId = await file();
    const { id } = await run((ctx) => addBill(ctx, bill(at, { fileId, supplierDate: '2026-11-14', lines: [goods(at.poLineId), freight('1000')] })));
    const b = await run((ctx) => getBillById(ctx, { id }));
    expect([b.status, b.number, b.fileId, b.supplierInvoiceDate, b.statedTotal, b.supplierGstin]).toEqual(['draft', null, fileId, '2026-11-14',
      '105000.00', at.gstin]);
    const [g, f] = b.lines;
    expect(g).toMatchObject({ kind: 'goods', itemId: at.itemId, name: 'Battery pack', poRate: '50000.000000', overPoRate: '0.00', overTolerance: false });
    expect(f).toMatchObject({ kind: 'charge', charge: 'freight', hsn: '9965', amount: '1000.00' });
    // 1,00,000.00 at 5% and 1,000.00 at 18%, both CGST and SGST: the supplier is in our state.
    expect([b.amounts.taxable, b.amounts.cgst, b.amounts.sgst, b.amounts.igst, b.amounts.total]).toEqual(['101000.00', '2590.00', '2590.00', '0.00',
      '106180.00']);
    // 1% of the goods in charges is within the 2% tolerance.
    expect(b.chargesOverTolerance).toBe(false);
  });

  it('judges a line against its PO rate: 2.00% over is within the tolerance, 2.01% is past it; a free item billed has no percentage', () => {
    expect([overPoRate('51000', '50000'), overPoRate('51005', '50000'), overPoRate('49000', '50000'), overPoRate('10', '0'), overPoRate('0', '0')])
      .toEqual(['2.00', '2.01', '0.00', null, '0.00']);
  });

  it('flags a line past the tolerance and charges past it as a share of the goods', async () => {
    const at = await setup();
    const { id } = await run((ctx) => addBill(ctx, bill(at, { lines: [goods(at.poLineId, '2', '51005'), freight('3000')] })));
    const b = await run((ctx) => getBillById(ctx, { id }));
    expect([b.lines[0]?.kind === 'goods' ? [b.lines[0].overPoRate, b.lines[0].overTolerance] : null, b.chargesOverTolerance])
      .toEqual([['2.01', true], true]);
  });

  it('refuses a GSTIN not the supplier’s own, a supplier’s date after the bill’s, a date after today and another’s PO', async () => {
    const at = await setup();
    const other = await setup();
    const unregistered = await setup({ gstin: null });
    expect(await code(run((ctx) => addBill(ctx, bill(at, { gstin: other.gstin, lines: [goods(at.poLineId)] }))))).toBe('gstin_mismatch');
    expect(await code(run((ctx) => addBill(ctx, bill(unregistered, { gstin: at.gstin, lines: [goods(unregistered.poLineId)] }))))).toBe('gstin_mismatch');
    expect(await code(run((ctx) => addBill(ctx, bill(unregistered, { lines: [goods(unregistered.poLineId)] }))))).toBe('ok');
    expect(await code(run((ctx) => addBill(ctx, bill(at, { supplierDate: '2026-11-16', lines: [goods(at.poLineId)] }))))).toBe('supplier_date_after_bill');
    expect(await code(run((ctx) => addBill(ctx, bill(at, { date: '2099-01-01', lines: [goods(at.poLineId)] }))))).toBe('date_in_future');
    expect(await code(run((ctx) => addBill(ctx, bill(at, { lines: [goods(other.poLineId)] }))))).toBe('other_supplier');
    expect(await code(run((ctx) => addBill(ctx, bill(at, { lines: [goods(randomUUID())] }))))).toBe('unknown_po_line');
  });

  it('refuses a draft PO’s line, a receipt line before goods receipts exist, and a file of another kind', async () => {
    const draftPo = await setup({ place: false });
    expect(await code(run((ctx) => addBill(ctx, bill(draftPo, { lines: [goods(draftPo.poLineId)] }))))).toBe('po_not_placed');
    const at = await setup();
    expect(await code(run((ctx) => addBill(ctx, bill(at, { lines: [{ ...goods(at.poLineId), receiptLineId: randomUUID() }] })))))
      .toBe('unknown_receipt_line');
    const photo = await file('photo');
    expect(await code(run((ctx) => addBill(ctx, bill(at, { fileId: photo, lines: [goods(at.poLineId)] }))))).toBe('wrong_file_kind');
    const checking = await file('purchase_bill', 'checking');
    expect(await code(run((ctx) => addBill(ctx, bill(at, { fileId: checking, lines: [goods(at.poLineId)] }))))).toBe('not_ready');
  });

  it('holds a supplier’s number unique in its year, as written in upper case and trimmed, across drafts too (RC-023)', async () => {
    const at = await setup();
    const other = await setup();
    const add = (who: typeof at, number: string, supplierDate = DATE) =>
      code(run((ctx) => addBill(ctx, bill(who, { number, supplierDate, lines: [goods(who.poLineId)] }))));
    const n = `inv/${tag()}`;
    expect(await add(at, n)).toBe('ok');
    // The same number again, however it's cased or spaced, is the index's.
    expect(await add(at, ` ${n.toUpperCase()} `)).toBe('ux_purchase_bills_supplier_invoice');
    // "/" and "-" are kept: INV-1 isn't INV/1.
    expect(await add(at, n.replace('/', '-'))).toBe('ok');
    // Another supplier's same number, and the same supplier's in another financial year (31 March is the year before).
    expect(await add(other, n)).toBe('ok');
    expect(await add(at, n, '2026-03-31')).toBe('ok');
  });

  // A bill line names its PO line by a restrict foreign key, so a placed PO's change that would drop that line, or give
  // it another item, is refused by name (RAD-138, after RAD-137's in-place PO line updates); lowering it saves.
  // ADR-008 §12 (the auditor on #370): a bill's save locks the POs it names before itself, so a PO change holding its row
  // (FOR UPDATE, while it checks po_billed) and a bill draft naming its lines take turns, and never both commit unseen.
  it('waits for a PO change holding the PO before saving a draft that names its lines', async () => {
    const at = await setup();
    const holder = new pg.Client({ connectionString: superUrl });
    await holder.connect();
    try {
      await holder.query('begin');
      await holder.query('select id from radcore.purchase_orders where id = $1 for update', [at.orderId]);
      const pid = (await holder.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]?.pid ?? 0;
      const saving = run((ctx) => addBill(ctx, bill(at, { lines: [goods(at.poLineId)] })));
      // The save waits on the held PO: a row lock's wait shows as one on its holder.
      const waiting = async () => (await su.query<{ n: number }>(`select count(*)::int as n from pg_stat_activity
        where $1 = any(pg_blocking_pids(pid))`, [pid])).rows[0]?.n ?? 0;
      while ((await waiting()) === 0);
      await holder.query('commit');
      expect(await code(saving)).toBe('ok');
    } finally {
      await holder.end();
    }
  });

  it('keeps a PO line a bill names: not removed nor given another item (po_billed)', async () => {
    const at = await setup();
    const second = await setup();
    await run((ctx) => addBill(ctx, bill(at, { lines: [goods(at.poLineId)] })));
    const line = (itemId: string, qty: string) => ({ itemId, qty: quantityString().parse(qty), rate: unitPriceString().parse('50000') });
    const change = (lines: ReturnType<typeof line>[]) => code(run((ctx) => changeOrder(ctx, { id: at.orderId, supplierId: at.supplierId,
      businessDate: DATE, expectedBy: null, notes: null, lines })));
    expect(await change([line(second.itemId, '2')])).toBe('po_billed');
    expect(await change([line(at.itemId, '1')])).toBe('ok');
  });

  it('rewrites a draft whole and throws one away; lists only a person’s own where that’s their scope', async () => {
    const at = await setup();
    const mine: Principal = { kind: 'user', userId: randomUUID(), permissions: KEYS, ownScope: ['purchasing:read', 'bills:write'] };
    const { id } = await run((ctx) => addBill(ctx, bill(at, { lines: [goods(at.poLineId)] })));
    await run((ctx) => changeBill(ctx, { id, ...bill(at, { number: 'CHANGED/1', lines: [goods(at.poLineId, '1')] }) }));
    const b = await run((ctx) => getBillById(ctx, { id }));
    expect([b.supplierInvoiceNumber, b.lines.map((l) => (l.kind === 'goods' ? l.qty : null))]).toEqual(['CHANGED/1', ['1.000']]);
    // At own scope, a PO someone else placed isn't theirs to bill, and someone else's bill isn't theirs to see.
    expect(await code(run((ctx) => addBill(ctx, bill(at, { lines: [goods(at.poLineId)] })), mine))).toBe('unknown_po_line');
    expect(await code(run((ctx) => getBillById(ctx, { id }), mine))).toBe('not_found');
    const ids = async (as: Principal) => (await run((ctx) => listBillsPage(ctx, { filter: { supplierId: at.supplierId }, limit: 50 }), as))
      .items.map((i) => i.id);
    expect([await ids(STAFF), await ids(mine)]).toEqual([[id], []]);
    await run((ctx) => dropBill(ctx, { id }));
    expect(await code(run((ctx) => getBillById(ctx, { id })))).toBe('not_found');
  });
});
