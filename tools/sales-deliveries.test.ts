// RAD-112 (M3-08; ADR-007 §1–§4, §9; ADR-006 §4–§6, F5; RC-111, RC-125, RC-207) on a real PostgreSQL, as the runtime
// login: deliveries and delivery returns. A delivery of part of a confirmed order takes the goods out of the batch the
// person picked at the place's average, through Goods Delivered Not Invoiced, with its number drawn last; the last of
// the order closes it. A return puts goods back at their share of what they went out at, the last return of a line
// clearing it exactly. Credit is checked again at posting, and stops it until someone else approves an override. A
// serialised unit leaves with its `delivered` event and comes back with `delivery_returned`. Each test makes its own
// party, item and place, so the shuffled order doesn't matter.
import { randomBytes, randomUUID } from 'node:crypto';
import { addParty, openFinancialYear, setCreditTerms } from '@radcore/lib-accounts';
import { moneyString, percentString, quantityString, unitPriceString } from '@radcore/lib-common';
import { putGstRate } from '@radcore/lib-gst';
import { AppError, decideApproval, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import {
  addDelivery, addDeliveryReturn, addOrder, askDeliveryOverride, cancelOrderNow, changeOrder, closeOrderNow, confirmOrderNow, deliveryOverride,
  getDeliveryById, getOrderById, listDeliveriesPage, listToInvoicePage, postDeliveryNow, postDeliveryReturnNow,
} from '@radcore/lib-sales';
import { addCategory, addItem, addPlace } from '@radcore/lib-stock';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { postDocument, SOURCE_TABLE } from './stock-posting.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
// A fixed past day, so no test reads the run date (RC-156); the services bound dates by the real one.
const DATE = '2026-11-15';
const KEYS = ['sales:read', 'sales:write', 'deliveries:write', 'parties:write', 'parties:manage', 'items:write', 'locations:write',
  'cost:read', 'gst:write'];
const person = (ownScope: string[] = []): Principal => ({ kind: 'user', userId: randomUUID(), permissions: KEYS, ownScope });
const tag = () => randomBytes(3).toString('hex').toUpperCase();
const q = (s: string) => quantityString().parse(s);

describe.skipIf(!url || !superUrl)('deliveries and delivery returns', () => {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  const su = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
    await su.end();
  });
  const staff = person();
  const run = <T>(fn: (ctx: Ctx) => Promise<T>, as: Principal = staff) => runInTransaction(db, WRITE, as, randomUUID(), fn);
  const failure = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof AppError ? e.code : String(e)));

  /** A customer with credit, an item (serialised or not) rated 5%, a store holding `stock` of it in batch B1 at `rate`,
   * and a confirmed order for `ordered` at 50.00 each, made by `maker`. */
  async function setup(o: { stock: string; rate: string; ordered: string; serials?: string[]; maker?: Principal }) {
    const at = await run(async (ctx) => {
      await openFinancialYear(ctx, DATE);
      const { id: partyId } = await addParty(ctx, { name: `Party ${tag()}`, kinds: ['customer'], gstin: null, pan: null, composition: false,
        stateCode: '27', phone: null, email: null, addressLine1: null, addressLine2: null, city: null, pincode: null });
      await setCreditTerms(ctx, { id: partyId, creditDays: 30, creditLimit: moneyString().parse('10000000'), reason: 'Test' });
      const { id: categoryId } = await addCategory(ctx, { name: `Test ${tag()}` });
      // An HSN of its own, rated from the test's day, so no other file's rate is the one in force for it (RC-115).
      const hsn = `8714${String(randomBytes(2).readUInt16BE() % 10000).padStart(4, '0')}`;
      await putGstRate(ctx, { hsn, effectiveFrom: DATE, rate: percentString().parse('5'), source: 'Test', note: null, reason: 'Test' });
      const { id: itemId } = await addItem(ctx, { sku: `D-${tag()}`, name: 'Battery pack', categoryId, hsn, unit: 'NOS', barcode: null,
        serialised: o.serials !== undefined, hasChassis: false, purchasePrice: unitPriceString().parse('30') });
      const { id: placeId } = await addPlace(ctx, { code: `L${tag()}`, name: `Store ${tag()}`, kind: 'store' });
      await postDocument(ctx, { sourceTable: SOURCE_TABLE, sourceId: randomUUID(), businessDate: DATE, ins: [{ itemId, locationId: placeId,
        qty: q(o.stock), rate: unitPriceString().parse(o.rate), batches: [{ batchNo: 'B1', qty: q(o.stock) }],
        ...(o.serials === undefined ? {} : { units: o.serials.map((serialNo) => ({ serialNo })) }) }] });
      const { id: orderId } = await addOrder(ctx, { partyId, businessDate: DATE, notes: null, lines: [{ itemId, qty: q(o.ordered),
        rate: unitPriceString().parse('50'), discountPercent: percentString({ max: '100' }).parse('0') }] });
      await confirmOrderNow(ctx, { id: orderId });
      const order = await getOrderById(ctx, { id: orderId });
      return { partyId, itemId, placeId, orderId, orderLineId: order.lines[0]?.id ?? '' };
    }, o.maker);
    const { rows: [batch] } = await su.query<{ id: string }>('select id from radcore.batches where item_id = $1', [at.itemId]);
    return { ...at, batchId: batch?.id ?? '' };
  }
  type At = Awaited<ReturnType<typeof setup>>;
  /** Another confirmed order for the same party and item, for `ordered`, made by `maker`. */
  const another = (at: At, ordered: string, maker: Principal = staff): Promise<At> => run(async (ctx) => {
    const { id: orderId } = await addOrder(ctx, { partyId: at.partyId, businessDate: DATE, notes: null, lines: [{ itemId: at.itemId,
      qty: q(ordered), rate: unitPriceString().parse('50'), discountPercent: percentString({ max: '100' }).parse('0') }] });
    await confirmOrderNow(ctx, { id: orderId });
    return { ...at, orderId, orderLineId: (await getOrderById(ctx, { id: orderId })).lines[0]?.id ?? '' };
  }, maker);
  const draft = (at: At, qty: string, serials: string[] = [], as: Principal = staff) => run((ctx) => addDelivery(ctx, { orderId: at.orderId,
    locationId: at.placeId, businessDate: DATE, notes: null,
    lines: [{ orderLineId: at.orderLineId, qty: q(qty), batches: [{ batchId: at.batchId, qty: q(qty) }], serials }] }), as);
  const deliver = async (at: At, qty: string, serials: string[] = []) => {
    const { id } = await draft(at, qty, serials);
    return { id, ...(await run((ctx) => postDeliveryNow(ctx, { id }))) };
  };
  const takeBack = async (at: At, deliveryId: string, qty: string, serials: string[] = []) => {
    const d = await run((ctx) => getDeliveryById(ctx, { id: deliveryId }));
    const { id } = await run((ctx) => addDeliveryReturn(ctx, { deliveryId, locationId: at.placeId, businessDate: DATE, notes: null,
      lines: [{ deliveryLineId: d.lines[0]?.id ?? '', qty: q(qty), batches: [{ batchId: at.batchId, qty: q(qty) }], serials }] }));
    return { id, ...(await run((ctx) => postDeliveryReturnNow(ctx, { id }))) };
  };
  // A document's entry, as lines "account debit credit", read as the superuser from the books themselves.
  const entryOf = async (table: string, id: string) => (await su.query<{ line: string }>(`select a.system_key || ' ' || l.debit || ' ' || l.credit
    as line from radcore.journal_lines l join radcore.journal_entries e on e.id = l.entry_id join radcore.accounts a on a.id = l.account_id
    where e.source_table = $1 and e.source_id = $2 order by l.line_no`, [table, id])).rows.map((r) => r.line);
  const onHand = async (itemId: string, locationId: string) => (await su.query<{ qty: string; value: string }>(`select
    coalesce(sum(case direction when 'in' then qty when 'out' then -qty else 0 end), 0)::numeric(18, 0)::text as qty,
    coalesce(sum(case direction when 'out' then -value else value end), 0)::numeric(18, 2)::text as value
    from radcore.stock_movements where item_id = $1 and location_id = $2`, [itemId, locationId])).rows[0];

  // F5, RC-125: part of the order goes, at the place's average, through GDNI; the rest goes and the order closes.
  it('delivers part of an order at the average through GDNI, then the rest, which closes the order', async () => {
    const at = await setup({ stock: '4', rate: '30', ordered: '3' });
    const first = await deliver(at, '1');
    expect(first.number).toMatch(/^DC\/\d{2}-\d{2}\/\d{5}$/);
    expect(await entryOf('deliveries', first.id)).toEqual(['gdni 30.00 0.00', 'stock 0.00 30.00']);
    const d = await run((ctx) => getDeliveryById(ctx, { id: first.id }));
    expect([d.status, d.lines.map((l) => [l.qty, l.value, l.taxable, l.gst, l.batches])]).toEqual(['posted',
      [['1.000', '30.00', '50.00', '2.50', [{ batchId: at.batchId, qty: '1' }]]]]);
    expect((await run((ctx) => getOrderById(ctx, { id: at.orderId }))).status).toBe('confirmed');
    // Only what's left of the order goes: 2 of 3.
    expect(await failure(draft(at, '3'))).toBe('over_quantity');
    await deliver(at, '2');
    expect([(await run((ctx) => getOrderById(ctx, { id: at.orderId }))).status, await onHand(at.itemId, at.placeId)])
      .toEqual(['closed', { qty: '1', value: '30.00' }]);
    expect(await failure(draft(at, '1'))).toBe('wrong_status');
  });

  // ADR-006 §4, RC-207: a return takes round(V × q / Q, 2); the last of the line clears it exactly, back into its batch.
  it('takes goods back at their share of what they went out at, the last return clearing the line exactly', async () => {
    const at = await setup({ stock: '3', rate: '33.333334', ordered: '3' });
    const sent = await deliver(at, '3');
    expect(await entryOf('deliveries', sent.id)).toEqual(['gdni 100.00 0.00', 'stock 0.00 100.00']);
    const one = await takeBack(at, sent.id, '1');
    expect(one.number).toMatch(/^DR\/\d{2}-\d{2}\/\d{5}$/);
    expect(await entryOf('delivery_returns', one.id)).toEqual(['stock 33.33 0.00', 'gdni 0.00 33.33']);
    // More than is still out, or from a batch it didn't leave in, is refused.
    const d = await run((ctx) => getDeliveryById(ctx, { id: sent.id }));
    const line = (qty: string, batchId = at.batchId) => [{ deliveryLineId: d.lines[0]?.id ?? '', qty: q(qty), batches: [{ batchId, qty: q(qty) }], serials: [] }];
    const retry = (lines: ReturnType<typeof line>) => failure(run((ctx) => addDeliveryReturn(ctx, { deliveryId: sent.id, locationId: at.placeId,
      businessDate: DATE, notes: null, lines })));
    expect([await retry(line('3')), await retry(line('1', randomUUID()))]).toEqual(['over_quantity', 'over_quantity']);
    const rest = await takeBack(at, sent.id, '2');
    expect(await entryOf('delivery_returns', rest.id)).toEqual(['stock 66.67 0.00', 'gdni 0.00 66.67']);
    expect(await onHand(at.itemId, at.placeId)).toEqual({ qty: '3', value: '100.00' });
    // Taken back whole, it has nothing left to invoice.
    const waiting = await run((ctx) => listToInvoicePage(ctx, { limit: 50, filter: { partyId: at.partyId } }));
    expect(waiting.items).toEqual([]);
  });

  // RC-111 (ADR-007 §4): a delivery is dated neither after today nor before its order.
  it('dates a delivery no earlier than its order and no later than today', async () => {
    const at = await setup({ stock: '1', rate: '30', ordered: '1' });
    const dated = (businessDate: string) => failure(run((ctx) => addDelivery(ctx, { orderId: at.orderId, locationId: at.placeId, businessDate,
      notes: null, lines: [{ orderLineId: at.orderLineId, qty: q('1'), batches: [{ batchId: at.batchId, qty: q('1') }], serials: [] }] })));
    expect([await dated('2026-11-14'), await dated('2999-01-01'), await dated(DATE)]).toEqual(['date_before_source', 'date_in_future', 'ok']);
  });

  // ADR-007 §1: once a delivery names an order's lines they're fixed, and an order with goods gone isn't cancelled.
  it('fixes an order’s lines once it has a delivery, and refuses to cancel one with goods gone', async () => {
    const at = await setup({ stock: '2', rate: '30', ordered: '2' });
    await deliver(at, '1');
    const lines = [{ itemId: at.itemId, qty: q('3'), rate: unitPriceString().parse('50'), discountPercent: percentString({ max: '100' }).parse('0') }];
    const order = await run((ctx) => getOrderById(ctx, { id: at.orderId }));
    expect(await failure(run((ctx) => changeOrder(ctx, { id: at.orderId, partyId: at.partyId, businessDate: order.businessDate, notes: null, lines }))))
      .toBe('order_delivered');
    expect(await failure(run((ctx) => cancelOrderNow(ctx, { id: at.orderId, reason: 'Changed mind' })))).toBe('order_delivered');
  });

  // A person, made now in a transaction of its own, as the approval engine reads their account's age (RAD-38).
  const newUser = async (permissions: string[]): Promise<Principal> => {
    const { rows } = await pool.query<{ id: string }>(`with p as (select set_config('app.principal', 'system:test', true))
      insert into radcore.users (email, display_name, role) select $1, 'Test person', 'stores' from p returning id`,
    [`deliveries-${randomUUID()}@example.test`]);
    return { kind: 'user', userId: rows[0]?.id ?? '', permissions, role: 'stores' };
  };

  // M3-07 at 'deliver' (RC-061, ADR-007 §9): credit is checked again as the goods go, counting what was delivered and
  // not invoiced; over it, posting waits for someone else's override.
  it('stops a delivery over the party’s credit until someone else approves an override', async () => {
    const at = await setup({ stock: '2', rate: '30', ordered: '2' });
    await deliver(at, '1');
    // 52.50 is delivered and not invoiced; the next 52.50 takes the party past a limit of 100.00.
    await run((ctx) => setCreditTerms(ctx, { id: at.partyId, creditDays: 30, creditLimit: moneyString().parse('100'), reason: 'Lower' }));
    const maker = await newUser(KEYS);
    const approver = await newUser(['sales:override']);
    const { id } = await draft(at, '1', [], maker);
    const refused = await run((ctx) => postDeliveryNow(ctx, { id }), maker).then(() => null, (e: unknown) => e as AppError);
    expect([refused?.code, refused?.issues.map((i) => i.code)]).toEqual(['needs_override', ['over_limit']]);
    const request = await run((ctx) => askDeliveryOverride(ctx, { id }), maker);
    expect(await failure(run((ctx) => decideApproval(ctx, deliveryOverride, request.id, { decision: 'approve', versionHash: request.versionHash }),
      maker))).toBe('own_request');
    await run((ctx) => decideApproval(ctx, deliveryOverride, request.id, { decision: 'approve', versionHash: request.versionHash }), approver);
    expect((await run((ctx) => postDeliveryNow(ctx, { id }), maker)).number).toMatch(/^DC\//);
  });

  // ADR-006 §5: a serialised unit leaves on its delivery line with `delivered`, and comes back with `delivery_returned`.
  it('sends a serialised unit out on its delivery line and takes it back', async () => {
    const serial = `SN-${tag()}`;
    const at = await setup({ stock: '1', rate: '30', ordered: '1', serials: [serial] });
    expect(await failure(draft(at, '1', []).then(({ id }) => run((ctx) => postDeliveryNow(ctx, { id }))))).toBe('units_mismatch');
    const sent = await deliver(at, '1', [serial]);
    const unit = async () => (await su.query<{ ownership: string; sale: string | null }>(`select ownership, sale_line_id as sale
      from radcore.units where item_id = $1`, [at.itemId])).rows[0];
    const d = await run((ctx) => getDeliveryById(ctx, { id: sent.id }));
    expect(await unit()).toEqual({ ownership: 'customer', sale: d.lines[0]?.id });
    await takeBack(at, sent.id, '1', [serial]);
    expect((await unit())?.ownership).toBe('ours');
  });

  // ADR-007 §1, ADR-001 §6a: a delivery is its order's owner's, whoever made it. A salesperson holding sales:read over
  // their own sees the delivery stores made of their order, and not one of a colleague's order.
  it('shows a salesperson at own scope the deliveries of their own orders, whoever made them, and no others', async () => {
    const mine = person(['sales:read']);
    const at = await setup({ stock: '2', rate: '30', ordered: '1', maker: mine });
    const theirs = await another(at, '1');
    const { id } = await draft(at, '1');
    await draft(theirs, '1');
    const listed = await run((ctx) => listDeliveriesPage(ctx, { limit: 50, filter: { partyId: at.partyId } }), mine);
    expect(listed.items.map((d) => d.id)).toEqual([id]);
    expect((await run((ctx) => getDeliveryById(ctx, { id }), mine)).id).toBe(id);
  });

  // E7's exemption (the architect on RAD-112): the party's credit at delivery counts a colleague's posted delivery to the
  // same party, yet nothing of that delivery reaches the person: not in the refusal, not in their list, not by its id.
  it('counts a colleague’s delivery in an own-scope person’s credit check, without showing it', async () => {
    const mine = person(['sales:read']);
    const at = await setup({ stock: '2', rate: '30', ordered: '1', maker: mine });
    const theirs = await deliver(await another(at, '1'), '1');
    // 52.50 is out on the colleague's delivery; this one's 52.50 takes the party past 100.00 only with it.
    await run((ctx) => setCreditTerms(ctx, { id: at.partyId, creditDays: 30, creditLimit: moneyString().parse('100'), reason: 'Lower' }));
    const { id } = await draft(at, '1', [], mine);
    const refused = await run((ctx) => postDeliveryNow(ctx, { id }), mine).then(() => null, (e: unknown) => e as AppError);
    expect([refused?.code, refused?.issues.map((i) => i.code)]).toEqual(['needs_override', ['over_limit']]);
    expect(JSON.stringify([refused?.message, refused?.issues])).not.toContain(theirs.id);
    expect(JSON.stringify([refused?.message, refused?.issues])).not.toContain(theirs.number);
    const listed = await run((ctx) => listDeliveriesPage(ctx, { limit: 50, filter: { partyId: at.partyId } }), mine);
    expect(listed.items.map((d) => d.id)).toEqual([id]);
    expect(await failure(run((ctx) => getDeliveryById(ctx, { id: theirs.id }), mine))).toBe('not_found');
  });

  // ADR-006 §1's step 3 (auditor-2 on #247): two deliveries to one party, posted at once, take turns at its credit check,
  // so the second sees the first and two that pass alone can't together take the party past its limit.
  it('holds the party while a delivery checks its credit, so two at once can’t both pass on the same balance', async () => {
    const at = await setup({ stock: '2', rate: '30', ordered: '1' });
    const other = await another(at, '1');
    await run((ctx) => setCreditTerms(ctx, { id: at.partyId, creditDays: 30, creditLimit: moneyString().parse('100'), reason: 'Lower' }));
    const [a, b] = [await draft(at, '1'), await draft(other, '1')];
    const both = await Promise.all([a, b].map(({ id }) => failure(run((ctx) => postDeliveryNow(ctx, { id })))));
    expect(both.toSorted()).toEqual(['needs_override', 'ok']);
  });

  // ADR-007 §1: deliveries come from a sellable place only; a demo unit is moved to one first.
  it('refuses a delivery from a place that isn’t sellable', async () => {
    const at = await setup({ stock: '1', rate: '30', ordered: '1' });
    const demo = await run(async (ctx) => (await addPlace(ctx, { code: `L${tag()}`, name: `Demo ${tag()}`, kind: 'demo' })).id);
    expect(await failure(draft({ ...at, placeId: demo }, '1'))).toBe('place_not_sellable');
  });

  // ADR-007 §1 (the architect on RAD-112): a return reopens an order its deliveries closed, and not one closed short.
  it('reopens an order its deliveries closed when goods come back, but not one a person closed short', async () => {
    const at = await setup({ stock: '3', rate: '30', ordered: '1' });
    const sent = await deliver(at, '1');
    expect((await run((ctx) => getOrderById(ctx, { id: at.orderId }))).status).toBe('closed');
    await takeBack(at, sent.id, '1');
    expect((await run((ctx) => getOrderById(ctx, { id: at.orderId }))).status).toBe('confirmed');
    const short = await another(at, '2');
    const part = await deliver(short, '1');
    await run((ctx) => closeOrderNow(ctx, { id: short.orderId, reason: 'The customer took one' }));
    await takeBack(short, part.id, '1');
    expect((await run((ctx) => getOrderById(ctx, { id: short.orderId }))).status).toBe('closed');
  });
});
