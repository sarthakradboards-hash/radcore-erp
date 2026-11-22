// RAD-113 (M3-09; ADR-007 §4, §7, §9; ADR-006 §6, F6, F7; RC-022, RC-113) on a real PostgreSQL, as the runtime login:
// invoices of posted deliveries. Each test's deliveries are committed; its invoices post inside one transaction that is
// rolled back, under the committed company profile (tools/test-database.ts) and never rewrites it. The
// database's own guards on a posted invoice (RA004) and its header-against-lines check at commit (RA006) are proved
// as the superuser at the end.
import { randomBytes, randomUUID } from 'node:crypto';
import {
  addParty, allocatePayment, journalEntryById, journalPage, openFinancialYear, paidOf, recordPayment, setCompanyProfile, setCreditTerms,
} from '@radcore/lib-accounts';
import { moneyString, percentString, quantityString, unitPriceString } from '@radcore/lib-common';
import { putGstRate } from '@radcore/lib-gst';
import { AppError, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import {
  addDelivery, addDeliveryReturn, addInvoice, addOrder, confirmOrderNow, getDeliveryById, getInvoiceById, getOrderById, listToInvoicePage,
  cancelInvoiceNow, postDeliveryNow, postDeliveryReturnNow, postInvoiceNow, setPartyList,
} from '@radcore/lib-sales';
import { addCategory, addItem, addPlace } from '@radcore/lib-stock';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { takeBooksTurn } from './books-turn.ts';
import { priceListFrom } from './price-list-fixture.ts';
import { postDocument, SOURCE_TABLE } from './stock-posting.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
// A fixed past day, so no test reads the run date (RC-156); the services bound dates by the real one.
const DATE = '2026-11-15';
const KEYS = ['sales:read', 'sales:write', 'deliveries:write', 'invoices:write', 'invoices:cancel', 'parties:write', 'parties:manage', 'items:write',
  'locations:write', 'cost:read', 'gst:write', 'journal:read', 'company:write', 'payments:write', 'prices:approve'];
const staff: Principal = { kind: 'user', userId: randomUUID(), permissions: KEYS };
const tag = () => randomBytes(3).toString('hex').toUpperCase();
const q = (s: string) => quantityString().parse(s);
const m = (s: string) => moneyString().parse(s);
// The company, in Maharashtra (27), as company.test.ts's second profile.
const COMPANY = { legalName: 'Radboards Pvt Ltd', gstin: '27AAPFU0939F1ZV', addressLine1: 'Plot 4, Bhosari MIDC', addressLine2: null,
  city: 'Pune', pincode: '411019', reason: 'Invoicing in a test' };
class RolledBack extends Error {}

describe.skipIf(!url || !superUrl)('invoices', () => {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  const su = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
    await su.end();
  });
  const run = <T>(fn: (ctx: Ctx) => Promise<T>, as: Principal = staff) => runInTransaction(db, WRITE, as, randomUUID(), fn);
  const failure = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof AppError ? e.code : String(e)));
  /** `fn` in one transaction with the company profile set, then rolled back: what it answers, or the code it threw. */
  async function inBooks<R>(fn: (ctx: Ctx) => Promise<R>, as: Principal = staff): Promise<R> {
    let out: R | undefined;
    await run(async (ctx) => {
      // One rolled-back books transaction at a time (RAD-76), under the committed company profile (tools/test-database.ts).
      await takeBooksTurn(ctx);
      out = await fn(ctx);
      throw new RolledBack();
    }, as).catch((e: unknown) => {
      if (!(e instanceof RolledBack)) throw e;
    });
    return out as R;
  }

  type Setup = { kind?: 'customer' | 'dealer'; state?: string; gstin?: string | null; address?: boolean; gst?: string; stock: string;
    stockRate: string; ordered: string;
    rate: string; delivered: string; maker?: Principal };
  /** A customer with credit (in `state`, with or without a GSTIN and an address), an item rated `gst`%, a store holding
   * `stock` at `stockRate`, a confirmed order for `ordered` at `rate`, and a posted delivery of `delivered` of it. */
  async function setup(o: Setup) {
    const made = await run(async (ctx) => {
      await openFinancialYear(ctx, DATE);
      const { id: partyId } = await addParty(ctx, { name: `Party ${tag()}`, kinds: [o.kind ?? 'customer'], gstin: o.gstin ?? null, pan: null,
        composition: false,
        stateCode: o.state ?? '27', phone: null, email: null, addressLine1: o.address === false ? null : '12 MG Road', addressLine2: null,
        city: o.address === false ? null : 'Pune', pincode: o.address === false ? null : '411001' });
      await setCreditTerms(ctx, { id: partyId, creditDays: 30, creditLimit: m('100000000'), reason: 'Test' });
      const { id: categoryId } = await addCategory(ctx, { name: `Test ${tag()}` });
      // An HSN of its own, rated from the test's day, so no other file's rate is the one in force for it (RC-115).
      const hsn = `8716${String(randomBytes(2).readUInt16BE() % 10000).padStart(4, '0')}`;
      await putGstRate(ctx, { hsn, effectiveFrom: DATE, rate: percentString().parse(o.gst ?? '5'), source: 'Notification 1/2017-CT(R)', note: null,
        reason: 'Test' });
      const { id: itemId } = await addItem(ctx, { sku: `I-${tag()}`, name: 'Scooter', categoryId, hsn, unit: 'NOS', barcode: null,
        serialised: false, hasChassis: false, purchasePrice: unitPriceString().parse('1') });
      const { id: placeId } = await addPlace(ctx, { code: `L${tag()}`, name: `Store ${tag()}`, kind: 'store' });
      await postDocument(ctx, { sourceTable: SOURCE_TABLE, sourceId: randomUUID(), businessDate: DATE, ins: [{ itemId, locationId: placeId,
        qty: q(o.stock), rate: unitPriceString().parse(o.stockRate), batches: [{ batchNo: 'B1', qty: q(o.stock) }] }] });
      return { partyId, itemId, placeId, hsn };
    }, o.maker);
    // The party's list prices the item at the order's rate: a priced line with no list rate needs approval (#256).
    await priceListFrom(su, DATE, { [made.itemId]: o.rate }, { partyId: made.partyId });
    const at = await run(async (ctx) => {
      const { partyId, itemId, placeId, hsn } = made;
      const { id: orderId } = await addOrder(ctx, { partyId, businessDate: DATE, notes: null, lines: [{ itemId, qty: q(o.ordered),
        rate: unitPriceString().parse(o.rate), discountPercent: percentString({ max: '100' }).parse('0') }] });
      await confirmOrderNow(ctx, { id: orderId });
      return { partyId, itemId, placeId, hsn, orderId, orderLineId: (await getOrderById(ctx, { id: orderId })).lines[0]?.id ?? '' };
    }, o.maker);
    const { rows: [batch] } = await su.query<{ id: string }>('select id from radcore.batches where item_id = $1', [at.itemId]);
    const delivery = await run(async (ctx) => {
      const { id } = await addDelivery(ctx, { orderId: at.orderId, locationId: at.placeId, businessDate: DATE, notes: null,
        lines: [{ orderLineId: at.orderLineId, qty: q(o.delivered), batches: [{ batchId: batch?.id ?? '', qty: q(o.delivered) }], serials: [] }] });
      await postDeliveryNow(ctx, { id });
      return getDeliveryById(ctx, { id });
    });
    return { ...at, batchId: batch?.id ?? '', deliveryId: delivery.id, deliveryLineId: delivery.lines[0]?.id ?? '', sentValue: delivery.lines[0]?.value };
  }
  type At = Awaited<ReturnType<typeof setup>>;
  /** Another order for the same party and item, made by `maker`, confirmed and delivered whole (`qty`): its delivery line. */
  const alsoFor = (at: At, qty: string, maker: Principal) => run(async (ctx) => {
    const { id: orderId } = await addOrder(ctx, { partyId: at.partyId, businessDate: DATE, notes: null, lines: [{ itemId: at.itemId, qty: q(qty),
      rate: unitPriceString().parse('1000'), discountPercent: percentString({ max: '100' }).parse('0') }] });
    await confirmOrderNow(ctx, { id: orderId });
    const orderLineId = (await getOrderById(ctx, { id: orderId })).lines[0]?.id ?? '';
    const { id } = await addDelivery(ctx, { orderId, locationId: at.placeId, businessDate: DATE, notes: null,
      lines: [{ orderLineId, qty: q(qty), batches: [{ batchId: at.batchId, qty: q(qty) }], serials: [] }] });
    await postDeliveryNow(ctx, { id });
    return (await getDeliveryById(ctx, { id })).lines[0]?.id ?? '';
  }, maker);
  const bill = (ctx: Ctx, at: At, qty: string, more: { businessDate?: string; rate?: string; shipTo?: { name: string; address: string; stateCode: string } } = {}) =>
    addInvoice(ctx, { partyId: at.partyId, businessDate: more.businessDate ?? DATE, notes: null, shipTo: more.shipTo ?? null,
      lines: [{ deliveryLineId: at.deliveryLineId, qty: q(qty), ...(more.rate === undefined ? {} : { rate: unitPriceString().parse(more.rate) }) }] });
  const post = async (ctx: Ctx, at: At, qty: string, more: Parameters<typeof bill>[3] = {}) => {
    const { id } = await bill(ctx, at, qty, more);
    return { id, ...(await postInvoiceNow(ctx, { id })) };
  };
  /** An invoice's entry as lines "account debit credit", in its order. */
  const entryOf = async (ctx: Ctx, invoiceId: string) => {
    const page = await journalPage(ctx, { limit: 100, filter: { from: DATE, to: DATE, kind: 'invoice' } });
    const id = page.items.find((e) => e.source.id === invoiceId)?.id ?? '';
    return (await journalEntryById(ctx, { id })).lines.map((l) => `${l.account.name} ${l.debit} ${l.credit}${l.partyId === null ? '' : ' party'}`);
  };

  // F6 (RC-022): the delivery's cost moves from GDNI to COGS; the issuer is frozen, so a later profile change doesn't
  // reach it; each line keeps the rate in force when it posted and its source; its total is its Debtors line.
  it('posts F6: Debtors 84,000.00 against Sales and CGST and SGST, and the cost from GDNI to COGS, frozen once posted', async () => {
    const at = await setup({ stock: '4', stockRate: '61250', ordered: '1', rate: '80000', delivered: '1' });
    const out = await inBooks(async (ctx) => {
      const posted = await post(ctx, at, '1');
      const entry = await entryOf(ctx, posted.id);
      await setCompanyProfile(ctx, { ...COMPANY, legalName: 'Radboards Mobility Pvt Ltd', city: 'Mumbai', pincode: '400001' });
      await putGstRate(ctx, { hsn: at.hsn, effectiveFrom: DATE, rate: percentString().parse('12'), source: 'A later notification', note: null, reason: 'Test' });
      const invoice = await getInvoiceById(ctx, { id: posted.id });
      const waiting = await listToInvoicePage(ctx, { limit: 50, filter: { partyId: at.partyId } });
      return { posted, entry, invoice, waiting: waiting.items.length };
    });
    expect([out.posted.number, out.posted.total]).toEqual([expect.stringMatching(/^INV\/\d{2}-\d{2}\/\d{5}$/), '84000.00']);
    expect(out.entry).toEqual(['Debtors 84000.00 0.00 party', 'Sales 0.00 80000.00', 'Output CGST 0.00 2000.00', 'Output SGST 0.00 2000.00',
      'Cost of Goods Sold 61250.00 0.00', 'Goods Delivered Not Invoiced 0.00 61250.00']);
    const i = out.invoice;
    expect([i.status, i.total, i.taxable, i.cgst, i.sgst, i.igst, i.roundOff, i.placeOfSupply]).toEqual(['posted', '84000.00', '80000.00',
      '2000.00', '2000.00', '0.00', '0.00', '27']);
    expect([i.issuer?.legalName, i.issuer?.gstin, i.issuer?.city, i.buyer?.stateCode, i.buyer?.gstin]).toEqual(['Radboards Pvt Ltd',
      '27AAPFU0939F1ZV', 'Pune', '27', null]);
    expect(i.lines.map((l) => [l.hsn, l.gstRate, l.gstRateSource, l.taxable, l.cgst, l.lineTotal, l.cost])).toEqual([[at.hsn, '5.000000',
      'Notification 1/2017-CT(R)', '80000.00', '2000.00', '84000.00', '61250.00']]);
    expect(out.waiting).toBe(0);
  });

  // F7 (ADR-005 §2, RAD-96): a total rounded to the rupee, with its round-off under 1 posted to Round Off.
  it('rounds F7’s 1,221.30 to 1,221.00, posting the 0.30 to Round Off', async () => {
    const at = await setup({ gst: '18', stock: '10', stockRate: '200', ordered: '3', rate: '345', delivered: '3' });
    const out = await inBooks(async (ctx) => {
      const posted = await post(ctx, at, '3');
      return { posted, entry: await entryOf(ctx, posted.id), invoice: await getInvoiceById(ctx, { id: posted.id }) };
    });
    expect([out.invoice.taxable, out.invoice.cgst, out.invoice.sgst, out.invoice.roundOff, out.invoice.total])
      .toEqual(['1035.00', '93.15', '93.15', '-0.30', '1221.00']);
    expect(out.entry).toEqual(['Debtors 1221.00 0.00 party', 'Sales 0.00 1035.00', 'Output CGST 0.00 93.15', 'Output SGST 0.00 93.15',
      'Round Off 0.30 0.00', 'Cost of Goods Sold 600.00 0.00', 'Goods Delivered Not Invoiced 0.00 600.00']);
  });

  // CA-08: the place of supply is the buyer's state, or the ship-to state: IGST between states, CGST and SGST within.
  it('charges IGST to a buyer in another state, and CGST and SGST when the goods go to one in ours', async () => {
    const at = await setup({ state: '29', gstin: '29AAACR5055K1Z3', stock: '2', stockRate: '100', ordered: '2', rate: '1000', delivered: '2' });
    const out = await inBooks(async (ctx) => {
      const away = await post(ctx, at, '1');
      const here = await post(ctx, at, '1', { shipTo: { name: 'Site office', address: '3 Nashik Road, Nashik', stateCode: '27' } });
      return [await getInvoiceById(ctx, { id: away.id }), await getInvoiceById(ctx, { id: here.id })];
    });
    expect(out.map((i) => [i.placeOfSupply, i.cgst, i.sgst, i.igst, i.buyer?.gstin])).toEqual([['29', '0.00', '0.00', '50.00', '29AAACR5055K1Z3'],
      ['27', '25.00', '25.00', '0.00', '29AAACR5055K1Z3']]);
  });

  // ADR-006 §4: an invoice and a return share a delivery line; each takes round(V × q / Q, 2), the last clearing it.
  it('shares a delivery line with a return, the last of them clearing its cost exactly, and bills no more than is out', async () => {
    const at = await setup({ stock: '3', stockRate: '33.333334', ordered: '3', rate: '50', delivered: '3' });
    const out = await inBooks(async (ctx) => {
      const first = await post(ctx, at, '1');
      const { id } = await addDeliveryReturn(ctx, { deliveryId: at.deliveryId, locationId: at.placeId, businessDate: DATE, notes: null,
        lines: [{ deliveryLineId: at.deliveryLineId, qty: q('1'), batches: [{ batchId: at.batchId, qty: q('1') }], serials: [] }] });
      await postDeliveryReturnNow(ctx, { id });
      const over = await failure(bill(ctx, at, '2'));
      const last = await post(ctx, at, '1');
      const lines = [(await getInvoiceById(ctx, { id: first.id })).lines[0]?.cost, (await getInvoiceById(ctx, { id: last.id })).lines[0]?.cost];
      return { over, lines };
    });
    expect(at.sentValue).toBe('100.00');
    expect(out).toEqual({ over: 'over_quantity', lines: ['33.33', '33.34'] });
  });

  // ADR-007 §4 (CA-09): not before a delivery it bills, nor after its earliest by more than the lag (0 by default).
  it('dates an invoice on its delivery’s day, not before nor after', async () => {
    const at = await setup({ stock: '1', stockRate: '100', ordered: '1', rate: '1000', delivered: '1' });
    const out = await inBooks(async (ctx) => [await failure(post(ctx, at, '1', { businessDate: '2026-11-14' })),
      await failure(post(ctx, at, '1', { businessDate: '2026-11-16' }))]);
    expect(out).toEqual(['date_before_source', 'invoice_too_late']);
  });

  // RC-113 (Rule 46, CA-43): a buyer is B2B by the GSTIN on the invoice, never by the party's type. A dealer without a
  // GSTIN is unregistered, named with an address once the invoice reaches 50,000; a customer with a GSTIN needs none.
  it('needs an unregistered buyer’s address at 50,000, whatever its type, and a registered one’s never', async () => {
    const dealer = await setup({ kind: 'dealer', address: false, stock: '1', stockRate: '100', ordered: '1', rate: '50000', delivered: '1' });
    const small = await setup({ kind: 'dealer', address: false, stock: '1', stockRate: '100', ordered: '1', rate: '47000', delivered: '1' });
    const registered = await setup({ gstin: '27AAACR5055K1Z7', address: false, stock: '1', stockRate: '100', ordered: '1', rate: '50000',
      delivered: '1' });
    const out = await inBooks(async (ctx) => [await failure(post(ctx, dealer, '1')), await failure(post(ctx, small, '1')),
      await failure(post(ctx, registered, '1'))]);
    expect(out).toEqual(['buyer_details_required', 'ok', 'ok']);
  });

  // ADR-007 §9 (the architect on RAD-113): credit is checked again at the invoice, and price only on a line not at its
  // order's price, below cost and its discount measured from the party's list on the invoice's date, never from the
  // rate typed: a 10% cut is over the maker's limit (the default, at most 2%). A line at its order's price isn't checked.
  it('checks a repriced line against cost and the party’s list, and leaves one at its order’s price alone', async () => {
    // One left at the store, so its average (100.00) is the cost the changed lines are checked against.
    const at = await setup({ stock: '4', stockRate: '100', ordered: '3', rate: '1000', delivered: '3' });
    // Another list for the party, set through the service, as prices:approve would (the architect on RAD-113).
    const list = await priceListFrom(su, DATE, { [at.itemId]: '1000' });
    await run((ctx) => setPartyList(ctx, { partyId: at.partyId, priceListId: list, reason: 'The dealer list' }));
    const out = await inBooks(async (ctx) => {
      const issues = (rate: string) => post(ctx, at, '1', { rate }).then(() => 'ok', (e: unknown) => (e as AppError).issues.map((i) => i.code).join());
      return [await issues('50'), await issues('900'), await failure(post(ctx, at, '1'))];
    });
    expect(out).toEqual(['below_cost,over_discount', 'over_discount', 'ok']);
  });

  // RAD-116: a posted invoice is a receivable charge, its total what receipts are allocated against.
  it('takes a receipt’s allocation against its total', async () => {
    const at = await setup({ stock: '1', stockRate: '100', ordered: '1', rate: '1000', delivered: '1' });
    const out = await inBooks(async (ctx) => {
      const invoice = await post(ctx, at, '1');
      const bank = (await su.query<{ id: string }>("select id from radcore.accounts where system_key = 'bank'")).rows[0]?.id ?? '';
      const receipt = await recordPayment(ctx, { kind: 'receipt', partyId: at.partyId, businessDate: DATE, amount: m('500'), accountId: bank });
      await allocatePayment(ctx, { id: receipt.id, businessDate: DATE, lines: [{ documentTable: 'invoices', documentId: invoice.id, amount: m('500') }] });
      return [invoice.total, (await paidOf(ctx, 'invoices', [invoice.id])).get(invoice.id)?.paid];
    });
    expect(out).toEqual(['1050.00', '500.00']);
  });

  // F10 (RAD-114, ADR-007 §6): cancelled on a later day, its entry mirrored on that day, so the cost is back in GDNI and
  // the delivery is open to invoice again; never twice, and not while a receipt is applied to it (RC-126).
  it('cancels an invoice with a mirror entry on its day, opening its delivery again', async () => {
    const at = await setup({ stock: '4', stockRate: '61250', ordered: '1', rate: '80000', delivered: '1' });
    const later = '2026-11-16';
    const out = await inBooks(async (ctx) => {
      const posted = await post(ctx, at, '1');
      const early = await failure(cancelInvoiceNow(ctx, { id: posted.id, businessDate: '2026-11-14', reason: 'Billed in error' }));
      await cancelInvoiceNow(ctx, { id: posted.id, businessDate: later, reason: 'Billed in error' });
      const page = await journalPage(ctx, { limit: 100, filter: { from: later, to: later, kind: 'invoice' } });
      const mirror = page.items.find((e) => e.source.id === posted.id);
      const lines = mirror === undefined ? [] : (await journalEntryById(ctx, { id: mirror.id })).lines
        .map((l) => `${l.account.name} ${l.debit} ${l.credit}`);
      const again = await failure(cancelInvoiceNow(ctx, { id: posted.id, businessDate: later, reason: 'Twice' }));
      const open = (await listToInvoicePage(ctx, { limit: 50, filter: { partyId: at.partyId } })).items.map((d) => d.toInvoice);
      return { early, status: (await getInvoiceById(ctx, { id: posted.id })).status, reverses: mirror?.reversesEntryId !== null, lines, again, open };
    });
    expect(out).toEqual({ early: 'date_before_source', status: 'cancelled', reverses: true,
      lines: ['Debtors 0.00 84000.00', 'Sales 80000.00 0.00', 'Output CGST 2000.00 0.00', 'Output SGST 2000.00 0.00',
        'Cost of Goods Sold 0.00 61250.00', 'Goods Delivered Not Invoiced 61250.00 0.00'],
      again: 'wrong_status', open: ['84000.00'] });
  });

  it('refuses to cancel an invoice while a receipt is applied to it, and never touches the receipt', async () => {
    const at = await setup({ stock: '1', stockRate: '100', ordered: '1', rate: '1000', delivered: '1' });
    const out = await inBooks(async (ctx) => {
      const invoice = await post(ctx, at, '1');
      const bank = (await su.query<{ id: string }>("select id from radcore.accounts where system_key = 'bank'")).rows[0]?.id ?? '';
      const receipt = await recordPayment(ctx, { kind: 'receipt', partyId: at.partyId, businessDate: DATE, amount: m('500'), accountId: bank });
      await allocatePayment(ctx, { id: receipt.id, businessDate: DATE, lines: [{ documentTable: 'invoices', documentId: invoice.id, amount: m('500') }] });
      return [await failure(cancelInvoiceNow(ctx, { id: invoice.id, businessDate: DATE, reason: 'Billed in error' })), receipt.status];
    });
    expect(out).toEqual(['still_applied', 'posted']);
  });

  // ADR-007 §7 (the architect on RAD-113): an invoice is owned by the owner its deliveries share, else by its maker.
  // An invoicer holding sales:read over their own bills a salesperson's delivery: the invoice is the salesperson's, so
  // the invoicer can't open it; a mixed invoice stays the invoicer's.
  it('is owned by its deliveries’ shared owner, else by its maker', async () => {
    const seller: Principal = { kind: 'user', userId: randomUUID(), permissions: KEYS };
    const counter: Principal = { kind: 'user', userId: randomUUID(), permissions: KEYS, ownScope: ['sales:read'] };
    const at = await setup({ stock: '3', stockRate: '100', ordered: '2', rate: '1000', delivered: '2', maker: seller });
    const theirs = await alsoFor(at, '1', staff);
    const out = await inBooks(async (ctx) => {
      const sellers = await post(ctx, at, '1');
      const { id: mixed } = await addInvoice(ctx, { partyId: at.partyId, businessDate: DATE, notes: null, shipTo: null,
        lines: [{ deliveryLineId: at.deliveryLineId, qty: q('1') }, { deliveryLineId: theirs, qty: q('1') }] });
      return [await failure(getInvoiceById(ctx, { id: sellers.id })), await failure(getInvoiceById(ctx, { id: mixed }))];
    }, counter);
    expect(out).toEqual(['not_found', 'ok']);
  });

  // ADR-005 §2, §7b, as the superuser: a posted invoice's lines never change (RA004), and its header, consistent in
  // itself, must match its lines at commit (RA006).
  it('refuses a change to a posted invoice’s lines, and a header that doesn’t match its lines at commit', async () => {
    const at = await setup({ stock: '1', stockRate: '100', ordered: '1', rate: '1000', delivered: '1' });
    const c = await su.connect();
    // A draft and its one line (1,000.00 at 5%, 1,050.00), posted with the header's figures given, then `more`.
    const attempt = async (header: { cgst: string; total: string }, more = '') => {
      await c.query('begin');
      try {
        await c.query("set local app.principal = 'system:test'");
        const { rows: [inv] } = await c.query<{ id: string }>(`insert into radcore.invoices (party_id, owner, business_date)
          values ($1, 'system:test', '${DATE}') returning id`, [at.partyId]);
        await c.query(`insert into radcore.invoice_lines (invoice_id, line_no, delivery_line_id, item_id, qty, rate, hsn, gst_rate,
          gst_rate_source, taxable, cgst, sgst, igst, cess_ad_valorem, cess_per_unit_amount, line_total, cost, delivery_taxable, delivery_gst)
          values ($1, 1, $2, $3, 1, 1000, '8716', 5, 'Test', 1000, 25, 25, 0, 0, 0, 1050, 100, 1000, 50)`, [inv?.id, at.deliveryLineId, at.itemId]);
        await c.query(`update radcore.invoices set status = 'posted', number = $2, issuer_gstin = '27AAPFU0939F1ZV', place_of_supply = '27',
          taxable = 1000, cgst = $3, sgst = $3, total = $4 where id = $1`, [inv?.id, `T/${tag()}`, header.cgst, header.total]);
        if (more !== '') await c.query(more, [inv?.id]);
        await c.query('set constraints all immediate');
        return 'ok';
      } catch (e) {
        return `${(e as { code?: string }).code}:${(e as { constraint?: string }).constraint ?? ''}`;
      } finally {
        await c.query('rollback');
      }
    };
    try {
      expect(await attempt({ cgst: '25', total: '1050' })).toBe('ok');
      expect(await attempt({ cgst: '30', total: '1060' })).toBe('RA006:invoice_lines_total');
      expect(await attempt({ cgst: '25', total: '1050' }, 'update radcore.invoice_lines set qty = 2 where invoice_id = $1')).toMatch(/^RA004:/);
    } finally {
      c.release();
    }
  });
});
