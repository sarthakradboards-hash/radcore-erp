// RAD-117 (M3-13; ADR-007 §5; RC-122, RC-127; the architect's rulings) on a real PostgreSQL, as the runtime login:
// vehicle bookings. A booking holds one unit for a confirmed order line of quantity 1, and takes its advance as a
// receipt held for it. The hold ends when the line is done, whatever serial leaves from wherever; the order can't be
// rewritten, cancelled or closed short around it. Cancelling says what becomes of what's left: all of it needs
// bookings:refund_full, part bookings:refund_part, judged under the booking's lock with waiting refunds counted. Each
// test makes its own party, item, places and units.
import { randomBytes, randomUUID } from 'node:crypto';
import { addParty, openFinancialYear, setCreditTerms } from '@radcore/lib-accounts';
import { moneyString, percentString, quantityString, unitPriceString } from '@radcore/lib-common';
import { captureEnquiry } from '@radcore/lib-crm';
import { putGstRate } from '@radcore/lib-gst';
import { AppError, Settings, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import {
  addBooking, addDelivery, addOrder, cancelBookingNow, cancelDeliveryNow, cancelOrderNow, changeOrder, closeOrderNow, confirmOrderNow,
  getBookingById, getOrderById, postDeliveryNow, refundBookingNow,
} from '@radcore/lib-sales';
import { addCategory, addItem, addPlace, postUnitEvents } from '@radcore/lib-stock';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { priceListFrom } from './price-list-fixture.ts';
import { postDocument, SOURCE_TABLE } from './stock-posting.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
// A fixed past day, so no test reads the run date (RC-156).
const DATE = '2026-11-15';
const KEYS = ['sales:read', 'sales:write', 'deliveries:write', 'deliveries:cancel', 'bookings:read', 'bookings:write', 'leads:read', 'leads:write',
  'parties:write', 'parties:manage', 'items:write', 'locations:write', 'cost:read', 'gst:write'];
const FULL = 'bookings:refund_full';
const PART = 'bookings:refund_part';
const person = (extra: string[] = [], ownScope: string[] = []): Principal => ({ kind: 'user', userId: randomUUID(), permissions: [...KEYS, ...extra], ownScope });
const tag = () => randomBytes(3).toString('hex').toUpperCase();
const q = (s: string) => quantityString().parse(s);
const m = (s: string) => moneyString().parse(s);
const mobile = () => `9${String(randomBytes(4).readUInt32BE() % 1_000_000_000).padStart(9, '0')}`;

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the booking tests must run, not skip');
});

describe.skipIf(!url || !superUrl)('vehicle bookings', { timeout: 60_000 }, () => {
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  const su = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
    await su.end();
  });
  const staff = person([FULL, PART]);
  const run = <T>(fn: (ctx: Ctx) => Promise<T>, as: Principal = staff) => runInTransaction(db, WRITE, as, randomUUID(), fn);
  const failure = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof AppError ? `${e.code}${e.code === 'forbidden' ? `: ${e.message}` : ''}` : String(e)));
  const systemId = async (key: string) => (await su.query<{ id: string }>('select id from radcore.accounts where system_key = $1', [key])).rows[0]?.id ?? '';
  const unit = async (serialNo: string) => (await su.query<{ promised_to: string | null; ownership: string }>(
    'select promised_to, ownership from radcore.units where serial_no = $1', [serialNo])).rows[0];

  /** A customer, a serialised scooter, two stores each holding units of it, and confirmed orders of quantity `qty`. */
  async function setup(o: { serials: string[]; elsewhere?: string[]; qty?: string; orders?: number }) {
    const made = await run(async (ctx) => {
      await openFinancialYear(ctx, DATE);
      const { id: partyId } = await addParty(ctx, { name: `Party ${tag()}`, kinds: ['customer'], gstin: null, pan: null, composition: false,
        stateCode: '27', phone: null, email: null, addressLine1: null, addressLine2: null, city: null, pincode: null });
      await setCreditTerms(ctx, { id: partyId, creditDays: 30, creditLimit: m('10000000'), reason: 'Test' });
      const { id: categoryId } = await addCategory(ctx, { name: `Test ${tag()}` });
      const hsn = `8711${String(randomBytes(2).readUInt16BE() % 10000).padStart(4, '0')}`;
      await putGstRate(ctx, { hsn, effectiveFrom: DATE, rate: percentString().parse('5'), source: 'Test', note: null, reason: 'Test' });
      const { id: itemId } = await addItem(ctx, { sku: `B-${tag()}`, name: 'Electric scooter', categoryId, hsn, unit: 'NOS', barcode: null,
        serialised: true, hasChassis: false, purchasePrice: unitPriceString().parse('50000') });
      const places = [];
      for (const serials of [o.serials, o.elsewhere ?? []]) {
        const { id: placeId } = await addPlace(ctx, { code: `L${tag()}`, name: `Store ${tag()}`, kind: 'store' });
        if (serials.length > 0) {
          await postDocument(ctx, { sourceTable: SOURCE_TABLE, sourceId: randomUUID(), businessDate: DATE, ins: [{ itemId, locationId: placeId,
            qty: q(String(serials.length)), rate: unitPriceString().parse('50000'), batches: [{ batchNo: 'B1', qty: q(String(serials.length)) }],
            units: serials.map((serialNo) => ({ serialNo })) }] });
        }
        places.push(placeId);
      }
      return { partyId, itemId, placeId: places[0] ?? '', otherPlaceId: places[1] ?? '' };
    });
    await priceListFrom(su, DATE, { [made.itemId]: '70000' }, { partyId: made.partyId });
    const lines = [];
    for (let n = 0; n < (o.orders ?? 1); n += 1) {
      lines.push(await run(async (ctx) => {
        const { id: orderId } = await addOrder(ctx, { partyId: made.partyId, businessDate: DATE, notes: null, lines: [{ itemId: made.itemId,
          qty: q(o.qty ?? '1'), rate: unitPriceString().parse('70000'), discountPercent: percentString({ max: '100' }).parse('0') }] });
        await confirmOrderNow(ctx, { id: orderId });
        return { orderId, orderLineId: (await getOrderById(ctx, { id: orderId })).lines[0]?.id ?? '' };
      }));
    }
    return { ...made, lines };
  }
  const batchOf = async (itemId: string, placeId: string) => (await su.query<{ id: string }>(
    'select b.id from radcore.batches b join radcore.stock_movement_batches mb on mb.batch_id = b.id join radcore.stock_movements sm on sm.id = mb.movement_id where b.item_id = $1 and sm.location_id = $2 limit 1',
    [itemId, placeId])).rows[0]?.id ?? '';
  const book = async (orderLineId: string, serialNo: string, amount: string, o: { leadId?: string; as?: Principal; account?: string } = {}) =>
    run(async (ctx) => addBooking(ctx, { orderLineId, serialNo, ...(o.leadId === undefined ? {} : { leadId: o.leadId }),
      advance: { amount: m(amount), accountId: o.account ?? await systemId('bank'), businessDate: DATE } }), o.as);
  const deliver = async (at: { itemId: string }, line: { orderId: string; orderLineId: string }, placeId: string, serial: string) => {
    const batchId = await batchOf(at.itemId, placeId);
    const { id } = await run((ctx) => addDelivery(ctx, { orderId: line.orderId, locationId: placeId, businessDate: DATE, notes: null,
      lines: [{ orderLineId: line.orderLineId, qty: q('1'), batches: [{ batchId, qty: q('1') }], serials: [serial] }] }));
    await run((ctx) => postDeliveryNow(ctx, { id }));
    return id;
  };
  const leadOf = async (owner: Principal) => (await run((ctx) => captureEnquiry(ctx, { phone: mobile(), source: 'manual' }), owner)).id ?? '';
  const stageOf = async (leadId: string) => (await su.query<{ stage: string; follow_up_on: string | null }>(
    'select stage, follow_up_on::text from radcore.leads where id = $1', [leadId])).rows[0];

  it('books a unit on a line of 1, holds it for the line and takes the advance; refuses what isn’t bookable', async () => {
    const s = [`S-${tag()}`, `S-${tag()}`];
    const at = await setup({ serials: s, orders: 2 });
    const [a, b] = at.lines;
    const lead = await leadOf(staff);
    const made = await book(a?.orderLineId ?? '', s[0] ?? '', '25000', { leadId: lead });
    expect([made.number, made.receipt.status]).toEqual([expect.stringMatching(/^BK\//) as unknown, 'posted']);
    expect(await unit(s[0] ?? '')).toEqual({ promised_to: a?.orderLineId, ownership: 'ours' });
    expect((await run((ctx) => getBookingById(ctx, { id: made.id }))).advance).toEqual({ taken: '25000.00', left: '25000.00' });
    expect((await stageOf(lead))?.stage).toBe('converted');
    // The same line again, the same unit for another line, a unit that isn't there, and no advance.
    expect(await failure(book(a?.orderLineId ?? '', s[1] ?? '', '1000'))).toBe('line_booked');
    expect(await failure(book(b?.orderLineId ?? '', s[0] ?? '', '1000'))).toBe('unit_held');
    expect(await failure(book(b?.orderLineId ?? '', 'NO-SUCH', '1000'))).toBe('unit_unavailable');
    expect(await failure(book(b?.orderLineId ?? '', s[1] ?? '', '0'))).toBe('advance_required');
    const two = await setup({ serials: [`S-${tag()}`], qty: '2' });
    expect(await failure(book(two.lines[0]?.orderLineId ?? '', 'X', '1000'))).toBe('booking_one_unit');
  });

  it('books a damaged unit only where stock.sell_damaged_units is on (auditor-2 on #286)', async () => {
    const damaged = `S-${tag()}`;
    const at = await setup({ serials: [damaged] });
    await run((ctx) => postUnitEvents(ctx, { sourceTable: SOURCE_TABLE, sourceId: randomUUID(), businessDate: DATE,
      changes: [{ kind: 'condition_changed', itemId: at.itemId, serialNo: damaged, condition: 'damaged' }] }));
    // One transaction's ctx answers the setting, so the shared row is never changed under another test file.
    const withSetting = (on: boolean) => failure(run(async (ctx) => addBooking({ ...ctx, settings: new Settings([{ key: 'stock.sell_damaged_units', value: on }]) },
      { orderLineId: at.lines[0]?.orderLineId ?? '', serialNo: damaged, advance: { amount: m('1000'), accountId: await systemId('bank'), businessDate: DATE } })));
    expect([await withSetting(false), await withSetting(true)]).toEqual(['unit_unavailable', 'ok']);
  });

  it('ends the hold when the line is delivered with another serial from another place (RC-122)', async () => {
    const booked = `S-${tag()}`;
    const other = `S-${tag()}`;
    const at = await setup({ serials: [booked], elsewhere: [other] });
    const line = at.lines[0] ?? { orderId: '', orderLineId: '' };
    const { id } = await book(line.orderLineId, booked, '10000');
    await deliver(at, line, at.otherPlaceId, other);
    expect([(await unit(booked))?.promised_to, (await unit(other))?.ownership]).toEqual([null, 'customer']);
    expect((await run((ctx) => getBookingById(ctx, { id }))).status).toBe('delivered');
  });

  it('ends a booked line’s hold for someone who delivers it without any bookings key, and tells them nothing of the booking', async () => {
    const booked = `S-${tag()}`;
    const at = await setup({ serials: [booked] });
    const line = at.lines[0] ?? { orderId: '', orderLineId: '' };
    const { id } = await book(line.orderLineId, booked, '10000');
    const deliverer: Principal = { kind: 'user', userId: randomUUID(), permissions: ['sales:read', 'deliveries:write'] };
    const batchId = await batchOf(at.itemId, at.placeId);
    const { id: deliveryId } = await run((ctx) => addDelivery(ctx, { orderId: line.orderId, locationId: at.placeId, businessDate: DATE, notes: null,
      lines: [{ orderLineId: line.orderLineId, qty: q('1'), batches: [{ batchId, qty: q('1') }], serials: [booked] }] }), deliverer);
    const answer = await run((ctx) => postDeliveryNow(ctx, { id: deliveryId }), deliverer);
    expect(Object.keys(answer)).toEqual(['number']);
    expect([(await unit(booked))?.ownership, (await run((ctx) => getBookingById(ctx, { id }))).status]).toEqual(['customer', 'delivered']);
  });

  it('puts a cancelled delivery’s booking back, holding the unit that came back', async () => {
    const booked = `S-${tag()}`;
    const at = await setup({ serials: [booked] });
    const line = at.lines[0] ?? { orderId: '', orderLineId: '' };
    const { id } = await book(line.orderLineId, booked, '10000');
    const deliveryId = await deliver(at, line, at.placeId, booked);
    await run((ctx) => cancelDeliveryNow(ctx, { id: deliveryId, businessDate: DATE, reason: 'Wrong scooter loaded' }));
    expect([(await run((ctx) => getBookingById(ctx, { id }))).status, (await unit(booked))?.promised_to]).toEqual(['booked', line.orderLineId]);
  });

  it('refuses to close the order short, cancel it or rewrite its lines while a booking holds its unit', async () => {
    const booked = `S-${tag()}`;
    const at = await setup({ serials: [booked] });
    const line = at.lines[0] ?? { orderId: '', orderLineId: '' };
    await book(line.orderLineId, booked, '10000');
    expect(await failure(run((ctx) => closeOrderNow(ctx, { id: line.orderId, reason: 'Customer changed mind' })))).toBe('booking_live');
    const refused = await run((ctx) => closeOrderNow(ctx, { id: line.orderId, reason: 'x' })).catch((e: unknown) => e);
    expect((refused as AppError).message).toBe('Line 1 has a vehicle booked on it: cancel its booking first, so its advance is explained');
    expect(await failure(run((ctx) => cancelOrderNow(ctx, { id: line.orderId, reason: 'Customer changed mind' })))).toBe('booking_live');
    expect(await failure(run((ctx) => changeOrder(ctx, { id: line.orderId, partyId: at.partyId, businessDate: DATE, notes: null,
      lines: [{ itemId: at.itemId, qty: q('1'), rate: unitPriceString().parse('69000'), discountPercent: percentString({ max: '100' }).parse('0') }] }))))
      .toBe('booking_live');
    // The unit is still promised to a line that exists: the refused rewrite left the order's lines as they were.
    const [promised] = (await su.query<{ n: number }>('select count(*)::int n from radcore.units u join radcore.sales_order_lines l on l.id = u.promised_to where u.serial_no = $1',
      [booked])).rows;
    expect(promised?.n).toBe(1);
  });

  it('refuses to rewrite an order whose booking was cancelled, by name, not with a database error (auditor-2 on #286)', async () => {
    const booked = `S-${tag()}`;
    const at = await setup({ serials: [booked] });
    const line = at.lines[0] ?? { orderId: '', orderLineId: '' };
    const { id } = await book(line.orderLineId, booked, '10000');
    await run((ctx) => cancelBookingNow(ctx, { id, businessDate: DATE, reason: 'Customer changed mind' }));
    const rewrite = run((ctx) => changeOrder(ctx, { id: line.orderId, partyId: at.partyId, businessDate: DATE, notes: null,
      lines: [{ itemId: at.itemId, qty: q('1'), rate: unitPriceString().parse('69000'), discountPercent: percentString({ max: '100' }).parse('0') }] }));
    const refused = await rewrite.catch((e: unknown) => e);
    expect([(refused as AppError).code, (refused as AppError).message])
      .toEqual(['booking_live', 'Line 1 has a booking, so this order’s lines are fixed: make a new order for extras or another vehicle']);
  });

  it('cancels with a reason: the unit is free, the lead is interested and due today, unless it has another live booking (RC-127)', async () => {
    const s = [`S-${tag()}`, `S-${tag()}`];
    const at = await setup({ serials: s, orders: 2 });
    const lead = await leadOf(staff);
    const first = await book(at.lines[0]?.orderLineId ?? '', s[0] ?? '', '10000', { leadId: lead });
    const second = await book(at.lines[1]?.orderLineId ?? '', s[1] ?? '', '10000', { leadId: lead });
    expect(await run((ctx) => cancelBookingNow(ctx, { id: first.id, businessDate: DATE, reason: 'Went with another colour' })))
      .toEqual({ refunds: [], credit: '10000.00' });
    expect([(await unit(s[0] ?? ''))?.promised_to, (await stageOf(lead))?.stage]).toEqual([null, 'converted']);
    await run((ctx) => cancelBookingNow(ctx, { id: second.id, businessDate: DATE, reason: 'Moving to another city' }));
    expect(await stageOf(lead)).toEqual({ stage: 'interested', follow_up_on: DATE });
    const [note] = (await su.query<{ note: string }>("select note from radcore.lead_activities where lead_id = $1 and stage = 'interested'", [lead])).rows;
    expect(note?.note).toBe(`Booking ${second.number} cancelled: Moving to another city`);
  });

  it('cancels two bookings of one lead at once and resets the lead once; a make during a cancel leaves it converted', async () => {
    const s = [`S-${tag()}`, `S-${tag()}`, `S-${tag()}`, `S-${tag()}`];
    const at = await setup({ serials: s, orders: 4 });
    const [l1, l2, l3, l4] = at.lines;
    const both = await leadOf(staff);
    const [a, b] = [await book(l1?.orderLineId ?? '', s[0] ?? '', '1000', { leadId: both }), await book(l2?.orderLineId ?? '', s[1] ?? '', '1000', { leadId: both })];
    await Promise.all([a, b].map((x) => run((ctx) => cancelBookingNow(ctx, { id: x.id, businessDate: DATE, reason: 'Both at once' }))));
    const resets = (await su.query<{ n: number }>("select count(*)::int n from radcore.lead_activities where lead_id = $1 and stage = 'interested'", [both])).rows[0];
    expect([(await stageOf(both))?.stage, resets?.n]).toEqual(['interested', 1]);
    const one = await leadOf(staff);
    const only = await book(l3?.orderLineId ?? '', s[2] ?? '', '1000', { leadId: one });
    await Promise.all([run((ctx) => cancelBookingNow(ctx, { id: only.id, businessDate: DATE, reason: 'Another on the way' })),
      book(l4?.orderLineId ?? '', s[3] ?? '', '1000', { leadId: one })]);
    expect((await stageOf(one))?.stage).toBe('converted');
  });

  it('refunds all of what’s left only with refund_full, part with refund_part, and never more than is left', async () => {
    const s = [`S-${tag()}`, `S-${tag()}`, `S-${tag()}`];
    const at = await setup({ serials: s, orders: 3 });
    const bank = await systemId('bank');
    const [x, y, z] = await Promise.all(at.lines.map((l, n) => book(l.orderLineId, s[n] ?? '', '10000')));
    const partOnly = person([PART]);
    const neither = person();
    const cancel = (id: string, amount: string | null, as: Principal) => failure(run((ctx) => cancelBookingNow(ctx, { id, businessDate: DATE,
      reason: 'Test', ...(amount === null ? {} : { refund: { amount: m(amount), accountId: bank } }) }), as));
    expect(await cancel(x?.id ?? '', '10000', partOnly)).toBe('forbidden: Refunding all of what’s left needs bookings:refund_full');
    expect(await cancel(x?.id ?? '', '4000', neither)).toBe('forbidden: Refunding part of the advance needs bookings:refund_part');
    expect(await cancel(x?.id ?? '', '4000', partOnly)).toBe('ok');
    expect(await cancel(y?.id ?? '', '10000.01', staff)).toBe('exceeds_receipt');
    expect(await cancel(y?.id ?? '', null, neither)).toBe('ok');
    expect(await cancel(z?.id ?? '', '10000', staff)).toBe('ok');
    expect([(await run((ctx) => getBookingById(ctx, { id: x?.id ?? '' }))).advance.left, (await run((ctx) => getBookingById(ctx, { id: z?.id ?? '' }))).advance.left])
      .toEqual(['6000.00', '0.00']);
  });

  it('judges two part refunds at once one after the other, so the second needs refund_full (the architect’s rule 1)', async () => {
    const booked = `S-${tag()}`;
    const at = await setup({ serials: [booked] });
    const { id } = await book(at.lines[0]?.orderLineId ?? '', booked, '100');
    await run((ctx) => cancelBookingNow(ctx, { id, businessDate: DATE, reason: 'Test' }));
    const bank = await systemId('bank');
    const partOnly = person([PART]);
    const refund = () => failure(run((ctx) => refundBookingNow(ctx, { id, amount: m('50'), accountId: bank, businessDate: DATE }), partOnly));
    expect((await Promise.all([refund(), refund()])).toSorted()).toEqual(['forbidden: Refunding all of what’s left needs bookings:refund_full', 'ok']);
  });

  it('counts a refund waiting for cash-limit approval as gone, so the rest needs refund_full (the architect’s rule 2)', async () => {
    const booked = `S-${tag()}`;
    const at = await setup({ serials: [booked] });
    const { id } = await book(at.lines[0]?.orderLineId ?? '', booked, '100000');
    await run((ctx) => cancelBookingNow(ctx, { id, businessDate: DATE, reason: 'Test' }));
    // 60,000 in cash is past the day's limit for money paid out, so it waits for an owner.
    const cash = await systemId('cash');
    const waiting = await run((ctx) => refundBookingNow(ctx, { id, amount: m('60000'), accountId: cash, businessDate: DATE }));
    expect(waiting.refunds.map((r) => r.status)).toEqual(['pending_approval']);
    const partOnly = person([PART]);
    const bank = await systemId('bank');
    const rest = (as: Principal) => failure(run((ctx) => refundBookingNow(ctx, { id, amount: m('40000'), accountId: bank, businessDate: DATE }), as));
    expect(await rest(partOnly)).toBe('forbidden: Refunding all of what’s left needs bookings:refund_full');
    expect(await rest(staff)).toBe('ok');
  });

  it('refuses a lead the person may not open (not_found)', async () => {
    const booked = `S-${tag()}`;
    const at = await setup({ serials: [booked] });
    const theirs = await leadOf(person([], ['leads:read', 'leads:write']));
    const mine = person([], ['leads:read', 'leads:write']);
    expect(await failure(book(at.lines[0]?.orderLineId ?? '', booked, '1000', { leadId: theirs, as: mine }))).toBe('not_found');
  });
});
