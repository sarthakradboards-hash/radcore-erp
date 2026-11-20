// RAD-114 PR 2 (M3-10; ADR-007 §6; ADR-006 §4, §6, F9, F25, F26; RC-126, RC-128, RC-207; CA-10) on a real
// PostgreSQL, as the runtime login: credit notes. Each test's deliveries are committed; its invoices and notes post
// inside one transaction that is rolled back, with the company profile set there, since the one company row must stay
// unset for company.test.ts. Every note is approved by someone else, whose decision runs in that same transaction as
// them (actingAs): the request is the maker's, the approval the approver's, as two requests would be.
import { randomBytes, randomUUID } from 'node:crypto';
import {
  addParty, allocatePayment, journalEntryById, journalPage, openFinancialYear, paidOf, recordPayment, reverseCreditApplication,
  setCompanyProfile, setCreditTerms,
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
const COMPANY = { legalName: 'Radboards Pvt Ltd', gstin: '27AAPFU0939F1ZV', addressLine1: 'Plot 4, Bhosari MIDC', addressLine2: null,
  city: 'Pune', pincode: '411019', reason: 'Credit notes in a test' };
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
      await setCompanyProfile(ctx, COMPANY);
      out = await fn(ctx);
      throw new RolledBack();
    }).catch((e: unknown) => {
      if (!(e instanceof RolledBack)) throw e;
    });
    return out as R;
  }
  // The approver: a person whose account is committed before any request they decide (approver_too_new).
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
  const goodsBack = (ctx: Ctx, at: At, inv: Inv, qty: string, more: { serials?: string[]; on?: string } = {}) => addCreditNote(ctx, {
    invoiceId: inv.id, kind: 'goods', businessDate: more.on ?? at.on, locationId: at.placeId, reason: 'Came back unused', refund: null,
    lines: [{ invoiceLineId: inv.lineId, qty: q(qty), batches: [{ batchId: at.batchId, qty: q(qty) }], serials: more.serials ?? [] }] });
  const valueOff = (ctx: Ctx, at: At, inv: Inv, taxable: string, on = at.on) => addCreditNote(ctx, { invoiceId: inv.id, kind: 'value',
    businessDate: on, locationId: null, reason: 'Discount agreed', refund: null, lines: [{ invoiceLineId: inv.lineId, taxable: m(taxable) }] });
  /** Asks, then approves as `approver` in the same transaction; back as the maker after. */
  const approve = async (ctx: Ctx, id: string, approver: Principal, settings?: Settings) => {
    const asked = await askCreditNoteApproval(ctx, { id });
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
    const at = await setup({ stock: '2', stockRate: '61250', rate: '80000', sold: '1' });
    await run((ctx) => postDocument(ctx, { sourceTable: SOURCE_TABLE, sourceId: randomUUID(), businessDate: DATE, ins: [{ itemId: at.itemId,
      locationId: at.placeId, qty: q('2'), rate: unitPriceString().parse('62375'), batches: [{ batchNo: 'B2', qty: q('2') }] }] }));
    const approver = await approverWith(['credit_notes:approve']);
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
    const at = await setup({ stock: '1', stockRate: '61250', rate: '80000', sold: '1' });
    const approver = await approverWith(['credit_notes:approve']);
    const out = await inBooks(async (ctx) => {
      const inv = await invoice(ctx, at);
      const { id } = await valueOff(ctx, at, inv, '1000');
      await approve(ctx, id, approver);
      const entry = await entryOf(ctx, id, DATE);
      // 79,000.00 of taxable value is left: 79,000.01 is refused; all of it clears the tax left too, and then nothing is.
      const over = await failure(valueOff(ctx, at, inv, '79000.01'));
      const rest = await valueOff(ctx, at, inv, '79000');
      await approve(ctx, rest.id, approver);
      const more = await failure(valueOff(ctx, at, inv, '0.01'));
      // Two of the one scooter can't come back.
      const two = await failure(goodsBack(ctx, at, inv, '2'));
      return { entry, over, rest: (await getCreditNoteById(ctx, { id: rest.id })).total, more, two, stock: await onHand(ctx, at) };
    });
    expect(out).toEqual({ entry: ['Sales 1000.00 0.00', 'Output CGST 25.00 0.00', 'Output SGST 25.00 0.00', 'Debtors 0.00 1050.00'],
      over: 'exceeds_invoice', rest: '82950.00', more: 'exceeds_invoice', two: 'exceeds_invoice', stock: { qty: '0', value: '0.00' } });
  });

  // F25, CA-10: an invoice of FY 2025-26, deadline 30 November 2026 by default. With the setting earlier, the same note
  // is late and its tax goes to GST Borne on Late Credit Notes; Output GST isn't touched.
  it('posts a note past section 34’s limit to GST Borne on Late Credit Notes (F25)', async () => {
    const at = await setup({ on: '2026-03-10', stock: '1', stockRate: '61250', rate: '80000', sold: '1' });
    const approver = await approverWith(['credit_notes:approve']);
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

  // F26: one pad of three back at the counter, its share of what they went out at; the note's lines come to 407.10 and
  // its total to 407.00, the round-off a credit. The invoice was paid in cash, so nothing applies: 407.00 is the
  // customer's, to refund.
  it('takes one pad of three back at its share, rounds F26’s total to 407.00, and applies nothing to a paid invoice', async () => {
    const at = await setup({ gst: '18', stock: '10', stockRate: '200', rate: '345', sold: '3' });
    const approver = await approverWith(['credit_notes:approve']);
    const out = await inBooks(async (ctx) => {
      const inv = await invoice(ctx, at);
      const cash = (await rows<{ id: string }>(ctx, sql`select id from radcore.accounts where system_key = 'cash'`))[0]?.id ?? '';
      const receipt = await recordPayment(ctx, { kind: 'receipt', partyId: at.partyId, businessDate: DATE, amount: m('1221'), accountId: cash });
      await allocatePayment(ctx, { id: receipt.id, businessDate: DATE, lines: [{ documentTable: 'invoices', documentId: inv.id, amount: m('1221') }] });
      const { id } = await goodsBack(ctx, at, inv, '1');
      const note = await approve(ctx, id, approver);
      return { note: [note.taxable, note.cgst, note.roundOff, note.total], entry: await entryOf(ctx, id, DATE),
        paid: (await paidOf(ctx, 'invoices', [inv.id])).get(inv.id)?.credited };
    });
    expect(out).toEqual({ note: ['345.00', '31.05', '-0.10', '407.00'],
      entry: ['Sales 345.00 0.00', 'Output CGST 31.05 0.00', 'Output SGST 31.05 0.00', 'Debtors 0.00 407.00', 'Round Off 0.00 0.10',
        'Stock in Hand 200.00 0.00', 'Cost of Goods Sold 0.00 200.00'], paid: '0.00' });
  });

  // RC-128: a serialised unit sold on the invoice comes back `returned`: ours again, its sale cleared. RC-207: the
  // note's cancellation sends it out again at the value it came back at, and is refused while the note is applied.
  it('clears a returned unit’s sale, and cancels the note only once its application is reversed, the goods out again', async () => {
    const serial = `SN-${tag()}`;
    const at = await setup({ stock: '1', stockRate: '61250', rate: '80000', sold: '1', serials: [serial] });
    const approver = await approverWith(['credit_notes:approve']);
    const out = await inBooks(async (ctx) => {
      const inv = await invoice(ctx, at);
      const unit = async () => (await rows<{ ownership: string; sale: string | null }>(ctx, sql`select ownership, sale_line_id as sale
        from radcore.units where item_id = ${at.itemId}`))[0];
      const sold = await unit();
      const { id } = await goodsBack(ctx, at, inv, '1', { serials: [serial] });
      await approve(ctx, id, approver);
      const back = await unit();
      // The invoice can't be cancelled while the note stands.
      const invoiceCancel = await failure(cancelInvoiceNow(ctx, { id: inv.id, businessDate: DATE, reason: 'Billed in error' }));
      const applied = await failure(cancelCreditNoteNow(ctx, { id, businessDate: DATE, reason: 'Raised in error' }));
      const [application] = await rows<{ id: string }>(ctx, sql`select id from radcore.credit_applications
        where credit_table = 'credit_notes' and credit_id = ${id} and direction = 'apply'`);
      await reverseCreditApplication(ctx, { id: application?.id ?? '', businessDate: DATE, reason: 'Raised in error' });
      await cancelCreditNoteNow(ctx, { id, businessDate: DATE, reason: 'Raised in error' });
      return { sold: sold?.ownership, back, invoiceCancel, applied, status: (await getCreditNoteById(ctx, { id })).status,
        mirror: await entryOf(ctx, id, DATE, true), stock: await onHand(ctx, at), again: (await unit())?.ownership };
    });
    expect(out).toEqual({ sold: 'customer', back: { ownership: 'ours', sale: null }, invoiceCancel: 'credit_note_stands',
      applied: 'still_applied', status: 'cancelled',
      mirror: ['Sales 0.00 80000.00', 'Output CGST 0.00 2000.00', 'Output SGST 0.00 2000.00', 'Debtors 84000.00 0.00',
        'Stock in Hand 0.00 61250.00', 'Cost of Goods Sold 61250.00 0.00'], stock: { qty: '0', value: '0.00' }, again: 'customer' });
  });

  // ADR-005 §2, as the superuser: a posted note's header must match its lines at commit (RA006).
  it('refuses a posted note whose header doesn’t match its lines at commit', async () => {
    const at = await setup({ stock: '1', stockRate: '100', rate: '1000', sold: '1' });
    const c = await su.connect();
    const attempt = async (total: string) => {
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
        const { rows: [entry] } = await c.query<{ id: string }>(`insert into radcore.journal_entries (number, kind, business_date, source_table, source_id)
          values ($1, 'credit_note', '${DATE}', 'credit_notes', $2) returning id`, [`T/${tag()}`, cn?.id]);
        await c.query(`update radcore.credit_notes set status = 'posted', number = $2, posted_entry_id = $3, taxable = 1000, cgst = 25, sgst = 25,
          total = $4 where id = $1`, [cn?.id, `T/${tag()}`, entry?.id, total]);
        await c.query('set constraints all immediate');
        return 'ok';
      } catch (e) {
        return `${(e as { code?: string }).code}:${(e as { constraint?: string }).constraint ?? ''}`;
      } finally {
        await c.query('rollback');
      }
    };
    try {
      expect(await attempt('1060')).toBe('RA006:credit_note_lines_total');
    } finally {
      c.release();
    }
  });
});
