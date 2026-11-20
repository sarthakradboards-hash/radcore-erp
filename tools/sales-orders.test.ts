// RAD-112 (M3-08; ADR-007 §1, §3, §4; RC-111, RC-125) on a real PostgreSQL, as the runtime login: quotes and orders.
// A quote is sent with its number and accepted into a draft order; an order is confirmed with its number and closed,
// short with a reason, or cancelled with one. Dates aren't after today nor before their source; a party must be one we
// sell to, and an item's quantity must fit its unit. A role holding the keys only over its own documents lists only
// those. Each test makes its own party and item, so the shuffled order doesn't matter.
import { randomBytes, randomUUID } from 'node:crypto';
import { addParty, openFinancialYear, setCreditTerms } from '@radcore/lib-accounts';
import { moneyString, percentString, quantityString, unitPriceString } from '@radcore/lib-common';
import { AppError, decideApproval, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import {
  acceptQuoteNow, addOrder, addQuote, askOrderOverride, orderOverride, cancelOrderNow, changeOrder, changeQuote, closeOrderNow, confirmOrderNow, getOrderById, getQuoteById,
  listOrdersPage, sendQuoteNow,
} from '@radcore/lib-sales';
import { putGstRate } from '@radcore/lib-gst';
import { addCategory, addItem } from '@radcore/lib-stock';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

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
  async function setup(kinds: string[] = ['customer']) {
    return run(async (ctx) => {
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
  }

  it('sends a quote with its number, then accepts it into a draft order with its lines', async () => {
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
    const at = await setup();
    const cheap = { ...line(at.itemId), rate: unitPriceString().parse('40000') };
    const { id } = await run((ctx) => addOrder(ctx, { partyId: at.partyId, businessDate: DATE, notes: null, lines: [cheap] }));
    const refused = await run((ctx) => confirmOrderNow(ctx, { id })).then(() => null, (e: unknown) => e as AppError);
    expect([refused?.code, refused?.issues.map((i) => [i.code, i.path.join('.')])]).toEqual(['needs_override', [['below_cost', 'lines.0']]]);
  });

  // The architect on RAD-112: an order's discounts are judged by its maker's limit, whoever reads it, so what the
  // approver approves is what the maker's confirmation finds. A maker on 5% gives 8%; an approver on 10% approves it.
  it("judges an order's discount by its maker's limit, so an approver with a higher one approves what the maker confirms", async () => {
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
});
