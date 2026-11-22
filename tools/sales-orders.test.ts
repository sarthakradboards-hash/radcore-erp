// RAD-112 (M3-08; ADR-007 §1, §3, §4; RC-111, RC-125) on a real PostgreSQL, as the runtime login: quotes and orders.
// A quote is sent with its number and accepted into a draft order; an order is confirmed with its number and closed,
// short with a reason, or cancelled with one. Dates aren't after today nor before their source; a party must be one we
// sell to, and an item's quantity must fit its unit. A role holding the keys only over its own documents lists only
// those. Each test makes its own party and item, so the shuffled order doesn't matter.
import { randomBytes, randomUUID } from 'node:crypto';
import { addParty, openFinancialYear, setCreditTerms } from '@radcore/lib-accounts';
import { moneyString, percentString, quantityString, unitPriceString } from '@radcore/lib-common';
import { AppError, decideApproval, Settings, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import {
  acceptQuoteNow, addOrder, addQuote, askOrderOverride, orderOverride, cancelOrderNow, changeOrder, changeQuote, closeOrderNow, confirmOrderNow, getOrderById, getQuoteById,
  listOrdersPage, orderCounts, quoteCounts, salePrice, sendQuoteNow,
} from '@radcore/lib-sales';
import { putGstRate } from '@radcore/lib-gst';
import { addCategory, addItem } from '@radcore/lib-stock';
import pg from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { priceListFrom } from './price-list-fixture.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
// A fixed past day, so no test reads the run date (RC-156); the services bound dates by the real one.
const DATE = '2026-11-15';
const KEYS = ['sales:read', 'sales:write', 'parties:write', 'parties:manage', 'items:write', 'cost:read', 'gst:write'];
const person = (ownScope: string[] = []): Principal => ({ kind: 'user', userId: randomUUID(), permissions: KEYS, ownScope });
const tag = () => randomBytes(3).toString('hex').toUpperCase();
const line = (itemId: string, qty = '2') => ({ itemId, qty: quantityString().parse(qty), rate: unitPriceString().parse('61250'),
  discountPercent: percentString({ max: '100' }).parse('0') });

describe.skipIf(!url || !superUrl)('quotes and orders', () => {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  const su = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
    await su.end();
  });
  const staff = person();
  const run = <T>(fn: (ctx: Ctx) => Promise<T>, as: Principal = staff) => runInTransaction(db, WRITE, as, randomUUID(), fn);
  const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof AppError ? e.code : String(e)));

  // A party we sell to (or, with `kinds`, another), and an item counted whole.
  // With a price list on the party pricing the item at `listRate` (the lines' 61,250.00 by default; null leaves it off
  // the list): a priced line with no list rate needs approval (the architect's #256).
  async function setup(kinds: string[] = ['customer'], list: { listRate?: string | null; taxInclusive?: boolean } = {}) {
    const at = await run(async (ctx) => {
      await openFinancialYear(ctx, DATE);
      const { id: partyId } = await addParty(ctx, { name: `Party ${tag()}`, kinds: kinds as never, gstin: null, pan: null, composition: false,
        stateCode: '27', phone: null, email: null, addressLine1: null, addressLine2: null, city: null, pincode: null });
      // Credit enough for any order here: a party with no limit set has no credit (Sarthak on RAD-111).
      await setCreditTerms(ctx, { id: partyId, creditDays: 30, creditLimit: moneyString().parse('10000000'), reason: 'Test terms' });
      const { id: categoryId } = await addCategory(ctx, { name: `Test ${tag()}` });
      // An HSN of its own, rated from the test's day, so no other file's rate is the one in force for it (RC-115).
      const hsn = `8711${String(randomBytes(2).readUInt16BE() % 10000).padStart(4, '0')}`;
      await putGstRate(ctx, { hsn, effectiveFrom: DATE, rate: percentString().parse('5'), source: 'Test', note: null, reason: 'Test' });
      // Priced below the lines' 61,250.00, so the price check passes: only credit stops an order here.
      const { id: itemId } = await addItem(ctx, { sku: `Q-${tag()}`, name: 'Electric scooter', categoryId, hsn, unit: 'NOS',
        barcode: null, serialised: false, hasChassis: false, purchasePrice: unitPriceString().parse('50000') });
      return { partyId, itemId };
    });
    const listRate = list.listRate === undefined ? '61250' : list.listRate;
    await priceListFrom(su, DATE, listRate === null ? {} : { [at.itemId]: listRate },
      { partyId: at.partyId, ...(list.taxInclusive === undefined ? {} : { taxInclusive: list.taxInclusive }) });
    return at;
  }

  it('sends a quote with its number, then accepts it into a draft order priced from the party’s list', async () => {
    const at = await setup();
    const { id } = await run((ctx) => addQuote(ctx, { partyId: at.partyId, businessDate: DATE, validUntil: null, notes: 'Two scooters',
      lines: [line(at.itemId)] }));
    const { number } = await run((ctx) => sendQuoteNow(ctx, { id }));
    expect(number).toMatch(/^QT\/\d{2}-\d{2}\/\d{5}$/);
    // A sent quote is no longer edited.
    expect(await code(run((ctx) => changeQuote(ctx, { id, partyId: at.partyId, businessDate: DATE, validUntil: null, notes: null,
      lines: [line(at.itemId, '1')] })))).toBe('wrong_status');
    const { orderId } = await run((ctx) => acceptQuoteNow(ctx, { id, businessDate: DATE }));
    const quote = await run((ctx) => getQuoteById(ctx, { id }));
    const order = await run((ctx) => getOrderById(ctx, { id: orderId }));
    expect([quote.status, order.status, order.number, order.quoteId, order.notes]).toEqual(['accepted', 'draft', null, id, 'Two scooters']);
    expect(order.lines.map((l) => [l.lineNo, l.itemId, l.qty, l.rate])).toEqual([[1, at.itemId, '2.000', '61250.000000']]);
    expect(await code(run((ctx) => acceptQuoteNow(ctx, { id, businessDate: DATE })))).toBe('wrong_status');
    // Priced from the party's list like any order (auditor-2 on #254): it confirms with no override needed.
    expect((await run((ctx) => confirmOrderNow(ctx, { id: orderId }))).number).toMatch(/^SO\//);
  });

  it('counts quotes and orders by status in the list’s scope, lists a quote’s orders, and names each line’s item (RAD-125)', async () => {
    const at = await setup();
    const mine = person(['sales:read', 'sales:write']);
    const make = (as: Principal = staff) => run((ctx) => addQuote(ctx, { partyId: at.partyId, businessDate: DATE, validUntil: null,
      notes: null, lines: [line(at.itemId)] }), as);
    const { id: sent } = await make();
    await run((ctx) => sendQuoteNow(ctx, { id: sent }));
    const { id: other } = await make();
    const { id: theirs } = await make(mine);
    const { orderId } = await run((ctx) => acceptQuoteNow(ctx, { id: sent, businessDate: DATE }));
    // Every status is answered, 0 where none; someone who works only their own counts only their own.
    expect((await run((ctx) => quoteCounts(ctx, { partyId: at.partyId }))).byStatus)
      .toEqual({ draft: 2, sent: 0, accepted: 1, declined: 0, expired: 0 });
    expect((await run((ctx) => quoteCounts(ctx, { partyId: at.partyId }), mine)).byStatus)
      .toEqual({ draft: 1, sent: 0, accepted: 0, declined: 0, expired: 0 });
    expect((await run((ctx) => orderCounts(ctx, { partyId: at.partyId }))).byStatus).toEqual({ draft: 1, confirmed: 0, closed: 0, cancelled: 0 });
    expect((await run((ctx) => orderCounts(ctx, { partyId: at.partyId }), mine)).byStatus).toEqual({ draft: 0, confirmed: 0, closed: 0, cancelled: 0 });
    // The orders a quote became, and none for one that became none.
    const ordersOf = async (quoteId: string) => (await run((ctx) => listOrdersPage(ctx, { filter: { quoteId }, limit: 50 }))).items.map((o) => o.id);
    expect([await ordersOf(sent), await ordersOf(other)]).toEqual([[orderId], []]);
    // And the quote names the order it became, but not to someone who may not open that order.
    expect([(await run((ctx) => getQuoteById(ctx, { id: sent }))).orderId, (await run((ctx) => getQuoteById(ctx, { id: other }))).orderId])
      .toEqual([orderId, null]);
    // Their own quote, which staff sent and accepted into an order of staff's: they see the quote, not the order.
    await run((ctx) => sendQuoteNow(ctx, { id: theirs }));
    const { orderId: staffs } = await run((ctx) => acceptQuoteNow(ctx, { id: theirs, businessDate: DATE }));
    expect([(await run((ctx) => getQuoteById(ctx, { id: theirs }), mine)).orderId, (await run((ctx) => getQuoteById(ctx, { id: theirs }))).orderId])
      .toEqual([null, staffs]);
    // Each line names its item, so a screen needn't look items up line by line.
    const named = (lines: readonly { sku: string; name: string }[]) => lines.map((l) => [l.sku.startsWith('Q-'), l.name]);
    expect(named((await run((ctx) => getQuoteById(ctx, { id: sent }))).lines)).toEqual([[true, 'Electric scooter']]);
    expect(named((await run((ctx) => getOrderById(ctx, { id: orderId }))).lines)).toEqual([[true, 'Electric scooter']]);
  });

  // A person, made now in a transaction of its own, as the approval engine reads their account's age (RAD-38).
  const newUser = async (permissions: string[], role = 'sales'): Promise<Principal> => {
    const { rows } = await pool.query<{ id: string }>(`with p as (select set_config('app.principal', 'system:test', true))
      insert into radcore.users (email, display_name, role) select $1, 'Test person', $2 from p returning id`,
    [`sales-${randomUUID()}@example.test`, role]);
    return { kind: 'user', userId: rows[0]?.id ?? '', permissions, role };
  };
  // A role of the test's own with a discount limit, so no built-in role another file reads is changed.
  const roleWithLimit = async (percent: string): Promise<string> => {
    // A role key is letters and underscores (ck_roles_key).
    const key = `t_${[...randomBytes(10)].map((b) => String.fromCharCode(97 + (b % 26))).join('')}`;
    const c = await su.connect();
    try {
      await c.query('begin');
      await c.query("select set_config('app.principal', 'system:test', true)");
      await c.query("insert into radcore.roles (key, name, description, second_factor_required) values ($1, $1, 'Test', false)", [key]);
      await c.query('insert into radcore.discount_limits (role, max_percent) values ($1, $2)', [key, percent]);
      await c.query('commit');
    } finally {
      c.release();
    }
    return key;
  };

  // M3-07 at confirmation (RC-061): a party with no credit stops the order until
  // someone else approves an override of exactly those issues; a changed line makes the approval stale.
  it('confirms an order over its checks only once someone else approved the override', async () => {
    const at = await setup();
    await run((ctx) => setCreditTerms(ctx, { id: at.partyId, creditDays: null, creditLimit: moneyString().parse('0'), reason: 'No credit' }));
    const maker = await newUser(KEYS);
    const approver = await newUser(['sales:override']);
    const { id } = await run((ctx) => addOrder(ctx, { partyId: at.partyId, businessDate: DATE, notes: null, lines: [line(at.itemId)] }), maker);
    const refused = await run((ctx) => confirmOrderNow(ctx, { id }), maker).then(() => null, (e: unknown) => e as AppError);
    expect([refused?.code, refused?.issues.map((i) => i.code)]).toEqual(['needs_override', ['over_limit']]);
    const request = await run((ctx) => askOrderOverride(ctx, { id }), maker);
    expect(await code(run((ctx) => decideApproval(ctx, orderOverride, request.id, { decision: 'approve', versionHash: request.versionHash }), maker)))
      .toBe('own_request');
    await run((ctx) => decideApproval(ctx, orderOverride, request.id, { decision: 'approve', versionHash: request.versionHash }), approver);
    expect((await run((ctx) => confirmOrderNow(ctx, { id }), maker)).number).toMatch(/^SO\//);
  });

  // RC-131: below the item's cost (its purchase price, with nothing on hand) stops a line, whatever the party's credit.
  it('stops a confirmation with a line priced below the item’s cost', async () => {
    // Listed at the line's own rate, so cost is the only thing it fails.
    const at = await setup(['customer'], { listRate: '40000' });
    const cheap = { ...line(at.itemId), rate: unitPriceString().parse('40000') };
    const { id } = await run((ctx) => addOrder(ctx, { partyId: at.partyId, businessDate: DATE, notes: null, lines: [cheap] }));
    const refused = await run((ctx) => confirmOrderNow(ctx, { id })).then(() => null, (e: unknown) => e as AppError);
    expect([refused?.code, refused?.issues.map((i) => [i.code, i.path.join('.')])]).toEqual(['needs_override', [['below_cost', 'lines.0']]]);
  });

  // The architect on RAD-112: an order's discounts are judged by its maker's limit, whoever reads it, so what the
  // approver approves is what the maker's confirmation finds. A maker on 5% gives 8%; an approver on 10% approves it.
  it("judges an order's discount by its maker's limit, so an approver with a higher one approves what the maker confirms", async () => {
    // The party's list prices the item at the line's rate, so the 8% is all the discount there is (the architect on RAD-113).
    const at = await setup();
    const maker = await newUser(KEYS, await roleWithLimit('5'));
    const approver = await newUser(['sales:override'], await roleWithLimit('10'));
    const eight = { ...line(at.itemId), discountPercent: percentString({ max: '100' }).parse('8') };
    const { id } = await run((ctx) => addOrder(ctx, { partyId: at.partyId, businessDate: DATE, notes: null, lines: [eight] }), maker);
    const refused = await run((ctx) => confirmOrderNow(ctx, { id }), maker).then(() => null, (e: unknown) => e as AppError);
    expect(refused?.issues.map((i) => i.code)).toEqual(['over_discount']);
    const request = await run((ctx) => askOrderOverride(ctx, { id }), maker);
    await run((ctx) => decideApproval(ctx, orderOverride, request.id, { decision: 'approve', versionHash: request.versionHash }), approver);
    expect((await run((ctx) => confirmOrderNow(ctx, { id }), maker)).number).toMatch(/^SO\//);
  });

  // Refs RAD-112 (the architect on RAD-113 and #256): a line's discount is measured from its party's list, never from a
  // rate typed on it, so a typed rate below the list with 0% discount is over a 0% limit; an item the list doesn't price
  // needs approval (no_list_rate); a tax-inclusive list is compared before its GST (64,312.50 at 5% is 61,250.00).
  it('measures a typed rate against the party’s list, and needs approval for an item off the list', async () => {
    const listed = await setup(['customer'], { listRate: '65000' });
    const unlisted = await setup(['customer'], { listRate: null });
    const inclusive = await setup(['customer'], { listRate: '64312.50', taxInclusive: true });
    // A party whose own list is switched off has no list rate either, as a switched-off default (auditor on #269).
    const offList = await setup(['customer']);
    await su.query(`with p as (select set_config('app.principal', 'system:test', true))
      update radcore.price_lists set active = false from p
      where id = (select price_list_id from radcore.party_price_lists where party_id = $1)`, [offList.partyId]);
    const maker = await newUser(KEYS, await roleWithLimit('0'));
    const confirm = async (at: { partyId: string; itemId: string }) => {
      const { id } = await run((ctx) => addOrder(ctx, { partyId: at.partyId, businessDate: DATE, notes: null, lines: [line(at.itemId)] }), maker);
      return run((ctx) => confirmOrderNow(ctx, { id }), maker).then(() => 'ok', (e: unknown) => (e as AppError).issues.map((i) => i.code).join());
    };
    expect([await confirm(listed), await confirm(unlisted), await confirm(inclusive), await confirm(offList)])
      .toEqual(['over_discount', 'no_list_rate', 'ok', 'no_list_rate']);
  });

  it('makes an approved override stale when the order changes after it', async () => {
    const at = await setup();
    await run((ctx) => setCreditTerms(ctx, { id: at.partyId, creditDays: null, creditLimit: moneyString().parse('0'), reason: 'No credit' }));
    const maker = await newUser(KEYS);
    const approver = await newUser(['sales:override']);
    const { id } = await run((ctx) => addOrder(ctx, { partyId: at.partyId, businessDate: DATE, notes: null, lines: [line(at.itemId)] }), maker);
    const request = await run((ctx) => askOrderOverride(ctx, { id }), maker);
    await run((ctx) => decideApproval(ctx, orderOverride, request.id, { decision: 'approve', versionHash: request.versionHash }), approver);
    await run((ctx) => changeOrder(ctx, { id, partyId: at.partyId, businessDate: DATE, notes: null, lines: [line(at.itemId, '3')] }), maker);
    expect(await code(run((ctx) => confirmOrderNow(ctx, { id }), maker))).toBe('needs_override');
  });

  it('confirms an order with its number, and closes it short only with a reason (RC-125)', async () => {
    const at = await setup();
    const { id } = await run((ctx) => addOrder(ctx, { partyId: at.partyId, businessDate: DATE, notes: null, lines: [line(at.itemId)] }));
    expect(await code(run((ctx) => closeOrderNow(ctx, { id })))).toBe('wrong_status');
    const { number } = await run((ctx) => confirmOrderNow(ctx, { id }));
    expect(number).toMatch(/^SO\/\d{2}-\d{2}\/\d{5}$/);
    expect(await code(run((ctx) => closeOrderNow(ctx, { id })))).toBe('reason_required');
    expect(await run((ctx) => closeOrderNow(ctx, { id, reason: 'The customer took one elsewhere' }))).toEqual({ short: true });
    const order = await run((ctx) => getOrderById(ctx, { id }));
    expect([order.status, order.closeReason]).toEqual(['closed', 'The customer took one elsewhere']);
  });

  // ADR-006 §1's lock order (auditor-2 on #247): a confirmation holds the period before it locks the order, as a
  // delivery's posting does. While a period-lock move holds the period, the waiting confirmation hasn't locked the order,
  // so another can still take it; once the move is gone, the confirmation goes through.
  it('holds the period before it locks the order it confirms', async () => {
    const at = await setup();
    const { id } = await run((ctx) => addOrder(ctx, { partyId: at.partyId, businessDate: DATE, notes: null, lines: [line(at.itemId)] }));
    // The confirmation on a pool of one connection, whose backend's pid is read first, so the wait below is for it and
    // not for another file's posting queued on the same row.
    const own = new pg.Pool({ connectionString: url, max: 1 });
    const first = await own.connect();
    const confirmPid = (await first.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]?.pid;
    first.release();
    const mover = await su.connect();
    try {
      await mover.query('begin');
      // ADR-006 §1's order, as holdPeriod takes it: the company row, then the period lock (RAD-76).
      await mover.query('select id from radcore.company for share');
      await mover.query('select id from radcore.period_lock where id = 1 for update');
      const confirming = runInTransaction(createDatabase(own), WRITE, staff, randomUUID(), (ctx) => confirmOrderNow(ctx, { id }))
        .then((r) => r.number, (e: unknown) => String(e));
      // Until that backend waits on a lock, for at most 4 s, so a failed run holds the period lock for less than other
      // files' tests wait.
      await vi.waitFor(async () => expect((await mover.query<{ w: string | null }>('select wait_event_type as w from pg_stat_activity where pid = $1',
        [confirmPid])).rows[0]?.w).toBe('Lock'), { timeout: 4_000, interval: 50 });
      const other = await pool.connect();
      try {
        await other.query('begin');
        expect((await other.query('select id from radcore.sales_orders where id = $1 for update nowait', [id])).rowCount).toBe(1);
        await other.query('rollback');
      } finally {
        other.release();
      }
      await mover.query('rollback');
      expect(await confirming).toMatch(/^SO\//);
    } finally {
      // Whatever failed, the move's lock goes before its connection returns to the pool (a second rollback is a no-op).
      await mover.query('rollback');
      mover.release();
      await own.end();
    }
  }, 30_000);

  it('cancels a confirmed order with a reason, never a draft', async () => {
    const at = await setup();
    const { id } = await run((ctx) => addOrder(ctx, { partyId: at.partyId, businessDate: DATE, notes: null, lines: [line(at.itemId)] }));
    expect(await code(run((ctx) => cancelOrderNow(ctx, { id, reason: 'Wrong party' })))).toBe('wrong_status');
    await run((ctx) => confirmOrderNow(ctx, { id }));
    await run((ctx) => cancelOrderNow(ctx, { id, reason: 'The customer changed their mind' }));
    const order = await run((ctx) => getOrderById(ctx, { id }));
    expect([order.status, order.closeReason]).toEqual(['cancelled', 'The customer changed their mind']);
  });

  // ADR-007 §4 (RC-111): not after today, and an order not before its quote.
  it('refuses a date after today, and an order dated before its quote', async () => {
    const at = await setup();
    const [future, dayBefore] = ['2099-01-01', '2026-11-14'];
    expect(await code(run((ctx) => addOrder(ctx, { partyId: at.partyId, businessDate: future, notes: null, lines: [line(at.itemId)] }))))
      .toBe('date_in_future');
    const { id } = await run((ctx) => addQuote(ctx, { partyId: at.partyId, businessDate: DATE, validUntil: null, notes: null,
      lines: [line(at.itemId)] }));
    await run((ctx) => sendQuoteNow(ctx, { id }));
    expect(await code(run((ctx) => acceptQuoteNow(ctx, { id, businessDate: dayBefore })))).toBe('date_before_source');
  });

  it('sells only to a party we sell to, and only in quantities its items’ units allow', async () => {
    const supplier = await setup(['supplier']);
    expect(await code(run((ctx) => addOrder(ctx, { partyId: supplier.partyId, businessDate: DATE, notes: null,
      lines: [line(supplier.itemId)] })))).toBe('not_a_customer');
    expect(await code(run((ctx) => addOrder(ctx, { partyId: randomUUID(), businessDate: DATE, notes: null,
      lines: [line(supplier.itemId)] })))).toBe('unknown_party');
    const at = await setup();
    expect(await code(run((ctx) => addOrder(ctx, { partyId: at.partyId, businessDate: DATE, notes: null,
      lines: [line(at.itemId, '1.5')] })))).toBe('quantity_too_precise');
    expect(await code(run((ctx) => addOrder(ctx, { partyId: at.partyId, businessDate: DATE, notes: null,
      lines: [line(randomUUID())] })))).toBe('unknown_item');
  });

  // E7 (ADR-001 §6a): a role holding the sales keys only over its own documents lists and opens only its own.
  it('lists and opens only their own orders for a role holding the keys at own scope', async () => {
    const at = await setup();
    const mine = person(['sales:read', 'sales:write']);
    const { id: theirs } = await run((ctx) => addOrder(ctx, { partyId: at.partyId, businessDate: DATE, notes: null, lines: [line(at.itemId)] }));
    const { id: own } = await run((ctx) => addOrder(ctx, { partyId: at.partyId, businessDate: DATE, notes: null, lines: [line(at.itemId)] }), mine);
    const listed = await run((ctx) => listOrdersPage(ctx, { filter: { partyId: at.partyId }, limit: 50 }), mine);
    expect(listed.items.map((o) => o.id)).toEqual([own]);
    expect(await code(run((ctx) => getOrderById(ctx, { id: theirs }), mine))).toBe('not_found');
    const all = await run((ctx) => listOrdersPage(ctx, { filter: { partyId: at.partyId }, limit: 50 }));
    expect(all.items.map((o) => o.id).toSorted()).toEqual([own, theirs].toSorted());
  });

  // e2e-2's finding: same-day documents came back in id order, so random, and one just made could sit on page 2. Each
  // list pages by (date, made at, id), newest first; the page key keeps PostgreSQL's microseconds, so none is skipped.
  it('lists the same day’s orders newest first, across pages', async () => {
    const at = await setup();
    const made: string[] = [];
    for (let n = 0; n < 3; n += 1) {
      made.push((await run((ctx) => addOrder(ctx, { partyId: at.partyId, businessDate: DATE, notes: null, lines: [line(at.itemId)] }))).id);
    }
    const first = await run((ctx) => listOrdersPage(ctx, { filter: { partyId: at.partyId }, limit: 2 }));
    const rest = await run((ctx) => listOrdersPage(ctx, { filter: { partyId: at.partyId }, limit: 2, after: first.next ?? '' }));
    expect([...first.items, ...rest.items].map((o) => o.id)).toEqual(made.toReversed());
    expect(rest.next).toBeNull();
  });

  // RAD-124's counter: an item's selling rate for a party on a date, from the list and rates an order would store, or
  // none; with no party named, the default list's. The default is set on the request, so no other file's setting counts.
  it('answers the counter an item’s selling rate for a party, or from the default list, as an order would store it', async () => {
    const at = await setup();
    const offList = (await setup()).itemId;
    const price = (itemId: string, partyId: string | undefined, fallback: string | null = null) => run((ctx) =>
      salePrice({ ...ctx, settings: new Settings([{ key: 'sales.default_price_list', value: fallback }]) }, { itemId, partyId, on: DATE }));
    const listed = await price(at.itemId, at.partyId);
    expect([listed.rate, listed.taxInclusive, listed.priceListId === null, listed.versionId === null]).toEqual(['61250.000000', false, false, false]);
    const none = { versionId: null, rate: null, taxInclusive: null };
    expect(await price(offList, at.partyId)).toEqual({ priceListId: listed.priceListId, ...none });
    expect(await price(at.itemId, undefined)).toEqual({ priceListId: null, ...none });
    expect(await price(at.itemId, undefined, listed.priceListId)).toEqual(listed);
  });
});
