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
import { AppError, loadConfig, Settings, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import {
  addBooking, addDelivery, addInvoice, addOrder, cancelBookingNow, cancelDeliveryNow, cancelOrderNow, changeOrder, closeOrderNow,
  confirmOrderNow, getBookingById, getDeliveryById, getOrderById, listBookingsPage, listTestRidesPage, postDeliveryNow, postInvoiceNow,
  recordRide, refundBookingNow, saveChecklist, scheduleRide,
} from '@radcore/lib-sales';
import { addCategory, addItem, addPlace, postUnitEvents } from '@radcore/lib-stock';
import { testSettings } from '@radcore/test-helpers';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp, listen } from '../apps/api/src/app.ts';
import salesRoutes from '../apps/api/src/routes/sales.ts';
import { priceListFrom } from './price-list-fixture.ts';
import { postDocument, SOURCE_TABLE } from './stock-posting.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
// A fixed past day, so no test reads the run date (RC-156).
const DATE = '2026-11-15';
const KEYS = ['sales:read', 'sales:write', 'deliveries:write', 'deliveries:cancel', 'invoices:write', 'bookings:read', 'bookings:write', 'leads:read', 'leads:write',
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
        stateCode: '27', phone: null, email: null, addressLine1: '1 Main Road', addressLine2: null, city: 'Pune', pincode: '411001' });
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
  /** A file as the upload check left it, written as the system (the stamp trigger needs a principal). */
  const fileOf = async (kind: string, status = 'ready') => {
    const id = randomUUID();
    const c = await su.connect();
    try {
      await c.query('begin');
      await c.query("set local app.principal = 'system:test'");
      await c.query(`insert into radcore.files (id, kind, store_key, filename, content_type, size, status)
        values ($1, $2, $3, 'f.png', 'image/png', 2048, $4)`, [id, kind, `${kind}/${id}`, status]);
      await c.query('commit');
    } finally {
      c.release();
    }
    return id;
  };
  /** A request through the API, so a refusal is checked as declared on its route, not answered as a 500. */
  const http = async (method: string, path: string, body: unknown) => {
    const config = loadConfig(testSettings(), 'api');
    const app = createApp(config, { info: () => undefined, error: () => undefined }, { db, authenticate: async () => staff, routes: salesRoutes });
    const server = await listen(app, 0, '127.0.0.1');
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}${path}`, { method, body: JSON.stringify(body),
        headers: { 'content-type': 'application/json', origin: config.publicOrigin, 'idempotency-key': randomUUID() } });
      return [res.status, (await res.json() as { code?: string }).code ?? 'ok'];
    } finally {
      await server.stop();
    }
  };

  it('keeps a delivered booking’s checklist, each file a ready upload of its own kind; the invoice never waits for it (RC-208)', async () => {
    const booked = `S-${tag()}`;
    const at = await setup({ serials: [booked] });
    const line = at.lines[0] ?? { orderId: '', orderLineId: '' };
    const { id } = await book(line.orderLineId, booked, '10000');
    const [photo, note] = [await fileOf('delivery_photo'), await fileOf('delivery_note')];
    const save = (o: { photoId?: string | null; noteId?: string | null; briefed?: boolean } = {}) => run((ctx) => saveChecklist(ctx, { id,
      inspected: true, briefed: o.briefed ?? true, warrantyRegistered: true, photoId: o.photoId === undefined ? photo : o.photoId,
      noteId: o.noteId === undefined ? note : o.noteId }));
    expect(await failure(save())).toBe('wrong_status');
    const deliveryId = await deliver(at, line, at.placeId, booked);
    // An import CSV can't stand in for the photo, nor a photo for the signed note; a file still being checked waits.
    expect(await http('PUT', `/sales/bookings/${id}/checklist`, { inspected: true, briefed: true, warrantyRegistered: true,
      photoId: await fileOf('statement'), noteId: note })).toEqual([422, 'wrong_file_kind']);
    expect(await failure(save({ noteId: photo }))).toBe('wrong_file_kind');
    expect(await failure(save({ photoId: await fileOf('delivery_photo', 'pending') }))).toBe('not_ready');
    expect(await save({ briefed: false, noteId: null })).toEqual({ complete: false });
    const incomplete = () => run(async (ctx) => (await listBookingsPage(ctx, { filter: { orderId: line.orderId, checklist: 'incomplete' }, limit: 10 }))
      .items.map((b) => b.id));
    expect(await incomplete()).toEqual([id]);
    // The invoice posts with the checklist incomplete.
    await run(async (ctx) => {
      const deliveryLineId = (await getDeliveryById(ctx, { id: deliveryId })).lines[0]?.id ?? '';
      const { id: invoiceId } = await addInvoice(ctx, { partyId: at.partyId, businessDate: DATE, notes: null, shipTo: null,
        lines: [{ deliveryLineId, qty: q('1') }] });
      await postInvoiceNow(ctx, { id: invoiceId });
    });
    expect(await save()).toEqual({ complete: true });
    expect([(await run((ctx) => getBookingById(ctx, { id }))).checklist, await incomplete()]).toEqual([{ inspected: true, briefed: true,
      warrantyRegistered: true, photoId: photo, noteId: note, complete: true }, []]);
  });

  it('takes test rides on our demo units only, several to a unit; each records its outcome once', async () => {
    const [demo, fresh] = [`S-${tag()}`, `S-${tag()}`];
    const at = await setup({ serials: [demo, fresh] });
    await run((ctx) => postUnitEvents(ctx, { sourceTable: SOURCE_TABLE, sourceId: randomUUID(), businessDate: DATE,
      changes: [{ kind: 'condition_changed', itemId: at.itemId, serialNo: demo, condition: 'demo' }] }));
    const lead = await leadOf(staff);
    const ride = (serialNo: string, o: { leadId?: string; as?: Principal; at?: string } = {}) => run((ctx) => scheduleRide(ctx,
      { leadId: o.leadId ?? lead, itemId: at.itemId, serialNo, scheduledAt: o.at ?? '2026-11-16T05:30:00.000Z' }), o.as);
    expect(await failure(ride(fresh))).toBe('not_demo');
    expect(await failure(ride('NO-SUCH'))).toBe('not_demo');
    // Another seller's lead, for one who sees only their own.
    expect(await failure(ride(demo, { as: person([], ['leads:read', 'bookings:write']) }))).toBe('not_found');
    // Far ahead, so it's still to come whenever the suite runs.
    const later = await ride(demo, { at: '2099-01-01T09:00:00.000Z' });
    const first = await ride(demo);
    const again = await ride(demo);
    const record = (id: string, outcome: 'liked' | 'cancelled') => failure(run((ctx) => recordRide(ctx, { id, outcome })));
    // A ride still to come can only be called off (auditor-2's note on #292).
    expect([await record(first.id, 'liked'), await record(first.id, 'cancelled'), await record(again.id, 'cancelled'),
      await record(later.id, 'liked')]).toEqual(['ok', 'wrong_status', 'ok', 'wrong_status']);
    const rides = await run((ctx) => listTestRidesPage(ctx, { filter: { leadId: lead }, limit: 10 }));
    expect(rides.items.map((r) => [r.id, r.outcome])).toEqual(expect.arrayContaining([[first.id, 'liked'], [again.id, 'cancelled']]));
    expect(rides.items.at(-1)).toMatchObject({ id: later.id, outcome: null, doneAt: null });
    // Done needs an outcome, and an outcome a ride that's done, in the table too.
    const c = await su.connect();
    try {
      await c.query('begin');
      await c.query("set local app.principal = 'system:test'");
      await expect(c.query('update radcore.test_rides set done_at = now() where id = $1', [later.id])).rejects.toMatchObject({ code: '23514' });
    } finally {
      await c.query('rollback');
      c.release();
    }
  });

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
