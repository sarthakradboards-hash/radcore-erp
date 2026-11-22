// RAD-115 (M3-11; ADR-006 §6, F7; ADR-007 §7–§9; the architect's rulings; Sarthak's card answer) on a real PostgreSQL,
// as the runtime login: the quick bill. Each test's item, place, stock and price list are committed; each bill runs in
// one transaction that is rolled back, under the committed company profile (tools/test-database.ts)
// and never rewrites it. The Counter customer is the seeded `walk_in` party, sold from the test's list through the
// sales.default_price_list setting on that transaction's ctx, so its shared row never changes.
import { randomBytes, randomUUID } from 'node:crypto';
import { addParty, changeParty, openFinancialYear, recordPayment, setCompanyProfile, setCreditTerms, systemAccountId, systemPartyId } from '@radcore/lib-accounts';
import { moneyString, percentString, quantityString, sightOf, unitPriceString } from '@radcore/lib-common';
import { putGstRate } from '@radcore/lib-gst';
import { AppError, decideApproval, loadConfig, principalId, Settings, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import {
  addCreditNote, addDelivery, addInvoice, addOrder, askCreditNoteApproval, CARD_ACCOUNT, confirmOrderNow, creditNoteApprovalSpec, getCreditNoteById,
  getDeliveryById, getInvoiceById, getOrderById, postDeliveryNow, postInvoiceNow, previewBill, quickBill,
} from '@radcore/lib-sales';
import { addCategory, addItem, addPlace } from '@radcore/lib-stock';
import { testSettings } from '@radcore/test-helpers';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp, listen } from '../apps/api/src/app.ts';
import accountsRoutes from '../apps/api/src/routes/accounts.ts';
import salesRoutes from '../apps/api/src/routes/sales.ts';
import { rawOf } from '../packages/db/src/tx.ts';
import { mayUse } from '../packages/lib-platform/src/scope.ts';
import { deliveredNotInvoiced } from '../packages/lib-sales/src/services/delivered.ts';
import { takeBooksTurn } from './books-turn.ts';
import { priceListFrom } from './price-list-fixture.ts';
import { postDocument, SOURCE_TABLE } from './stock-posting.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
// A fixed past day, so no test reads the run date (RC-156).
const DATE = '2026-11-15';
// The tests' own setup (an item, a place, its stock), by someone other than the counter.
const staff: Principal = { kind: 'user', userId: randomUUID(), permissions: ['items:write', 'locations:write', 'gst:write', 'cost:read',
  'parties:write', 'parties:manage'] };
const tag = () => randomBytes(3).toString('hex').toUpperCase();
const q = (s: string) => quantityString().parse(s);
const m = (s: string) => moneyString().parse(s);
const COMPANY = { legalName: 'Radboards Pvt Ltd', gstin: '27AAPFU0939F1ZV', addressLine1: 'Plot 4, Bhosari MIDC', addressLine2: null,
  city: 'Pune', pincode: '411019', reason: 'Quick bills in a test' };
class RolledBack extends Error {}

describe.skipIf(!url || !superUrl)('quick bill', { timeout: 60_000 }, () => {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  const su = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
    await su.end();
  });
  // The counter role's own grants, as a new counter person gets them (the architect's Q6 test).
  const counter = async (): Promise<Principal> => {
    const { rows } = await su.query<{ permission: string; scope: string }>("select permission, scope from radcore.role_grants where role = 'counter'");
    return { kind: 'user', userId: randomUUID(), role: 'counter', permissions: rows.map((r) => r.permission),
      ownScope: rows.filter((r) => r.scope === 'own').map((r) => r.permission) };
  };
  const run = <T>(fn: (ctx: Ctx) => Promise<T>, as: Principal = staff) => runInTransaction(db, WRITE, as, randomUUID(), fn);
  const failure = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof AppError ? `${e.code}${e.code === 'forbidden' ? `: ${e.message}` : ''}` : String(e)));
  const rowsOf = async <T extends pg.QueryResultRow>(text: string, values: unknown[]) => (await su.query<T>(text, values)).rows;

  /** A store holding `stock` of an item rated `gst`% (5) at 200.00 each (F7's PAD), and a list selling it at `rate`. */
  async function setup(o: { rate: string; stock?: string; gst?: string }) {
    const made = await run(async (ctx) => {
      await openFinancialYear(ctx, DATE);
      const { id: categoryId } = await addCategory(ctx, { name: `Test ${tag()}` });
      const hsn = `8716${String(randomBytes(2).readUInt16BE() % 10000).padStart(4, '0')}`;
      await putGstRate(ctx, { hsn, effectiveFrom: DATE, rate: percentString().parse(o.gst ?? '5'), source: 'Notification 1/2017-CT(R)', note: null, reason: 'Test' });
      const { id: itemId } = await addItem(ctx, { sku: `Q-${tag()}`, name: 'Pad', categoryId, hsn, unit: 'NOS', barcode: null, serialised: false,
        hasChassis: false, purchasePrice: unitPriceString().parse('200') });
      const { id: placeId } = await addPlace(ctx, { code: `L${tag()}`, name: `Showroom ${tag()}`, kind: 'store' });
      await postDocument(ctx, { sourceTable: SOURCE_TABLE, sourceId: randomUUID(), businessDate: DATE, ins: [{ itemId, locationId: placeId,
        qty: q(o.stock ?? '10'), rate: unitPriceString().parse('200'), batches: [{ batchNo: 'B1', qty: q(o.stock ?? '10') }] }] });
      return { itemId, placeId };
    });
    const listId = await priceListFrom(su, DATE, { [made.itemId]: o.rate });
    const [batch] = await rowsOf<{ id: string }>('select id from radcore.batches where item_id = $1', [made.itemId]);
    return { ...made, listId, batchId: batch?.id ?? '', rate: o.rate };
  }
  type At = Awaited<ReturnType<typeof setup>>;
  /** In one rolled-back transaction as a counter person (or `as`), with the company set, sold from the test's list, with
   * any other settings given. */
  async function atCounter<R>(at: At, fn: (ctx: Ctx) => Promise<R>, o: { as?: Principal; settings?: { key: string; value: unknown }[] } = {}) {
    let out: R | undefined;
    await run(async (ctx) => {
      // One rolled-back books transaction at a time (RAD-76), under the committed company profile (tools/test-database.ts).
      await takeBooksTurn(ctx);
      out = await fn({ ...ctx, settings: new Settings([{ key: 'sales.default_price_list', value: at.listId }, ...(o.settings ?? [])]) });
      throw new RolledBack();
    }, o.as ?? await counter()).catch((e: unknown) => {
      if (!(e instanceof RolledBack)) throw e;
    });
    return out as R;
  }
  type Pay = Parameters<typeof quickBill>[1]['payments'][number];
  const bill = (ctx: Ctx, at: At, qty: string, payments: Pay[], partyId?: string) => quickBill(ctx, { ...(partyId === undefined ? {} : { partyId }),
    businessDate: DATE, locationId: at.placeId, notes: null, payments, lines: [{ itemId: at.itemId, qty: q(qty), rate: unitPriceString().parse(at.rate),
      discountPercent: percentString({ max: '100' }).parse('0'), batches: [{ batchId: at.batchId, qty: q(qty) }], serials: [] }] });
  const cash = (amount: string): Pay => ({ method: 'cash', amount: m(amount) });
  /** A named customer of `stateCode`, given credit up to `limit`, committed by the tests' staff. */
  const named = (stateCode: string, limit: string | null) => run(async (ctx) => {
    const { id } = await addParty(ctx, { name: `Party ${tag()}`, kinds: ['customer'], gstin: null, pan: null, composition: false, stateCode,
      phone: null, email: null, addressLine1: '1 Main Road', addressLine2: null, city: 'Bengaluru', pincode: '560001' });
    if (limit !== null) await setCreditTerms(ctx, { id, creditDays: 30, creditLimit: m(limit), reason: 'Test' });
    return id;
  });

  // F7: 3 PADs at 345.00, delivered and invoiced in one save; 1,221.30 of lines rounds to 1,221.00, paid in cash.
  it('sells F7 to the Counter customer in one save: order, delivery, invoice and receipt, the receipt applied', async () => {
    const at = await setup({ rate: '345', gst: '18' });
    const [walkIn] = await rowsOf<{ id: string }>("select id from radcore.parties where system_key = 'walk_in'", []);
    const out = await atCounter(at, async (ctx) => {
      const b = await bill(ctx, at, '3', [cash('1221')]);
      const inv = await getInvoiceById(ctx, { id: b.invoice.id });
      const applied = await rawOf(ctx.tx).execute(sql`select coalesce(sum(amount), 0)::text as amount from radcore.payment_allocations
        where document_id = ${b.invoice.id} and direction = 'apply'`) as unknown as { rows: { amount: string }[] };
      return { b: [b.total, b.paid, b.left, b.receipts.length], party: inv.partyId === walkIn?.id, applied: applied.rows[0]?.amount,
        tax: [inv.taxable, inv.cgst, inv.sgst, inv.igst, inv.roundOff, inv.placeOfSupply], shipTo: inv.shipTo?.stateCode };
    });
    expect(out).toEqual({ b: ['1221.00', '1221.00', '0.00', 1], party: true, applied: '1221.00',
      tax: ['1035.00', '93.15', '93.15', '0.00', '-0.30', '27'], shipTo: '27' });
  });

  it('takes a split payment by card and cash and leaves the rest on a named party’s credit; a card keeps only its code', async () => {
    const at = await setup({ rate: '345', gst: '18' });
    const partyId = await named('29', '100000');
    const out = await atCounter(at, async (ctx) => {
      const b = await bill(ctx, at, '3', [cash('200'), { method: 'card', amount: m('500'), approvalCode: 'A1B2C3' }], partyId);
      const inv = await getInvoiceById(ctx, { id: b.invoice.id });
      return { b: [b.total, b.paid, b.left], tax: [inv.cgst, inv.igst, inv.shipTo?.stateCode] };
    });
    // Out of state, but handed over at the counter: CGST and SGST, shipped to the shop (CA-08's default).
    expect(out.b).toEqual(['1221.00', '700.00', '521.00']);
    expect(out.tax).toEqual(['93.15', '0.00', '27']);
  });

  it('stores a card’s approval code in the receipt’s reference, into Card settlements, and refuses card digits or no code', async () => {
    const at = await setup({ rate: '345' });
    const out = await atCounter(at, async (ctx) => {
      const b = await bill(ctx, at, '1', [{ method: 'card', amount: m('362'), approvalCode: 'A1B2C3' }]);
      const r = await rawOf(ctx.tx).execute(sql`select p.reference, a.system_key from radcore.payments p join radcore.accounts a on a.id = p.account_id
        where p.id = ${b.receipts[0]?.id ?? ''}`) as unknown as { rows: { reference: string; system_key: string }[] };
      return r.rows[0];
    });
    expect(out).toEqual({ reference: 'A1B2C3', system_key: 'card_settlements' });
    const refusals = await atCounter(at, async (ctx) => [
      await failure(bill(ctx, at, '1', [{ method: 'card', amount: m('362') }])),
      await failure(bill(ctx, at, '1', [{ method: 'card', amount: m('362'), approvalCode: '4111 1111 1111 1111' }])),
    ]);
    expect(refusals).toEqual(['approval_code_required', 'looks_like_card_number']);
    // Nor in any receipt's reference, taken outside the quick bill too, as POST /payments takes them (backend on #304).
    const [walkIn] = await rowsOf<{ id: string }>("select id from radcore.parties where system_key = 'walk_in'", []);
    expect(await atCounter(at, async (ctx) => failure(recordPayment(ctx, { kind: 'receipt', partyId: walkIn?.id ?? '', businessDate: DATE,
      amount: m('100'), accountId: await systemAccountId(ctx, 'bank'), reference: '4111-1111-1111-1111' })))).toBe('looks_like_card_number');
  });

  // The Counter customer never carries credit (the architect on RAD-115); a check's issue still refuses its bill, paid in
  // full or not (Sarthak's hold-then-complete is the quick bill's next part).
  it('refuses a walk-in bill not paid in full, one paid in full but sold below cost (needs_override), and paying more', async () => {
    const at = await setup({ rate: '345', gst: '18' });
    const cheap = await setup({ rate: '150' });
    const out = await atCounter(at, async (ctx) => [await failure(bill(ctx, at, '3', [cash('1000')])), await failure(bill(ctx, at, '3', [cash('1222')])),
      await bill(ctx, cheap, '1', [cash('158')]).then(() => 'ok', (e: unknown) => (e instanceof AppError ? `${e.code}: ${e.message}` : String(e)))]);
    expect(out).toEqual(['walk_in_pays_in_full', 'overpaid', 'needs_override: This bill needs someone else’s approval for an override; hold it to ask for one']);
  });

  // s.269ST: Rs 2 lakh or more in cash from one person in a day. The Counter customer is everyone at the counter, so its
  // cash is judged a bill at a time (the architect's MUST). Above sales.b2c_details_limit a walk-in would need a named
  // buyer, so the limit is raised on this transaction's ctx.
  it('takes two 1.5 lakh cash bills from the Counter customer in a day, and refuses one of 2 lakh in cash', async () => {
    const at = await setup({ rate: '142857.14', stock: '5' });
    const big = [{ key: 'sales.b2c_details_limit', value: '1000000.00' }];
    const out = await atCounter(at, async (ctx) => [
      (await bill(ctx, at, '1', [cash('150000')])).total, (await bill(ctx, at, '1', [cash('150000')])).total,
    ], { settings: big });
    expect(out).toEqual(['150000.00', '150000.00']);
    const at2 = await setup({ rate: '190476.19', stock: '2' });
    expect(await atCounter(at2, (ctx) => failure(bill(ctx, at2, '1', [cash('200000')])), { settings: big })).toBe('cash_over_limit');
  });

  // The round-off (the architect's follow-up 3): a delivery counts to the rupee, as its invoice will, at the delivery's
  // check and in what's delivered and not invoiced; so a no-credit party pays its rounded bill, never a paisa more.
  it('takes 362.25 paid at 362.00 and 362.50 only at 363.00, and a second paid bill after a delivery paid in advance', async () => {
    const at = await setup({ rate: '345' });
    const half = await setup({ rate: '345.24' });
    const partyId = await named('27', null);
    const out = await atCounter(at, async (ctx) => {
      // A delivery paid for in advance at its rounded 362.00, not yet invoiced: 362.25 delivered, 362.00 paid.
      await recordPayment(ctx, { kind: 'receipt', partyId, businessDate: DATE, amount: m('362'), accountId: await systemAccountId(ctx, 'cash') });
      const { id: orderId } = await addOrder(ctx, { partyId, businessDate: DATE, notes: null, lines: [{ itemId: at.itemId, qty: q('1'),
        rate: unitPriceString().parse('345'), discountPercent: percentString({ max: '100' }).parse('0') }] });
      await confirmOrderNow(ctx, { id: orderId });
      const orderLineId = (await getOrderById(ctx, { id: orderId })).lines[0]?.id ?? '';
      const { id } = await addDelivery(ctx, { orderId, locationId: at.placeId, businessDate: DATE, notes: null,
        lines: [{ orderLineId, qty: q('1'), batches: [{ batchId: at.batchId, qty: q('1') }], serials: [] }] });
      await postDeliveryNow(ctx, { id });
      return [(await bill(ctx, at, '1', [cash('362')], partyId)).total, await failure(bill(ctx, half, '1', [cash('362')], partyId))];
    });
    const paid = await atCounter(half, async (ctx) => (await bill(ctx, half, '1', [cash('363')], partyId)).total);
    expect([...out, paid]).toEqual(['362.00', 'needs_override', '363.00']);
  });

  // backend-3 on RAD-115: each delivery's net (out, less back, less billed) is rounded, never its total less what's
  // billed, so a delivery invoiced whole counts exactly 0 and one invoiced in part rounds what's left.
  it('counts a delivery with paise to the rupee while it waits, half of it once half is invoiced, and 0.00 once all is', async () => {
    const at = await setup({ rate: '345' });
    const partyId = await named('27', '100000');
    const out = await atCounter(at, async (ctx) => {
      const { id: orderId } = await addOrder(ctx, { partyId, businessDate: DATE, notes: null, lines: [{ itemId: at.itemId, qty: q('3'),
        rate: unitPriceString().parse('345'), discountPercent: percentString({ max: '100' }).parse('0') }] });
      await confirmOrderNow(ctx, { id: orderId });
      const orderLineId = (await getOrderById(ctx, { id: orderId })).lines[0]?.id ?? '';
      const { id } = await addDelivery(ctx, { orderId, locationId: at.placeId, businessDate: DATE, notes: null,
        lines: [{ orderLineId, qty: q('3'), batches: [{ batchId: at.batchId, qty: q('3') }], serials: [] }] });
      await postDeliveryNow(ctx, { id });
      const lineId = (await getDeliveryById(ctx, { id })).lines[0]?.id ?? '';
      const invoice = async (qty: string) => {
        const { id: invoiceId } = await addInvoice(ctx, { partyId, businessDate: DATE, notes: null, shipTo: null, lines: [{ deliveryLineId: lineId, qty: q(qty) }] });
        await postInvoiceNow(ctx, { id: invoiceId });
      };
      const seen = [await deliveredNotInvoiced(ctx, partyId)];
      await invoice('2');
      seen.push(await deliveredNotInvoiced(ctx, partyId));
      await invoice('1');
      return [...seen, await deliveredNotInvoiced(ctx, partyId)];
    });
    // 3 × 362.25 = 1,086.75 waits as 1,087.00; with 2 invoiced, 362.25 waits as 362.00; with all, nothing.
    expect(out).toEqual(['1087.00', '362.00', '0.00']);
  });

  // auditor-2 on #304. The Counter customer's state follows the company's, so its order is taxed as its invoice: at a state
  // left behind, 250.95 + 5% is 264 as IGST but 263 as CGST and SGST, so the order and the invoice would disagree.
  it('keeps the Counter customer in the company’s state, so a walk-in pays the invoice’s total, never a rupee less', async () => {
    const at = await setup({ rate: '250.95' });
    const out = await atCounter(at, async (ctx) => {
      await rawOf(ctx.tx).execute(sql`update radcore.parties set state_code = '29' where system_key = 'walk_in'`);
      await setCompanyProfile(ctx, COMPANY);
      const short = await failure(bill(ctx, at, '1', [cash('262')]));
      const b = await bill(ctx, at, '1', [cash('263')]);
      const inv = await getInvoiceById(ctx, { id: b.invoice.id });
      return [short, b.total, inv.cgst, inv.igst];
    });
    expect(out).toEqual(['walk_in_pays_in_full', '263.00', '6.27', '0.00']);
  });

  it('keeps the Counter customer as seeded: not switched off, re-stated or given credit through the parties routes', async () => {
    const at = await setup({ rate: '345' });
    const [walkIn] = await rowsOf<{ id: string }>("select id from radcore.parties where system_key = 'walk_in'", []);
    const id = walkIn?.id ?? '';
    const out = await atCounter(at, async (ctx) => [await failure(changeParty(ctx, { id, active: false })),
      await failure(changeParty(ctx, { id, stateCode: '29' })),
      await failure(setCreditTerms(ctx, { id, creditDays: 30, creditLimit: m('100000'), reason: 'Test' }))], { as: staff });
    expect(out).toEqual(['system_party', 'system_party', 'system_party']);
  });

  // The per-bill cash rule is the quick bill's own (recordCounterReceipt): a receipt for the Counter customer on
  // POST /payments sums the day, as for any party, so two of 1.5 lakh there wait for an owner.
  it('sums the Counter customer’s day for a receipt taken outside the quick bill', async () => {
    const at = await setup({ rate: '345' });
    const [walkIn] = await rowsOf<{ id: string }>("select id from radcore.parties where system_key = 'walk_in'", []);
    const out = await atCounter(at, async (ctx) => {
      const take = async () => (await recordPayment(ctx, { kind: 'receipt', partyId: walkIn?.id ?? '', businessDate: DATE, amount: m('150000'),
        accountId: await systemAccountId(ctx, 'cash') })).status;
      return [await take(), await take()];
    }, { as: staff });
    expect(out).toEqual(['posted', 'pending_approval']);
  });

  // The architect on RAD-115: the counter sees what the bill comes to before it's saved, the same figure the invoice
  // posts, with nothing written and only the codes of any check, never a cost or a balance.
  it('previews the posted total, writes nothing, and names an over-limit check by its code alone', async () => {
    const at = await setup({ rate: '345' });
    const partyId = await named('29', '100000');
    const noCredit = await named('27', null);
    const input = (payments: Pay[], party?: string) => ({ ...(party === undefined ? {} : { partyId: party }), businessDate: DATE, locationId: at.placeId,
      notes: null, payments, lines: [{ itemId: at.itemId, qty: q('1'), rate: unitPriceString().parse('345'),
        discountPercent: percentString({ max: '100' }).parse('0'), batches: [{ batchId: at.batchId, qty: q('1') }], serials: [] }] });
    // Through a read-only transaction, as the route runs it (auditor-2 on #325): a write would be refused. The run's
    // company profile is committed (test-database.ts).
    const readOnly = await runInTransaction(db, { readOnly: true, isolation: 'read committed' }, await counter(), randomUUID(),
      (raw) => previewBill({ ...raw, settings: new Settings([{ key: 'sales.default_price_list', value: at.listId }]) }, input([cash('362')], partyId)));
    const out = await atCounter(at, async (ctx) => {
      // The rows this transaction wrote, by their xmin: other files commit orders and numbers meanwhile (read committed).
      // It counts only this transaction's own inserts and updates: a row written in a savepoint carries a subtransaction's
      // xid, and a delete leaves xmin as it was, so the read-only preview above is what guards "writes nothing".
      const count = async () => (await rawOf(ctx.tx).execute(sql`with me as (select pg_current_xact_id_if_assigned()::text::xid as x)
        select (select count(*) from radcore.sales_orders, me where xmin = me.x)::int as o,
        (select count(*) from radcore.payments, me where xmin = me.x)::int as p,
        (select count(*) from radcore.number_counters, me where xmin = me.x)::int as n`) as unknown as {
        rows: { o: number; p: number; n: number }[] }).rows[0];
      const before = await count();
      const seen = await previewBill(ctx, input([cash('362')], partyId));
      const short = await previewBill(ctx, input([cash('100')], noCredit));
      const walkIn = await previewBill(ctx, input([cash('100')]));
      const after = await count();
      const bill = await quickBill(ctx, input([cash('362')], partyId));
      return { preview: [seen.total, seen.roundOff, seen.cgst, seen.igst, seen.left, seen.issues], posted: bill.total, written: after,
        before, short: short.issues, shortKeys: Object.keys(short).toSorted(), walkIn: walkIn.issues };
    });
    // 345.00 + 2.5% CGST (8.63) + 2.5% SGST (8.63) is 362.26, billed as 362.00.
    expect(out.preview).toEqual(['362.00', '-0.26', '8.63', '0.00', '0.00', []]);
    expect(out.posted).toBe('362.00');
    expect([out.before, out.written]).toEqual([{ o: 0, p: 0, n: 0 }, { o: 0, p: 0, n: 0 }]);
    expect([readOnly.total, readOnly.issues]).toEqual(['362.00', []]);
    // A named party with no credit paying short is over its limit, named, and no figure of it answered.
    expect(out.short).toEqual(['over_limit']);
    // The Counter customer can't be given credit at all, so it's asked for the rest, or for the buyer, as the save asks.
    expect(out.walkIn).toEqual(['walk_in_pays_in_full']);
    expect(out.shortKeys).toEqual(['cgst', 'igst', 'issues', 'left', 'lines', 'paid', 'placeOfSupply', 'roundOff', 'sgst', 'taxable', 'total']);
  });

  it('keeps the Counter customer to the quick bill: an order of its own is refused', async () => {
    const at = await setup({ rate: '345' });
    const [walkIn] = await rowsOf<{ id: string }>("select id from radcore.parties where system_key = 'walk_in'", []);
    const out = await atCounter(at, (ctx) => failure(addOrder(ctx, { partyId: walkIn?.id ?? '', businessDate: DATE, notes: null,
      lines: [{ itemId: at.itemId, qty: q('1'), rate: unitPriceString().parse('345'), discountPercent: percentString({ max: '100' }).parse('0') }] })));
    expect(out).toBe('counter_customer_only');
  });

  it('points card payments only at an active cash or bank account (sales.card_account)', async () => {
    const out = await run(async (ctx) => {
      const id = async (key: string) => systemAccountId(ctx, key);
      const check = (v: string | null) => CARD_ACCOUNT.check?.(ctx, v);
      return [await check(null), await check(await id('bank')), await check(await id('card_settlements')), typeof await check(await id('sales'))];
    });
    expect(out).toEqual([null, null, null, 'string']);
  });

  it('names every missing stage key at once, before anything is written', async () => {
    const at = await setup({ rate: '345' });
    const clerk = await counter();
    const without = { ...clerk, permissions: clerk.permissions.filter((p) => p !== 'deliveries:write' && p !== 'sales:write') };
    expect(await atCounter(at, (ctx) => failure(bill(ctx, at, '1', [cash('362')])), { as: without }))
      .toBe('forbidden: A quick bill needs sales:write, deliveries:write');
  });

  // Through the API: the counter's receipts are the quick bill's, so its own grants record no free-standing payment and
  // cancel none (payments:write, the architect's Q6); and the card code's refusal is the route's, by name, not a 500.
  it('refuses the counter on POST /payments and on cancelling a receipt, and answers a card with no code by name', async () => {
    const config = loadConfig(testSettings(), 'api');
    const clerk = await counter();
    const app = createApp(config, { info: () => undefined, error: () => undefined },
      { db, authenticate: async () => clerk, routes: [...salesRoutes, ...accountsRoutes] });
    const server = await listen(app, 0, '127.0.0.1');
    const send = async (path: string, body: unknown) => {
      const res = await fetch(`http://127.0.0.1:${server.port}${path}`, { method: 'POST', body: JSON.stringify(body),
        headers: { 'content-type': 'application/json', origin: config.publicOrigin, 'idempotency-key': randomUUID() } });
      return [res.status, (await res.json() as { code?: string }).code ?? 'ok'];
    };
    try {
      const at = await setup({ rate: '345' });
      expect(await send('/sales/quick-bills', { businessDate: DATE, locationId: at.placeId, notes: null,
        lines: [{ itemId: at.itemId, qty: '1', rate: '345', discountPercent: '0', batches: [{ batchId: at.batchId, qty: '1' }], serials: [] }],
        payments: [{ method: 'card', amount: '362' }] })).toEqual([422, 'approval_code_required']);
      // A quote, once accepted, makes an order directly, so it may not name the Counter customer either (backend-3 on #304).
      const [walkIn] = await rowsOf<{ id: string }>("select id from radcore.parties where system_key = 'walk_in'", []);
      expect(await send('/sales/quotes', { partyId: walkIn?.id, businessDate: DATE, validUntil: null, notes: null,
        lines: [{ itemId: at.itemId, qty: '1', rate: '345', discountPercent: '0' }] })).toEqual([422, 'counter_customer_only']);
      expect(await send('/payments', { kind: 'receipt', partyId: randomUUID(), businessDate: DATE, amount: '1', accountId: randomUUID() }))
        .toEqual([403, 'forbidden']);
      expect(await send(`/payments/${randomUUID()}/cancel`, { businessDate: DATE, reason: 'Test' })).toEqual([403, 'forbidden']);
    } finally {
      await server.stop();
    }
  });

  // The guard on the walk-in skip (the architect on RAD-115, delivered.ts's counterCustomer): every path that touches
  // the Counter customer leaves its Debtors balance at 0 or below, and nothing delivered to it left uninvoiced.
  it('never leaves the Counter customer owing, whatever a counter sale tries', async () => {
    const at = await setup({ rate: '345', stock: '20' });
    // Made before any request, as the approval engine reads its account's age (RAD-38).
    const { rows: made } = await pool.query<{ id: string }>(`with p as (select set_config('app.principal', 'system:test', true))
      insert into radcore.users (email, display_name, role) select $1, 'Approver', 'accounts' from p returning id`,
    [`quick-bills-${randomUUID()}@example.test`]);
    const approver: Principal = { kind: 'user', userId: made[0]?.id ?? '', permissions: ['credit_notes:approve'], role: 'accounts' };
    const out = await atCounter(at, async (ctx) => {
      /** The same transaction as `p`, as the credit-note tests act as their approver (set_config and the key checks). */
      const actingAs = async (p: Principal): Promise<Ctx> => {
        await rawOf(ctx.tx).execute(sql`select set_config('app.principal', ${principalId(p)}, true)`);
        const can = (permission: string, record?: { owner: string }) => mayUse(p, permission, record);
        return Object.freeze({ ...ctx, principal: p, can, see: (permission: string, record: { owner: string }) => {
          if (!can(permission, record)) throw new AppError('not_found', 'Not found');
        }, shows: sightOf(p.permissions) });
      };
      const walkIn = await systemPartyId(ctx, 'walk_in');
      const owed = async () => (await rawOf(ctx.tx).execute(sql`select
        (select coalesce(sum(l.debit - l.credit), 0) from radcore.journal_lines l join radcore.accounts a on a.id = l.account_id
          where a.system_key = 'debtors' and l.party_id = ${walkIn}) <= 0
        and not exists (select 1 from radcore.delivery_lines dl join radcore.deliveries d on d.id = dl.delivery_id
          where d.party_id = ${walkIn} and d.status = 'posted' and not exists (select 1 from radcore.invoice_lines il
            join radcore.invoices i on i.id = il.invoice_id where il.delivery_line_id = dl.id and i.status = 'posted')) as ok`) as unknown as {
        rows: { ok: boolean }[] }).rows[0]?.ok;
      const steps: [string, string, boolean | undefined][] = [];
      const step = async (name: string, p: Promise<unknown>) => steps.push([name, await failure(p), await owed()]);
      await step('paid in cash', bill(ctx, at, '1', [cash('362')]));
      await step('split by card and cash', bill(ctx, at, '2', [cash('225'), { method: 'card', amount: m('500'), approvalCode: 'A1B2C3' }]));
      await step('short', bill(ctx, at, '1', [cash('300')]));
      await step('over', bill(ctx, at, '1', [cash('400')]));
      await step('an order of its own', addOrder(ctx, { partyId: walkIn, businessDate: DATE, notes: null, lines: [{ itemId: at.itemId, qty: q('1'),
        rate: unitPriceString().parse('345'), discountPercent: percentString({ max: '100' }).parse('0') }] }));
      // POST /payments refuses the counter (the test below); a receipt taken another way only takes it into credit.
      await step('a receipt outside the bill', recordPayment(ctx, { kind: 'receipt', partyId: walkIn, businessDate: DATE, amount: m('100'),
        accountId: await systemAccountId(ctx, 'cash') }));
      // The one way cash goes out to it, a debit to its Debtors (auditor-2 on #341): goods back on a credit note with a
      // counter refund (F26), capped at the credit, approved and posted.
      await step('goods back with a counter refund', (async () => {
        const sold = await bill(ctx, at, '1', [cash('362')]);
        const invoiceLineId = (await getInvoiceById(ctx, { id: sold.invoice.id })).lines[0]?.id ?? '';
        const { id } = await addCreditNote(ctx, { invoiceId: sold.invoice.id, kind: 'goods', businessDate: DATE, locationId: at.placeId,
          reason: 'Came back unused', refund: { amount: m('362'), accountId: await systemAccountId(ctx, 'cash') },
          lines: [{ invoiceLineId, qty: q('1'), batches: [{ batchId: at.batchId, qty: q('1') }], serials: [] }] });
        const asked = await askCreditNoteApproval(ctx, { id });
        await decideApproval(await actingAs(approver), creditNoteApprovalSpec, asked.id, { decision: 'approve', versionHash: asked.versionHash });
        await actingAs(ctx.principal);
        const note = await getCreditNoteById(ctx, { id });
        if (note.status !== 'posted') throw new Error(`the credit note is ${note.status}`);
      })());
      return steps;
    });
    expect(out).toEqual([['paid in cash', 'ok', true], ['split by card and cash', 'ok', true], ['short', 'walk_in_pays_in_full', true],
      ['over', 'overpaid', true], ['an order of its own', 'counter_customer_only', true], ['a receipt outside the bill', 'ok', true],
      ['goods back with a counter refund', 'ok', true]]);
  });

  // RAD-115's save under 2 seconds (the architect's option (a)): a walk-in bill reads no more of the books with a longer
  // history. The rows each one reads, from PostgreSQL's per-transaction table counters, grow by less than one row for
  // the 30 bills added between the two (fetches count other saves' dead rows too, so not exactly equal); reading the
  // history grows them by hundreds. Clocks are no test's business (RC-156); the timings at 500 and 5,000 are on the ticket.
  it('reads no more of the walk-in’s history as it grows', async () => {
    const at = await setup({ rate: '345', stock: '40' });
    const out = await atCounter(at, async (ctx) => {
      const read = async () => Number((await rawOf(ctx.tx).execute(sql`select coalesce(sum(coalesce(idx_tup_fetch, 0)), 0)::text as n
        from pg_stat_xact_user_tables where schemaname = 'radcore' and relname in ('journal_lines', 'deliveries', 'delivery_lines', 'invoices',
          'invoice_lines', 'delivery_returns', 'delivery_return_lines')`) as unknown as { rows: { n: string }[] }).rows[0]?.n);
      const one = async () => {
        const before = await read();
        await bill(ctx, at, '1', [cash('362')]);
        return await read() - before;
      };
      for (let n = 0; n < 3; n += 1) await bill(ctx, at, '1', [cash('362')]);
      const early = await one();
      for (let n = 0; n < 30; n += 1) await bill(ctx, at, '1', [cash('362')]);
      return [early, await one()];
    });
    expect((out[1] ?? 0) - (out[0] ?? 0)).toBeLessThan(30);
  });
});
