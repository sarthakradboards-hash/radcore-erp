// RAD-112 (M3-08; ADR-007 §1, §3, §4; RC-111, RC-125) on a real PostgreSQL, as the runtime login: quotes and orders.
// A quote is sent with its number and accepted into a draft order; an order is confirmed with its number and closed,
// short with a reason, or cancelled with one. Dates aren't after today nor before their source; a party must be one we
// sell to, and an item's quantity must fit its unit. A role holding the keys only over its own documents lists only
// those. Each test makes its own party and item, so the shuffled order doesn't matter.
import { randomBytes, randomUUID } from 'node:crypto';
import { addParty } from '@radcore/lib-accounts';
import { indiaDate, percentString, quantityString, unitPriceString } from '@radcore/lib-common';
import { AppError, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import {
  acceptQuoteNow, addOrder, addQuote, cancelOrderNow, changeQuote, closeOrderNow, confirmOrderNow, getOrderById, getQuoteById,
  listOrdersPage, sendQuoteNow,
} from '@radcore/lib-sales';
import { addCategory, addItem } from '@radcore/lib-stock';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

const url = process.env['TEST_DATABASE_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
const TODAY = indiaDate(new Date());
const KEYS = ['sales:read', 'sales:write', 'parties:write', 'items:write'];
const person = (ownScope: string[] = []): Principal => ({ kind: 'user', userId: randomUUID(), permissions: KEYS, ownScope });
const tag = () => randomBytes(3).toString('hex').toUpperCase();
const line = (itemId: string, qty = '2') => ({ itemId, qty: quantityString().parse(qty), rate: unitPriceString().parse('61250'),
  discountPercent: percentString({ max: '100' }).parse('0') });

describe.skipIf(!url)('quotes and orders', () => {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  const db = createDatabase(pool);
  afterAll(async () => { await pool.end(); });
  const staff = person();
  const run = <T>(fn: (ctx: Ctx) => Promise<T>, as: Principal = staff) => runInTransaction(db, WRITE, as, randomUUID(), fn);
  const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof AppError ? e.code : String(e)));

  // A party we sell to (or, with `kinds`, another), and an item counted whole.
  async function setup(kinds: string[] = ['customer']) {
    return run(async (ctx) => {
      const { id: partyId } = await addParty(ctx, { name: `Party ${tag()}`, kinds: kinds as never, gstin: null, pan: null, composition: false,
        stateCode: '27', phone: null, email: null, addressLine1: null, addressLine2: null, city: null, pincode: null });
      const { id: categoryId } = await addCategory(ctx, { name: `Test ${tag()}` });
      const { id: itemId } = await addItem(ctx, { sku: `Q-${tag()}`, name: 'Electric scooter', categoryId, hsn: '8711', unit: 'NOS',
        barcode: null, serialised: false, hasChassis: false });
      return { partyId, itemId };
    });
  }

  it('sends a quote with its number, then accepts it into a draft order with its lines', async () => {
    const at = await setup();
    const { id } = await run((ctx) => addQuote(ctx, { partyId: at.partyId, businessDate: TODAY, validUntil: null, notes: 'Two scooters',
      lines: [line(at.itemId)] }));
    const { number } = await run((ctx) => sendQuoteNow(ctx, { id }));
    expect(number).toMatch(/^QT\/\d{2}-\d{2}\/\d{5}$/);
    // A sent quote is no longer edited.
    expect(await code(run((ctx) => changeQuote(ctx, { id, partyId: at.partyId, businessDate: TODAY, validUntil: null, notes: null,
      lines: [line(at.itemId, '1')] })))).toBe('wrong_status');
    const { orderId } = await run((ctx) => acceptQuoteNow(ctx, { id, businessDate: TODAY }));
    const quote = await run((ctx) => getQuoteById(ctx, { id }));
    const order = await run((ctx) => getOrderById(ctx, { id: orderId }));
    expect([quote.status, order.status, order.number, order.quoteId, order.notes]).toEqual(['accepted', 'draft', null, id, 'Two scooters']);
    expect(order.lines.map((l) => [l.lineNo, l.itemId, l.qty, l.rate])).toEqual([[1, at.itemId, '2', '61250.000000']]);
    expect(await code(run((ctx) => acceptQuoteNow(ctx, { id, businessDate: TODAY })))).toBe('wrong_status');
  });

  it('confirms an order with its number, and closes it short only with a reason (RC-125)', async () => {
    const at = await setup();
    const { id } = await run((ctx) => addOrder(ctx, { partyId: at.partyId, businessDate: TODAY, notes: null, lines: [line(at.itemId)] }));
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
    const { id } = await run((ctx) => addOrder(ctx, { partyId: at.partyId, businessDate: TODAY, notes: null, lines: [line(at.itemId)] }));
    expect(await code(run((ctx) => cancelOrderNow(ctx, { id, reason: 'Wrong party' })))).toBe('wrong_status');
    await run((ctx) => confirmOrderNow(ctx, { id }));
    await run((ctx) => cancelOrderNow(ctx, { id, reason: 'The customer changed their mind' }));
    const order = await run((ctx) => getOrderById(ctx, { id }));
    expect([order.status, order.closeReason]).toEqual(['cancelled', 'The customer changed their mind']);
  });

  // ADR-007 §4 (RC-111): not after today, and an order not before its quote.
  it('refuses a date after today, and an order dated before its quote', async () => {
    const at = await setup();
    const tomorrow = new Date(Date.parse(`${TODAY}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const yesterday = new Date(Date.parse(`${TODAY}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    expect(await code(run((ctx) => addOrder(ctx, { partyId: at.partyId, businessDate: tomorrow, notes: null, lines: [line(at.itemId)] }))))
      .toBe('date_in_future');
    const { id } = await run((ctx) => addQuote(ctx, { partyId: at.partyId, businessDate: TODAY, validUntil: null, notes: null,
      lines: [line(at.itemId)] }));
    await run((ctx) => sendQuoteNow(ctx, { id }));
    expect(await code(run((ctx) => acceptQuoteNow(ctx, { id, businessDate: yesterday })))).toBe('date_before_source');
  });

  it('sells only to a party we sell to, and only in quantities its items’ units allow', async () => {
    const supplier = await setup(['supplier']);
    expect(await code(run((ctx) => addOrder(ctx, { partyId: supplier.partyId, businessDate: TODAY, notes: null,
      lines: [line(supplier.itemId)] })))).toBe('not_a_customer');
    expect(await code(run((ctx) => addOrder(ctx, { partyId: randomUUID(), businessDate: TODAY, notes: null,
      lines: [line(supplier.itemId)] })))).toBe('unknown_party');
    const at = await setup();
    expect(await code(run((ctx) => addOrder(ctx, { partyId: at.partyId, businessDate: TODAY, notes: null,
      lines: [line(at.itemId, '1.5')] })))).toBe('quantity_too_precise');
    expect(await code(run((ctx) => addOrder(ctx, { partyId: at.partyId, businessDate: TODAY, notes: null,
      lines: [line(randomUUID())] })))).toBe('unknown_item');
  });

  // E7 (ADR-001 §6a): a role holding the sales keys only over its own documents lists and opens only its own.
  it('lists and opens only their own orders for a role holding the keys at own scope', async () => {
    const at = await setup();
    const mine = person(['sales:read', 'sales:write']);
    const { id: theirs } = await run((ctx) => addOrder(ctx, { partyId: at.partyId, businessDate: TODAY, notes: null, lines: [line(at.itemId)] }));
    const { id: own } = await run((ctx) => addOrder(ctx, { partyId: at.partyId, businessDate: TODAY, notes: null, lines: [line(at.itemId)] }), mine);
    const listed = await run((ctx) => listOrdersPage(ctx, { filter: { partyId: at.partyId }, limit: 50 }), mine);
    expect(listed.items.map((o) => o.id)).toEqual([own]);
    expect(await code(run((ctx) => getOrderById(ctx, { id: theirs }), mine))).toBe('not_found');
    const all = await run((ctx) => listOrdersPage(ctx, { filter: { partyId: at.partyId }, limit: 50 }));
    expect(all.items.map((o) => o.id).toSorted()).toEqual([own, theirs].toSorted());
  });
});
