// RAD-114 PR 2 (M3-10; ADR-007 §6; ADR-006 §4, §6, F9, F25, F26; RC-126, RC-128, RC-207; CA-10) on a real
// PostgreSQL, as the runtime login: credit notes. Each test's deliveries are committed; its invoices and notes post
// inside one transaction that is rolled back, under the committed company profile
// (tools/test-database.ts) and never rewrites it. Every note is approved by someone else, whose decision runs in that same transaction as
// them (actingAs): the request is the maker's, the approval the approver's, as two requests would be.
import { randomBytes, randomUUID } from 'node:crypto';
import {
  addParty, allocatePayment, applyCredit, cashLimitSpec, journalEntryById, journalPage, openFinancialYear, paidOf, recordPayment, reverseCreditApplication, setCreditTerms,
} from '@radcore/lib-accounts';
import { moneyString, percentString, quantityString, sightOf, unitPriceString } from '@radcore/lib-common';
import { putGstRate } from '@radcore/lib-gst';
import { AppError, decideApproval, principalId, Settings, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import {
  addCreditNote, addDelivery, addInvoice, addOrder, askCreditNoteApproval, cancelCreditNoteNow, cancelInvoiceNow, confirmOrderNow,
  creditNoteApprovalSpec, getCreditNoteById, getDeliveryById, getInvoiceById, getOrderById, postDeliveryNow, postInvoiceNow,
} from '@radcore/lib-sales';
import { addCategory, addItem, addPlace } from '@radcore/lib-stock';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { rawOf } from '../packages/db/src/tx.ts';
import { mayUse } from '../packages/lib-platform/src/scope.ts';
import { priceListFrom } from './price-list-fixture.ts';
import { postDocument, SOURCE_TABLE } from './stock-posting.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
// A fixed past day, so no test reads the run date (RC-156); the services bound dates by the real one.
const DATE = '2026-11-15';
const KEYS = ['sales:read', 'sales:write', 'deliveries:write', 'invoices:write', 'invoices:cancel', 'credit_notes:write', 'credit_notes:cancel',
  'parties:write', 'parties:manage', 'items:write', 'locations:write', 'cost:read', 'gst:write', 'journal:read', 'company:write',
  'payments:write', 'prices:approve'];
const staff: Principal = { kind: 'user', userId: randomUUID(), permissions: KEYS };
const tag = () => randomBytes(3).toString('hex').toUpperCase();
const q = (s: string) => quantityString().parse(s);
const m = (s: string) => moneyString().parse(s);
class RolledBack extends Error {}

/** The same transaction, acting as `p`: its key checks, and the principal the audit trail records. Test-only. */
async function actingAs(ctx: Ctx, p: Principal): Promise<Ctx> {
  await rawOf(ctx.tx).execute(sql`select set_config('app.principal', ${principalId(p)}, true)`);
  const can = (permission: string, record?: { owner: string }) => mayUse(p, permission, record);
  const see = (permission: string, record: { owner: string }) => {
    if (!can(permission, record)) throw new AppError('not_found', 'Not found');
  };
  return Object.freeze({ ...ctx, principal: p, can, see, shows: sightOf(p.permissions) });
}
const rows = async <T>(ctx: Ctx, query: ReturnType<typeof sql>) => ((await rawOf(ctx.tx).execute(query)) as unknown as { rows: T[] }).rows;

describe.skipIf(!url || !superUrl)('credit notes', () => {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  const su = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
    await su.end();
  });
  const run = <T>(fn: (ctx: Ctx) => Promise<T>, as: Principal = staff) => runInTransaction(db, WRITE, as, randomUUID(), fn);
  const failure = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof AppError ? e.code : String(e)));
  async function inBooks<R>(fn: (ctx: Ctx) => Promise<R>): Promise<R> {
    let out: R | undefined;
    await run(async (ctx) => {
      // The committed profile (tools/test-database.ts) is the one these tests sell under; rewriting it here took the company
      // row exclusively for the whole test, and deadlocked against period-lock tests (RAD-76).
      out = await fn(ctx);
      throw new RolledBack();
    }).catch((e: unknown) => {
      if (!(e instanceof RolledBack)) throw e;
    });
    return out as R;
  }
  // The approver: a person whose account is committed before any request they decide (approver_too_new), so each test
  // makes its approvers first, before its setup's committed work (RAD-76).
  const approverWith = async (permissions: string[]): Promise<Principal> => {
    const { rows: made } = await pool.query<{ id: string }>(`with p as (select set_config('app.principal', 'system:test', true))
      insert into radcore.users (email, display_name, role) select $1, 'Approver', 'accounts' from p returning id`,
    [`credit-notes-${randomUUID()}@example.test`]);
    return { kind: 'user', userId: made[0]?.id ?? '', permissions, role: 'accounts' };
  };

  type Setup = { on?: string; gst?: string; stock: string; stockRate: string; rate: string; sold: string; serials?: string[] };
  /** A customer in Maharashtra, an item rated `gst`%, a store holding `stock` at `stockRate` in batch B1, and a
   * confirmed order of `sold` at `rate`, delivered whole: what an invoice bills. */
  async function setup(o: Setup) {
    const on = o.on ?? DATE;
    const made = await run(async (ctx) => {
      await openFinancialYear(ctx, on);
      const { id: partyId } = await addParty(ctx, { name: `Party ${tag()}`, kinds: ['customer'], gstin: null, pan: null, composition: false,
        stateCode: '27', phone: null, email: null, addressLine1: '12 MG Road', addressLine2: null, city: 'Pune', pincode: '411001' });
      await setCreditTerms(ctx, { id: partyId, creditDays: 30, creditLimit: m('100000000'), reason: 'Test' });
      const { id: categoryId } = await addCategory(ctx, { name: `Test ${tag()}` });
      const hsn = `8716${String(randomBytes(2).readUInt16BE() % 10000).padStart(4, '0')}`;
      await putGstRate(ctx, { hsn, effectiveFrom: on, rate: percentString().parse(o.gst ?? '5'), source: 'Notification 1/2017-CT(R)', note: null,
        reason: 'Test' });
      const { id: itemId } = await addItem(ctx, { sku: `I-${tag()}`, name: 'Scooter', categoryId, hsn, unit: 'NOS', barcode: null,
        serialised: o.serials !== undefined, hasChassis: false, purchasePrice: unitPriceString().parse('1') });
      const { id: placeId } = await addPlace(ctx, { code: `L${tag()}`, name: `Store ${tag()}`, kind: 'store' });
      await postDocument(ctx, { sourceTable: SOURCE_TABLE, sourceId: randomUUID(), businessDate: on, ins: [{ itemId, locationId: placeId,
        qty: q(o.stock), rate: unitPriceString().parse(o.stockRate), batches: [{ batchNo: 'B1', qty: q(o.stock) }],
        ...(o.serials === undefined ? {} : { units: o.serials.map((serialNo) => ({ serialNo })) }) }] });
      return { partyId, itemId, placeId };
    });
    await priceListFrom(su, on, { [made.itemId]: o.rate }, { partyId: made.partyId });
    const { rows: [batch] } = await su.query<{ id: string }>('select id from radcore.batches where item_id = $1', [made.itemId]);
    const deliveryLineId = await run(async (ctx) => {
      const { id: orderId } = await addOrder(ctx, { partyId: made.partyId, businessDate: on, notes: null, lines: [{ itemId: made.itemId,
        qty: q(o.sold), rate: unitPriceString().parse(o.rate), discountPercent: percentString({ max: '100' }).parse('0') }] });
      await confirmOrderNow(ctx, { id: orderId });
      const orderLineId = (await getOrderById(ctx, { id: orderId })).lines[0]?.id ?? '';
      const { id } = await addDelivery(ctx, { orderId, locationId: made.placeId, businessDate: on, notes: null,
        lines: [{ orderLineId, qty: q(o.sold), batches: [{ batchId: batch?.id ?? '', qty: q(o.sold) }], serials: o.serials ?? [] }] });
      await postDeliveryNow(ctx, { id });
      return (await getDeliveryById(ctx, { id })).lines[0]?.id ?? '';
    });
    return { ...made, on, batchId: batch?.id ?? '', deliveryLineId, sold: o.sold };
  }
  type At = Awaited<ReturnType<typeof setup>>;

  /** The invoice of everything delivered, posted: its id and its one line's id. */
  const invoice = async (ctx: Ctx, at: At) => {
    const { id } = await addInvoice(ctx, { partyId: at.partyId, businessDate: at.on, notes: null, shipTo: null,
      lines: [{ deliveryLineId: at.deliveryLineId, qty: q(at.sold) }] });
    await postInvoiceNow(ctx, { id });
    return { id, lineId: (await getInvoiceById(ctx, { id })).lines[0]?.id ?? '' };
  };
  type Inv = Awaited<ReturnType<typeof invoice>>;
  const goodsBack = (ctx: Ctx, at: At, inv: Inv, qty: string, more: { serials?: string[]; on?: string; refund?: { amount: string; accountId: string } } = {}) =>
    addCreditNote(ctx, { invoiceId: inv.id, kind: 'goods', businessDate: more.on ?? at.on, locationId: at.placeId, reason: 'Came back unused',
    refund: more.refund === undefined ? null : { amount: m(more.refund.amount), accountId: more.refund.accountId },
    lines: [{ invoiceLineId: inv.lineId, qty: q(qty), batches: [{ batchId: at.batchId, qty: q(qty) }], serials: more.serials ?? [] }] });
  const valueOff = (ctx: Ctx, at: At, inv: Inv, taxable: string, on = at.on) => addCreditNote(ctx, { invoiceId: inv.id, kind: 'value',
    businessDate: on, locationId: null, reason: 'Discount agreed', refund: null, lines: [{ invoiceLineId: inv.lineId, taxable: m(taxable) }] });
  /** Asks, then approves as `approver` in the same transaction; back as the maker after. Both under `settings`: the
   * version holds whether the note is late, so a deadline changed between them would be version_changed. */
  const approve = async (ctx: Ctx, id: string, approver: Principal, settings?: Settings) => {
    const asked = await askCreditNoteApproval(settings === undefined ? ctx : { ...ctx, settings }, { id });
    const as = await actingAs(ctx, approver);
    await decideApproval(settings === undefined ? as : { ...as, settings }, creditNoteApprovalSpec, asked.id,
      { decision: 'approve', versionHash: asked.versionHash });
    await actingAs(ctx, ctx.principal);
    return getCreditNoteById(ctx, { id });
  };
  /** A note's entry, or its mirror's, as lines "account debit credit". */
  const entryOf = async (ctx: Ctx, noteId: string, on: string, mirror = false) => {
    const page = await journalPage(ctx, { limit: 100, filter: { from: on, to: on, kind: 'credit_note' } });
    const id = page.items.find((e) => e.source.id === noteId && (e.reversesEntryId !== null) === mirror)?.id ?? '';
    return (await journalEntryById(ctx, { id })).lines.map((l) => `${l.account.name} ${l.debit} ${l.credit}`);
  };
  const onHand = async (ctx: Ctx, at: At) => (await rows<{ qty: string; value: string }>(ctx, sql`select
    coalesce(sum(case direction when 'in' then qty when 'out' then -qty else 0 end), 0)::numeric(18, 0)::text as qty,
    coalesce(sum(case direction when 'out' then -value else value end), 0)::numeric(18, 2)::text as value
    from radcore.stock_movements where item_id = ${at.itemId} and location_id = ${at.placeId}`))[0];

  // F9 (RC-207): the scooter went out at 61,250.00; the store now averages 62,000.00, and it comes back at 61,250.00.
  // The note is approved by someone else, posts Dr Sales and Output GST, Cr Debtors, Dr Stock, Cr COGS, and settles
  // the invoice.
  it('takes F9’s scooter back at the value it went out at, approved by someone else, and settles the invoice', async () => {
    const approver = await approverWith(['credit_notes:approve']);
    const at = await setup({ stock: '2', stockRate: '61250', rate: '80000', sold: '1' });
    await run((ctx) => postDocument(ctx, { sourceTable: SOURCE_TABLE, sourceId: randomUUID(), businessDate: DATE, ins: [{ itemId: at.itemId,
      locationId: at.placeId, qty: q('2'), rate: unitPriceString().parse('62375'), batches: [{ batchNo: 'B2', qty: q('2') }] }] }));
    const out = await inBooks(async (ctx) => {
      const inv = await invoice(ctx, at);
      const { id } = await goodsBack(ctx, at, inv, '1');
      const asked = await askCreditNoteApproval(ctx, { id });
      // The maker can't approve their own note (RC-037).
      const own = await failure(decideApproval(ctx, creditNoteApprovalSpec, asked.id, { decision: 'approve', versionHash: asked.versionHash }));
      const before = await onHand(ctx, at);
      const note = await approve(ctx, id, approver);
      return { own, before, note: [note.status, note.number?.slice(0, 3), note.total, note.late, note.lines[0]?.cost],
        entry: await entryOf(ctx, id, DATE), after: await onHand(ctx, at), paid: (await paidOf(ctx, 'invoices', [inv.id])).get(inv.id) };
    });
    expect(out).toEqual({ own: 'own_request', before: { qty: '3', value: '186000.00' },
      note: ['posted', 'CN/', '84000.00', false, '61250.00'],
      entry: ['Sales 80000.00 0.00', 'Output CGST 2000.00 0.00', 'Output SGST 2000.00 0.00', 'Debtors 0.00 84000.00',
        'Stock in Hand 61250.00 0.00', 'Cost of Goods Sold 0.00 61250.00'],
      after: { qty: '4', value: '247250.00' }, paid: { allocated: '0.00', credited: '84000.00', paid: '84000.00' } });
  });

  // F9's variant and ADR-007 §6's cap: a value-only discount, with no movement; then no more than is left of the line.
  it('credits a discount with no movement, and never more than is left of the invoice line', async () => {
    const approver = await approverWith(['credit_notes:approve']);
    const at = await setup({ stock: '1', stockRate: '61250', rate: '80000', sold: '1' });
    const out = await inBooks(async (ctx) => {
      const inv = await invoice(ctx, at);
      const { id } = await valueOff(ctx, at, inv, '1000');
      await approve(ctx, id, approver);
      const entry = await entryOf(ctx, id, DATE);
      // 79,000.00 of taxable value is left: 79,000.01 is refused; all of it clears the tax left too, and then nothing is.
      const over = await failure(valueOff(ctx, at, inv, '79000.01'));
      const stale = await valueOff(ctx, at, inv, '500');
      const rest = await valueOff(ctx, at, inv, '79000');
      await approve(ctx, rest.id, approver);
      const staleShown = await getCreditNoteById(ctx, { id: stale.id }); // no longer fits what's left: blank, and why
      const more = await failure(valueOff(ctx, at, inv, '0.01'));
      // Two of the one scooter can't come back.
      const two = await failure(goodsBack(ctx, at, inv, '2'));
      return { entry, over, rest: (await getCreditNoteById(ctx, { id: rest.id })).total, more, two, stock: await onHand(ctx, at),
        stale: [staleShown.total, staleShown.lines[0]?.lineTotal, staleShown.amountsNote] };
    });
    expect(out).toEqual({ entry: ['Sales 1000.00 0.00', 'Output CGST 25.00 0.00', 'Output SGST 25.00 0.00', 'Debtors 0.00 1050.00'],
      over: 'exceeds_invoice', rest: '82950.00', more: 'exceeds_invoice', two: 'exceeds_invoice', stock: { qty: '0', value: '0.00' },
      stale: ['0.00', null, 'A credit note can’t exceed what’s left of its invoice'] });
  });

  // F25, CA-10: an invoice of FY 2025-26, deadline 30 November 2026 by default. With the setting earlier, the same note
  // is late and its tax goes to GST Borne on Late Credit Notes; Output GST isn't touched.
  it('posts a note past section 34’s limit to GST Borne on Late Credit Notes (F25)', async () => {
    const approver = await approverWith(['credit_notes:approve']);
    const at = await setup({ on: '2026-03-10', stock: '1', stockRate: '61250', rate: '80000', sold: '1' });
    const out = await inBooks(async (ctx) => {
      const inv = await invoice(ctx, at);
      const inTime = await valueOff(ctx, at, inv, '1000', DATE);
      await approve(ctx, inTime.id, approver);
      const late = await valueOff(ctx, at, inv, '1000', DATE);
      const note = await approve(ctx, late.id, approver, new Settings([{ key: 'sales.credit_note_tax_deadline', value: '11-14' }]));
      return { inTime: await entryOf(ctx, inTime.id, DATE), late: [note.late, await entryOf(ctx, late.id, DATE)] };
    });
    expect(out).toEqual({
      inTime: ['Sales 1000.00 0.00', 'Output CGST 25.00 0.00', 'Output SGST 25.00 0.00', 'Debtors 0.00 1050.00'],
      late: [true, ['Sales 1000.00 0.00', 'GST Borne on Late Credit Notes 50.00 0.00', 'Debtors 0.00 1050.00']] });
  });

  // F26, RC-126: one pad of three back at the counter, its share of what they went out at; the note's lines come to
  // 407.10 and its total to 407.00, the round-off a credit. The invoice was paid in cash, so nothing applies, and the
  // refund drafted with the note is paid in the same save: Dr Debtors, Cr Cash, the customer's balance 0.00. A refund
  // past what's left is refused.
  it('takes one pad of three back at its share, rounds F26’s total to 407.00, and refunds it in cash in the same save', async () => {
    const approver = await approverWith(['credit_notes:approve']);
    const at = await setup({ gst: '18', stock: '10', stockRate: '200', rate: '345', sold: '3' });
    const out = await inBooks(async (ctx) => {
      const inv = await invoice(ctx, at);
      const cash = (await rows<{ id: string }>(ctx, sql`select id from radcore.accounts where system_key = 'cash'`))[0]?.id ?? '';
      // The RAD-114 note: while the invoice is unpaid, the note settles it and nothing is left to refund, said at draft.
      const unpaid = await goodsBack(ctx, at, inv, '1', { refund: { amount: '1', accountId: cash } }).then(() => 'ok',
        (e: unknown) => (e instanceof AppError ? `${e.code} ${e.issues[0]?.message ?? ''}` : String(e)));
      const receipt = await recordPayment(ctx, { kind: 'receipt', partyId: at.partyId, businessDate: DATE, amount: m('1221'), accountId: cash });
      await allocatePayment(ctx, { id: receipt.id, businessDate: DATE, lines: [{ documentTable: 'invoices', documentId: inv.id, amount: m('1221') }] });
      // Paid only from Cash or a bank account, said at draft: Sales isn't one.
      const sales = (await rows<{ id: string }>(ctx, sql`select id from radcore.accounts where system_key = 'sales'`))[0]?.id ?? '';
      const notMoney = await failure(goodsBack(ctx, at, inv, '1', { refund: { amount: '407', accountId: sales } }));
      const tooMuch = await failure(goodsBack(ctx, at, inv, '1', { refund: { amount: '407.01', accountId: cash } }));
      const { id } = await goodsBack(ctx, at, inv, '1', { refund: { amount: '407', accountId: cash } });
      const note = await approve(ctx, id, approver);
      const [refund] = await rows<{ id: string; status: string }>(ctx, sql`select id, status from radcore.payments
        where credit_table = 'credit_notes' and credit_id = ${id}`);
      const page = await journalPage(ctx, { limit: 100, filter: { from: DATE, to: DATE, kind: 'payment_out' } });
      const paidOut = (await journalEntryById(ctx, { id: page.items.find((e) => e.source.id === refund?.id)?.id ?? '' })).lines
        .map((l) => `${l.account.name} ${l.debit} ${l.credit}`);
      const [balance] = await rows<{ balance: string }>(ctx, sql`select (coalesce(sum(debit), 0) - coalesce(sum(credit), 0))::numeric(18, 2)::text
        as balance from radcore.journal_lines where party_id = ${at.partyId}`);
      // auditor-2 on #306: GET /sales/credit-notes/:id runs read-only, so a pending note's amounts, and its approval's
      // version, are read here with the transaction switched to read only: a lock creeping into them would fail.
      const next = await goodsBack(ctx, at, inv, '1');
      await askCreditNoteApproval(ctx, { id: next.id });
      await rawOf(ctx.tx).execute(sql`set transaction read only`);
      const shown = await getCreditNoteById(ctx, { id: next.id });
      const readOnly = [shown.approval, shown.total, (await creditNoteApprovalSpec.version(ctx, next.id, { forUpdate: false }))?.amounts?.total];
      return { unpaid, notMoney, tooMuch, note: [note.taxable, note.cgst, note.roundOff, note.total], entry: await entryOf(ctx, id, DATE), readOnly,
        paid: (await paidOf(ctx, 'invoices', [inv.id])).get(inv.id)?.credited, refund: refund?.status, paidOut, balance: balance?.balance };
    });
    expect(out).toEqual({ unpaid: 'exceeds_credit 0.00 is left to refund', notMoney: 'not_money_account', tooMuch: 'exceeds_credit', note: ['345.00', '31.05', '-0.10', '407.00'],
      entry: ['Sales 345.00 0.00', 'Output CGST 31.05 0.00', 'Output SGST 31.05 0.00', 'Debtors 0.00 407.00', 'Round Off 0.00 0.10',
        'Stock in Hand 200.00 0.00', 'Cost of Goods Sold 0.00 200.00'], paid: '0.00', refund: 'posted',
      paidOut: ['Debtors 407.00 0.00', 'Cash 0.00 407.00'], balance: '0.00', readOnly: ['pending', '407.00', '407.00'] });
  });

  // F26 past the day's cash limit (the architect on RAD-114): the note posts, and its cash refund stays a draft with its
  // own cash-limit request, made in the approval's save by the note's approver, so someone else approves the cash.
  it('posts the note and leaves a cash refund past the day’s limit waiting for someone else’s cash-limit approval', async () => {
    const approver = await approverWith(['credit_notes:approve', 'payments:approve']);
    const owner = await approverWith(['payments:approve']);
    const at = await setup({ gst: '18', stock: '10', stockRate: '200', rate: '345', sold: '3' });
    const out = await inBooks(async (ctx) => {
      const inv = await invoice(ctx, at);
      const cash = (await rows<{ id: string }>(ctx, sql`select id from radcore.accounts where system_key = 'cash'`))[0]?.id ?? '';
      const receipt = await recordPayment(ctx, { kind: 'receipt', partyId: at.partyId, businessDate: DATE, amount: m('1221'), accountId: cash });
      await allocatePayment(ctx, { id: receipt.id, businessDate: DATE, lines: [{ documentTable: 'invoices', documentId: inv.id, amount: m('1221') }] });
      const { id } = await goodsBack(ctx, at, inv, '1', { refund: { amount: '407', accountId: cash } });
      const note = await approve(ctx, id, approver, new Settings([{ key: 'accounts.cash_payment_limit', value: '100.00' }]));
      const [refund] = await rows<{ id: string; status: string }>(ctx, sql`select id, status from radcore.payments
        where credit_table = 'credit_notes' and credit_id = ${id}`);
      const [request] = await rows<{ id: string; by: string; digest: string }>(ctx, sql`select id, requested_by as by,
        version_digest as digest from radcore.approvals where kind = 'cash-limit' and record_id = ${refund?.id ?? ''}`);
      const decide = async (as: Principal) => decideApproval(await actingAs(ctx, as), cashLimitSpec, request?.id ?? '',
        { decision: 'approve', versionHash: request?.digest ?? '' });
      const ownCash = await failure(decide(approver));
      await decide(owner);
      await actingAs(ctx, ctx.principal);
      const [after] = await rows<{ status: string }>(ctx, sql`select status from radcore.payments where id = ${refund?.id ?? ''}`);
      return { note: note.status, waiting: refund?.status, requestedBy: request?.by === principalId(approver), ownCash, after: after?.status };
    });
    expect(out).toEqual({ note: 'posted', waiting: 'draft', requestedBy: true, ownCash: 'own_request', after: 'posted' });
  });

  // RC-128: a serialised unit sold on the invoice comes back `returned`: ours again, its sale cleared. RC-207: the
  // note's cancellation sends it out again at the value it came back at, and is refused while the note is applied.
  it('clears a returned unit’s sale, and cancels the note only once its application is reversed, the goods out again', async () => {
    const serial = `SN-${tag()}`;
    const approver = await approverWith(['credit_notes:approve']);
    const at = await setup({ stock: '1', stockRate: '61250', rate: '80000', sold: '1', serials: [serial] });
    const unit = async (ctx: Ctx) => (await rows<{ ownership: string; sale: string | null }>(ctx, sql`select ownership, sale_line_id as sale
      from radcore.units where item_id = ${at.itemId}`))[0];
    /** The invoice, and the unit back on an approved goods-back note: the note's id. */
    const noted = async (ctx: Ctx) => {
      const inv = await invoice(ctx, at);
      const { id } = await goodsBack(ctx, at, inv, '1', { serials: [serial] });
      await approve(ctx, id, approver);
      return { inv, id };
    };
    // The deliveries are committed, so each rolled-back transaction invoices them afresh. In the first, the database
    // refuses to cancel a note still applied to its invoice: the transaction ends there (the route answers it as
    // still_applied, by its dbErrors).
    const refused = await inBooks(async (ctx) => {
      const sold = await unit(ctx);
      const { inv, id } = await noted(ctx);
      const back = await unit(ctx);
      // The invoice can't be cancelled while the note stands.
      const invoiceCancel = await failure(cancelInvoiceNow(ctx, { id: inv.id, businessDate: DATE, reason: 'Billed in error' }));
      const applied = await cancelCreditNoteNow(ctx, { id, businessDate: DATE, reason: 'Raised in error' }).then(() => 'ok', (e: unknown) => {
        const pgError = (e as { cause?: { code?: string; constraint?: string } }).cause ?? (e as { code?: string; constraint?: string });
        return `${pgError.code}:${pgError.constraint ?? ''}`;
      });
      return { sold: sold?.ownership, back, invoiceCancel, applied };
    });
    const cancelled = await inBooks(async (ctx) => {
      const { id } = await noted(ctx);
      const [application] = await rows<{ id: string }>(ctx, sql`select id from radcore.credit_applications
        where credit_table = 'credit_notes' and credit_id = ${id} and direction = 'apply'`);
      await reverseCreditApplication(ctx, { id: application?.id ?? '', businessDate: DATE, reason: 'Raised in error' });
      await cancelCreditNoteNow(ctx, { id, businessDate: DATE, reason: 'Raised in error' });
      return { status: (await getCreditNoteById(ctx, { id })).status, mirror: await entryOf(ctx, id, DATE, true), stock: await onHand(ctx, at),
        again: (await unit(ctx))?.ownership };
    });
    expect(refused).toEqual({ sold: 'customer', back: { ownership: 'ours', sale: null }, invoiceCancel: 'credit_note_stands',
      applied: 'RA006:document_still_applied' });
    expect(cancelled).toEqual({ status: 'cancelled',
      mirror: ['Sales 0.00 80000.00', 'Output CGST 0.00 2000.00', 'Output SGST 0.00 2000.00', 'Debtors 84000.00 0.00',
        'Stock in Hand 0.00 61250.00', 'Cost of Goods Sold 61250.00 0.00'], stock: { qty: '0', value: '0.00' }, again: 'customer' });
  });

  // ui-2's "reverse the application" (RAD-114): a note lists where it's applied, each with its invoice's number and
  // whether it's reversed. Applied as it posts, reversed, then applied again: two applications, the first reversed.
  it('lists a note’s applications to its invoice, oldest first, each reversed or not', async () => {
    const approver = await approverWith(['credit_notes:approve']);
    const at = await setup({ stock: '1', stockRate: '61250', rate: '80000', sold: '1' });
    const out = await inBooks(async (ctx) => {
      const inv = await invoice(ctx, at);
      const { id } = await valueOff(ctx, at, inv, '1000');
      await approve(ctx, id, approver);
      const posted = (await getCreditNoteById(ctx, { id })).applications;
      await reverseCreditApplication(ctx, { id: posted[0]?.id ?? '', businessDate: DATE, reason: 'Applied in error' });
      await applyCredit(ctx, { creditTable: 'credit_notes', creditId: id, documentTable: 'invoices', documentId: inv.id, amount: m('1050'),
        businessDate: DATE });
      // Both rows post in this one transaction, so share a moment: matched by id, not by order.
      const after = (await getCreditNoteById(ctx, { id })).applications;
      return { number: (await getInvoiceById(ctx, { id: inv.id })).number, posted: posted.map((a) => a.reversed),
        after: after.map((a) => [a.id === posted[0]?.id, a.documentTable, a.documentId === inv.id, a.documentNumber, a.amount, a.businessDate,
          a.reversed]).toSorted((x, y) => Number(y[0]) - Number(x[0])) };
    });
    expect(out.posted).toEqual([false]);
    expect(out.after).toEqual([[true, 'invoices', true, out.number, '1050.00', DATE, true], [false, 'invoices', true, out.number, '1050.00', DATE, false]]);
    expect(out.number?.startsWith('INV/')).toBe(true);
  });

  // ADR-005 §2, as the superuser: a posted note's header must match its lines at commit (RA006).
  // ui-2 on #298: an invoice line says which batches its goods left in and which units are still out, so a goods-back
  // form can offer them; a note says where its approval stands, and its lines name their items.
  it('shows an invoice line’s batches and units still out, a note’s approval state and its lines’ items', async () => {
    const serial = `SN-${tag()}`;
    const approver = await approverWith(['credit_notes:approve']);
    const at = await setup({ stock: '1', stockRate: '61250', rate: '80000', sold: '1', serials: [serial] });
    const out = await inBooks(async (ctx) => {
      const inv = await invoice(ctx, at);
      const goods = async () => (await getInvoiceById(ctx, { id: inv.id })).lines[0]?.goods;
      const before = await goods();
      const { id } = await goodsBack(ctx, at, inv, '1', { serials: [serial] });
      // e2e-playwright on #299: a draft's and a pending note's amounts are worked out on read, not 0.00 until it posts.
      const state = async () => {
        const n = await getCreditNoteById(ctx, { id });
        return [n.approval, n.total, n.cgst, n.lines[0]?.lineTotal, n.lines[0]?.cost, n.amountsNote];
      };
      const drafted = await state();
      const asked = await askCreditNoteApproval(ctx, { id });
      const pending = await state();
      // The architect on RAD-114, (a): the version holds the amounts that will post. A discount posting while this note
      // waits changes its share of what's left, so its decision answers version_changed; asked again, it's approved.
      const versioned = (await creditNoteApprovalSpec.version(ctx, id, { forUpdate: false }))?.amounts;
      await approve(ctx, (await valueOff(ctx, at, inv, '1000')).id, approver);
      const changed = await failure(decideApproval(await actingAs(ctx, approver), creditNoteApprovalSpec, asked.id,
        { decision: 'approve', versionHash: asked.versionHash }));
      await actingAs(ctx, ctx.principal);
      const again = await askCreditNoteApproval(ctx, { id });
      await decideApproval(await actingAs(ctx, approver), creditNoteApprovalSpec, again.id, { decision: 'approve', versionHash: again.versionHash });
      await actingAs(ctx, ctx.principal);
      const note = await getCreditNoteById(ctx, { id });
      return { before, after: await goods(), versioned, changed, states: [drafted, pending, [note.approval, note.total, note.cgst, note.lines[0]?.lineTotal,
        note.lines[0]?.cost, note.amountsNote]], line: [note.lines[0]?.sku.startsWith('I-'), note.lines[0]?.name] };
    });
    const batches = [{ batchId: at.batchId, batchNo: 'B1', qty: '1' }];
    expect(out).toEqual({ before: { batches, units: [{ serialNo: serial, batchId: at.batchId }] }, after: { batches, units: [] },
      versioned: { taxable: '80000.00', cgst: '2000.00', sgst: '2000.00', igst: '0.00', total: '84000.00', late: false }, changed: 'version_changed',
      states: [['none', '84000.00', '2000.00', '84000.00', '61250.00', null], ['pending', '84000.00', '2000.00', '84000.00', '61250.00', null],
        ['approved', '82950.00', '1975.00', '82950.00', '61250.00', null]], line: [true, 'Scooter'] });
  });

  it('refuses a posted note whose header doesn’t match its lines at commit', async () => {
    const at = await setup({ stock: '1', stockRate: '100', rate: '1000', sold: '1' });
    const c = await su.connect();
    const attempt = async (tax: string) => {
      await c.query('begin');
      try {
        await c.query("set local app.principal = 'system:test'");
        const { rows: [inv] } = await c.query<{ id: string; line: string }>(`with i as (insert into radcore.invoices (party_id, owner, business_date)
          values ($1, 'system:test', '${DATE}') returning id) select id from i`, [at.partyId]);
        const { rows: [il] } = await c.query<{ id: string }>(`insert into radcore.invoice_lines (invoice_id, line_no, delivery_line_id, item_id,
          qty, rate) values ($1, 1, $2, $3, 1, 1000) returning id`, [inv?.id, at.deliveryLineId, at.itemId]);
        const { rows: [cn] } = await c.query<{ id: string }>(`insert into radcore.credit_notes (kind, invoice_id, party_id, owner, business_date, reason)
          values ('value', $1, $2, 'system:test', '${DATE}', 'Test') returning id`, [inv?.id, at.partyId]);
        await c.query(`insert into radcore.credit_note_lines (credit_note_id, line_no, invoice_line_id, item_id, taxable, gst_rate, gst_rate_source,
          cgst, sgst, igst, line_total, cost) values ($1, 1, $2, $3, 1000, 5, 'Test', 25, 25, 0, 1050, 0)`, [cn?.id, il?.id, at.itemId]);
        // The header is consistent in itself (ck_credit_notes_identity): taxable plus both halves of the tax.
        await c.query(`update radcore.credit_notes set status = 'posted', number = $2, taxable = 1000, cgst = $3, sgst = $3,
          total = 1000 + 2 * $3::numeric where id = $1`, [cn?.id, `T/${tag()}`, tax]);
        await c.query('set constraints all immediate');
        return 'ok';
      } catch (e) {
        return `${(e as { code?: string }).code}:${(e as { constraint?: string }).constraint ?? ''}`;
      } finally {
        await c.query('rollback');
      }
    };
    try {
      expect(await attempt('25')).toBe('ok');
      expect(await attempt('30')).toBe('RA006:credit_note_lines_total');
    } finally {
      c.release();
    }
  });
});
