// RAD-135 (M3-29; the architect's ruling): an approval to go over a party's credit limit holds only for what the party
// would owe as it was judged. Each override's approval records that figure on its document (override_after, out of the
// hash); confirming the order, or posting the delivery or invoice, asks again (version_changed) once the party owes more,
// or when no figure was recorded. The same or a smaller figure goes through, and a raised limit moves nothing. Each test
// makes its own party, item and place, so the shuffled order doesn't matter.
import { randomBytes, randomUUID } from 'node:crypto';
import { addParty, openFinancialYear, recordPayment, setCreditTerms, systemAccountId } from '@radcore/lib-accounts';
import { moneyString, percentString, quantityString, unitPriceString } from '@radcore/lib-common';
import { putGstRate } from '@radcore/lib-gst';
import { AppError, decideApproval, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import {
  addDelivery, addInvoice, addOrder, askDeliveryOverride, askInvoiceOverride, askOrderOverride, confirmOrderNow, deliveryOverride,
  getDeliveryById, getOrderById, invoiceOverride, orderOverride, postDeliveryNow, postInvoiceNow,
} from '@radcore/lib-sales';
import { addCategory, addItem, addPlace } from '@radcore/lib-stock';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { priceListFrom } from './price-list-fixture.ts';
import { postDocument, SOURCE_TABLE } from './stock-posting.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
// A fixed past day, so no test reads the run date (RC-156).
const DATE = '2026-11-15';
const KEYS = ['sales:read', 'sales:write', 'deliveries:write', 'invoices:write', 'parties:write', 'parties:manage', 'items:write',
  'locations:write', 'cost:read', 'gst:write', 'payments:write'];
const staff: Principal = { kind: 'user', userId: randomUUID(), permissions: KEYS };
const tag = () => randomBytes(3).toString('hex').toUpperCase();
const q = (s: string) => quantityString().parse(s);
const m = (s: string) => moneyString().parse(s);
// Two at 50.00 and 5% are 105.00: over a limit of 100.00.
const LOW = '100';
const HIGH = '10000000';

describe.skipIf(!url || !superUrl)('a credit override holds for its figure', () => {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  const su = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
    await su.end();
  });
  const run = <T>(fn: (ctx: Ctx) => Promise<T>, as: Principal = staff) => runInTransaction(db, WRITE, as, randomUUID(), fn);
  const failure = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof AppError ? e.code : String(e)));
  // A person, made now in a transaction of its own, as the approval engine reads their account's age (RAD-38).
  const newUser = async (permissions: string[]): Promise<Principal> => {
    const { rows } = await pool.query<{ id: string }>(`with p as (select set_config('app.principal', 'system:test', true))
      insert into radcore.users (email, display_name, role) select $1, 'Test person', 'accounts' from p returning id`,
    [`override-after-${randomUUID()}@example.test`]);
    return { kind: 'user', userId: rows[0]?.id ?? '', permissions, role: 'accounts' };
  };

  /** A customer with a limit of `limit`, an item rated 5% and priced 50.00 on its list, a store with 300 in batch B1, and
   * the maker and approver, made first so the approver is never newer than a request. */
  async function setup(limit: string) {
    const maker = await newUser(KEYS);
    const approver = await newUser(['sales:override']);
    const made = await run(async (ctx) => {
      await openFinancialYear(ctx, DATE);
      const { id: partyId } = await addParty(ctx, { name: `Party ${tag()}`, kinds: ['customer'], gstin: null, pan: null, composition: false,
        stateCode: '27', phone: null, email: null, addressLine1: '1 Main Road', addressLine2: null, city: 'Pune', pincode: '411001' });
      await setCreditTerms(ctx, { id: partyId, creditDays: 30, creditLimit: m(limit), reason: 'Test' });
      const { id: categoryId } = await addCategory(ctx, { name: `Test ${tag()}` });
      const hsn = `8715${String(randomBytes(2).readUInt16BE() % 10000).padStart(4, '0')}`;
      await putGstRate(ctx, { hsn, effectiveFrom: DATE, rate: percentString().parse('5'), source: 'Test', note: null, reason: 'Test' });
      const { id: itemId } = await addItem(ctx, { sku: `O-${tag()}`, name: 'Battery pack', categoryId, hsn, unit: 'NOS', barcode: null,
        serialised: false, hasChassis: false, purchasePrice: unitPriceString().parse('30') });
      const { id: placeId } = await addPlace(ctx, { code: `L${tag()}`, name: `Store ${tag()}`, kind: 'store' });
      await postDocument(ctx, { sourceTable: SOURCE_TABLE, sourceId: randomUUID(), businessDate: DATE, ins: [{ itemId, locationId: placeId,
        qty: q('300'), rate: unitPriceString().parse('30'), batches: [{ batchNo: 'B1', qty: q('300') }] }] });
      return { partyId, itemId, placeId };
    });
    await priceListFrom(su, DATE, { [made.itemId]: '50' }, { partyId: made.partyId });
    const { rows: [batch] } = await su.query<{ id: string }>('select id from radcore.batches where item_id = $1', [made.itemId]);
    return { ...made, batchId: batch?.id ?? '', maker, approver };
  }
  type At = Awaited<ReturnType<typeof setup>>;
  const limit = (at: At, value: string) => run((ctx) => setCreditTerms(ctx, { id: at.partyId, creditDays: 30, creditLimit: m(value), reason: 'Test' }));
  const order = (at: At, qty: string) => run(async (ctx) => (await addOrder(ctx, { partyId: at.partyId, businessDate: DATE, notes: null,
    lines: [{ itemId: at.itemId, qty: q(qty), rate: unitPriceString().parse('50'), discountPercent: percentString({ max: '100' }).parse('0') }] })).id, at.maker);
  const draftDelivery = (at: At, orderId: string, qty: string) => run(async (ctx) => {
    const orderLineId = (await getOrderById(ctx, { id: orderId })).lines[0]?.id ?? '';
    return (await addDelivery(ctx, { orderId, locationId: at.placeId, businessDate: DATE, notes: null,
      lines: [{ orderLineId, qty: q(qty), batches: [{ batchId: at.batchId, qty: q(qty) }], serials: [] }] })).id;
  }, at.maker);
  /** A confirmed order for `qty`, its whole delivery posted, under a limit that lets it through, then back to `after`. */
  const delivered = async (at: At, qty: string, after: string) => {
    await limit(at, HIGH);
    const orderId = await order(at, qty);
    await run((ctx) => confirmOrderNow(ctx, { id: orderId }), at.maker);
    const deliveryId = await draftDelivery(at, orderId, qty);
    await run((ctx) => postDeliveryNow(ctx, { id: deliveryId }), at.maker);
    await limit(at, after);
    return { orderId, deliveryId };
  };
  // 100 more delivered and not invoiced: the party owes 5,250.00 more.
  const grow = (at: At, after = LOW) => delivered(at, '100', after);
  const approved = async (at: At, ask: (ctx: Ctx, i: { id: string }) => Promise<{ id: string; versionHash: string }>,
    spec: Parameters<typeof decideApproval>[1], id: string) => {
    const request = await run((ctx) => ask(ctx, { id }), at.maker);
    await run((ctx) => decideApproval(ctx, spec, request.id, { decision: 'approve', versionHash: request.versionHash }), at.approver);
  };
  const confirm = (at: At, id: string) => failure(run((ctx) => confirmOrderNow(ctx, { id }), at.maker));
  const postDelivery = (at: At, id: string) => failure(run((ctx) => postDeliveryNow(ctx, { id }), at.maker));
  const postInvoice = (at: At, id: string) => failure(run((ctx) => postInvoiceNow(ctx, { id }), at.maker));
  const afterOf = async (table: string, id: string) =>
    (await su.query<{ after: string | null }>(`select override_after::text as after from radcore.${table} where id = $1`, [id])).rows[0]?.after;

  it('asks again at each stage once the party owes 5,000 more than when its override was approved', async () => {
    // The order: approved at 105.00 owed, then 5,250.00 more delivered elsewhere.
    const a = await setup(LOW);
    const orderId = await order(a, '2');
    await approved(a, askOrderOverride, orderOverride, orderId);
    expect(await afterOf('sales_orders', orderId)).toBe('105.00');
    await grow(a);
    expect(await confirm(a, orderId)).toBe('version_changed');
    // Asked and approved again, at what's owed now, it's confirmed.
    await approved(a, askOrderOverride, orderOverride, orderId);
    expect([await afterOf('sales_orders', orderId), await confirm(a, orderId)]).toEqual(['5355.00', 'ok']);

    // The delivery: its order confirmed under a high limit, the limit lowered, the delivery approved, then more owed.
    const d = await setup(HIGH);
    const dOrder = await order(d, '2');
    await run((ctx) => confirmOrderNow(ctx, { id: dOrder }), d.maker);
    await limit(d, LOW);
    const deliveryId = await draftDelivery(d, dOrder, '2');
    expect(await postDelivery(d, deliveryId)).toBe('needs_override');
    await approved(d, askDeliveryOverride, deliveryOverride, deliveryId);
    await grow(d);
    expect(await postDelivery(d, deliveryId)).toBe('version_changed');

    // The invoice: its delivery posted under a high limit, the limit lowered, the invoice approved, then more owed.
    const i = await setup(HIGH);
    const sent = await delivered(i, '2', LOW);
    const invoiceId = await run(async (ctx) => {
      const deliveryLineId = (await getDeliveryById(ctx, { id: sent.deliveryId })).lines[0]?.id ?? '';
      return (await addInvoice(ctx, { partyId: i.partyId, businessDate: DATE, notes: null, shipTo: null,
        lines: [{ deliveryLineId, qty: q('2'), rate: unitPriceString().parse('50') }] })).id;
    }, i.maker);
    expect(await postInvoice(i, invoiceId)).toBe('needs_override');
    await approved(i, askInvoiceOverride, invoiceOverride, invoiceId);
    await grow(i);
    expect(await postInvoice(i, invoiceId)).toBe('version_changed');
  });

  it('lets an approved order through at the same figure, and a delivery at a smaller one', async () => {
    const a = await setup(LOW);
    const orderId = await order(a, '2');
    await approved(a, askOrderOverride, orderOverride, orderId);
    expect(await confirm(a, orderId)).toBe('ok');

    const d = await setup(HIGH);
    const dOrder = await order(d, '2');
    await run((ctx) => confirmOrderNow(ctx, { id: dOrder }), d.maker);
    await limit(d, LOW);
    const deliveryId = await draftDelivery(d, dOrder, '2');
    await approved(d, askDeliveryOverride, deliveryOverride, deliveryId);
    // An advance of 1.00 leaves it owing 104.00: still over the limit, and less than approved.
    await run(async (ctx) => recordPayment(ctx, { kind: 'receipt', partyId: d.partyId, businessDate: DATE, amount: m('1'),
      accountId: await systemAccountId(ctx, 'cash') }));
    expect(await postDelivery(d, deliveryId)).toBe('ok');
  });

  // Q1: the approver approved what's owed, so a limit raised since, still short of it, lets no more through.
  it('keeps a raised limit from letting a larger figure through', async () => {
    const a = await setup(LOW);
    const orderId = await order(a, '2');
    await approved(a, askOrderOverride, orderOverride, orderId);
    await grow(a, '5300');
    expect(await confirm(a, orderId)).toBe('version_changed');
  });

  // An approval with over_limit and no figure (one approved before RAD-135) is asked again.
  it('asks again when an approved over_limit has no figure recorded', async () => {
    const a = await setup(LOW);
    const orderId = await order(a, '2');
    await approved(a, askOrderOverride, orderOverride, orderId);
    await su.query(`with p as (select set_config('app.principal', 'system:test', true))
      update radcore.sales_orders set override_after = null from p where id = $1`, [orderId]);
    expect(await confirm(a, orderId)).toBe('version_changed');
  });
});
