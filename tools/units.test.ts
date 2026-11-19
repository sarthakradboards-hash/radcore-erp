// RAD-94 (M2-06, ADR-006 §5; RC-026, RC-027) on a real PostgreSQL, as the runtime login: units by serial. A unit's
// ownership, condition, promise and place are separate columns, and only its events change it: the database applies
// each, refuses one its state doesn't allow (RA008), and checks at commit that every movement of a serialised item has
// as many units as its quantity, batch by batch (RA007). The SCOOTER figures are ADR-006 §8's (F1, F2, F4, F5, F12).
// Each test makes its own items, locations and serials, so the shuffled order doesn't matter.
import { randomBytes, randomUUID } from 'node:crypto';
import { quantityString, unitPriceString, UNIT_EVENTS } from '@radcore/lib-common';
import { AppError, recordChangeReason, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import {
  addCategory, addItem, addPlace, changeItem, postUnitEvents, type StockPosting, type UnitChange,
} from '@radcore/lib-stock';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { postDocument, SOURCE_TABLE } from './stock-posting.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
const DATE = '2026-11-15';
const staff: Principal = { kind: 'user', userId: '00000000-0000-4000-8000-000000000094',
  permissions: ['items:write', 'locations:write'] };
const q = (s: string) => quantityString().parse(s);
const r = (s: string) => unitPriceString().parse(s);
const tag = () => randomBytes(3).toString('hex').toUpperCase();

describe.skipIf(!url || !superUrl)('units by serial', () => {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  const su = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
    await su.end();
  });
  const run = <T>(fn: (ctx: Ctx) => Promise<T>) => runInTransaction(db, WRITE, staff, randomUUID(), fn);
  const post = (p: Omit<StockPosting, 'sourceTable' | 'sourceId' | 'businessDate'>) =>
    run((ctx) => postDocument(ctx, { sourceTable: SOURCE_TABLE, sourceId: randomUUID(), businessDate: DATE, ...p }));
  const change = (changes: UnitChange[], reason?: string) => run(async (ctx) => {
    if (reason !== undefined) await recordChangeReason(ctx, reason);
    await postUnitEvents(ctx, { sourceTable: SOURCE_TABLE, sourceId: randomUUID(), businessDate: DATE, changes });
  });
  // An AppError's code, or the database's SQLSTATE and, with `says`, whether its message says it.
  const failure = (p: Promise<unknown>, says?: string) => p.then(() => 'ok', (e: unknown) => {
    if (e instanceof AppError) return e.code;
    const err = (e as { cause?: { code?: string; message?: string } }).cause ?? (e as { code?: string; message?: string });
    return says === undefined || (err.message ?? '').includes(says) ? String(err.code) : `${String(err.code)}: ${String(err.message)}`;
  });

  // SCOOTER (serialised, Nos) and the places F1 to F12 use, each of its own.
  async function setup(opts: { chassis?: boolean } = {}) {
    return run(async (ctx) => {
      const { id: categoryId } = await addCategory(ctx, { name: `Test ${tag()}` });
      const { id: itemId } = await addItem(ctx, { sku: `S-${tag()}`, name: 'Electric scooter', categoryId, hsn: '8711', unit: 'NOS',
        barcode: null, serialised: true, hasChassis: opts.chassis === true });
      const place = async (kind: 'stores' | 'store' | 'rejected' | 'demo' | 'service_bay') =>
        (await addPlace(ctx, { code: `L${tag()}`, name: `${kind} ${tag()}`, kind })).id;
      return { itemId, stores: await place('stores'), showroom: await place('store'), rejected: await place('rejected'),
        demo: await place('demo'), bay: await place('service_bay') };
    });
  }
  const serials = (n: number) => Array.from({ length: n }, () => `S-${tag()}`);
  const unitOf = async (itemId: string, serial: string) => (await su.query<{ ownership: string; condition: string; location: string | null;
    sale: string | null; promised: string | null; batch: string | null; chassis: string | null }>(`select ownership, condition,
      location_id as location, sale_line_id as sale, promised_to as promised, batch_id as batch, chassis_no as chassis
      from radcore.units where item_id = $1 and serial_key = upper(replace($2, ' ', ''))`, [itemId, serial])).rows[0];
  const lotId = async (itemId: string, key: string) =>
    (await su.query<{ id: string }>('select id from radcore.batches where item_id = $1 and batch_key = $2', [itemId, key])).rows[0]?.id ?? '';
  const receive = (itemId: string, locationId: string, units: { serialNo: string; chassisNo?: string; condition?: 'damaged' }[], batch = 'B1') =>
    post({ ins: [{ itemId, locationId, qty: q(String(units.length)), rate: r('60000'), batches: [{ batchNo: batch, qty: q(String(units.length)) }], units }] });

  it("seeds exactly lib-common's unit event rules, read-only to the app", async () => {
    const { rows } = await su.query<{ kind: string; from: string }>('select kind, from_ownership as from from radcore.unit_event_rules');
    const expected = Object.entries(UNIT_EVENTS).flatMap(([kind, e]) => e.from.map((from) => `${kind} ${from}`)).toSorted();
    expect(rows.map((x) => `${x.kind} ${x.from}`).toSorted()).toEqual(expected);
    await expect(pool.query("insert into radcore.unit_event_rules (kind, from_ownership) values ('delivered', 'gone')"))
      .rejects.toMatchObject({ code: '42501' });
  });

  // F1: two received into Stores, ours and new, in the receipt's batch; a serial is one unit however it's written.
  it('receives each unit once, on one shelf, and never twice (F1, RC-026)', async () => {
    const at = await setup();
    const [a = '', b = ''] = serials(2);
    await receive(at.itemId, at.stores, [{ serialNo: a }, { serialNo: b }]);
    const lot = await lotId(at.itemId, 'B1');
    expect(await unitOf(at.itemId, a)).toMatchObject({ ownership: 'ours', condition: 'new', location: at.stores, batch: lot });
    expect(await failure(receive(at.itemId, at.showroom, [{ serialNo: ` ${a.toLowerCase()} `.replace('-', '- ') }]), 'received'))
      .toBe('RA008');
    expect(await failure(post({ ins: [{ itemId: at.itemId, locationId: at.stores, qty: q('2'), rate: r('1'),
      batches: [{ batchNo: 'B1', qty: q('2') }], units: [{ serialNo: `S-${tag()}` }] }] }))).toBe('units_mismatch');
  });

  // F2 and F4: a reject received damaged into Rejected goes back to the supplier and is gone; only a gone unit, never a
  // sold one, can be received again (RC-128).
  it('keeps ownership, condition and place apart, and receives again only what is gone (F2, F4)', async () => {
    const at = await setup();
    const [reject = '', sold = ''] = serials(2);
    await receive(at.itemId, at.rejected, [{ serialNo: reject, condition: 'damaged' }]);
    expect(await unitOf(at.itemId, reject)).toMatchObject({ ownership: 'ours', condition: 'damaged', location: at.rejected });
    const lot = await lotId(at.itemId, 'B1');
    await post({ outs: [{ itemId: at.itemId, locationId: at.rejected, qty: q('1'), batches: [{ batchId: lot, qty: q('1') }],
      units: [{ serialNo: reject }], unitEvent: 'returned_to_supplier' }] });
    expect(await unitOf(at.itemId, reject)).toMatchObject({ ownership: 'gone', location: null });
    await receive(at.itemId, at.stores, [{ serialNo: reject }], 'B2');
    expect(await unitOf(at.itemId, reject)).toMatchObject({ ownership: 'ours', condition: 'new', location: at.stores });
    await receive(at.itemId, at.showroom, [{ serialNo: sold }]);
    await post({ outs: [{ itemId: at.itemId, locationId: at.showroom, sourceLineId: randomUUID(), qty: q('1'),
      batches: [{ batchId: lot, qty: q('1') }], units: [{ serialNo: sold }] }] });
    expect(await failure(receive(at.itemId, at.stores, [{ serialNo: sold }], 'B3'), 'while it')).toBe('RA008');
  });

  // F5: delivered on its line, the customer's and nowhere of ours; taken back before invoicing, ours again with the sale
  // cleared (RC-128). A promise to another order stops the delivery until it's released.
  it("delivers a unit onto its sale, takes it back with the sale cleared, and keeps another order's promise (F5)", async () => {
    const at = await setup();
    const [unit = ''] = serials(1);
    await receive(at.itemId, at.showroom, [{ serialNo: unit }]);
    const lot = await lotId(at.itemId, 'B1');
    const [order, other, line] = [randomUUID(), randomUUID(), randomUUID()];
    await change([{ kind: 'reserved', itemId: at.itemId, serialNo: unit, promisedTo: order }]);
    expect(await unitOf(at.itemId, unit)).toMatchObject({ ownership: 'ours', promised: order });
    const deliver = (orderLineId: string) => post({ outs: [{ itemId: at.itemId, locationId: at.showroom, sourceLineId: line, orderLineId,
      qty: q('1'), batches: [{ batchId: lot, qty: q('1') }], units: [{ serialNo: unit }] }] });
    expect(await failure(deliver(other), 'promised')).toBe('RA008');
    await deliver(order);
    expect(await unitOf(at.itemId, unit)).toMatchObject({ ownership: 'customer', location: null, sale: line, promised: null });
    await post({ ins: [{ itemId: at.itemId, locationId: at.showroom, qty: q('1'), rate: r('61250'), batches: [{ batchNo: 'B1', qty: q('1') }],
      units: [{ serialNo: unit }], unitEvent: 'delivery_returned' }] });
    expect(await unitOf(at.itemId, unit)).toMatchObject({ ownership: 'ours', location: at.showroom, sale: null, batch: lot });
  });

  // F12: one `moved` event to Demo, condition demo, named once on each of the transfer's two movements.
  it('moves a unit to Demo on one event across both movements (F12)', async () => {
    const at = await setup();
    const [unit = ''] = serials(1);
    await receive(at.itemId, at.stores, [{ serialNo: unit }]);
    const lot = await lotId(at.itemId, 'B1');
    await post({ transfers: [{ itemId: at.itemId, from: at.stores, to: at.demo, qty: q('1'), batches: [{ batchId: lot, qty: q('1') }],
      units: [{ serialNo: unit, condition: 'demo' }] }] });
    expect(await unitOf(at.itemId, unit)).toMatchObject({ ownership: 'ours', condition: 'demo', location: at.demo });
    const { rows } = await su.query<{ kind: string; out: string; in: string }>(`select e.kind, mo.location_id as out, mi.location_id as in
      from radcore.unit_events e join radcore.units u on u.id = e.unit_id join radcore.stock_movements mo on mo.id = e.out_movement_id
      join radcore.stock_movements mi on mi.id = e.in_movement_id where u.item_id = $1 and e.kind = 'moved'`, [at.itemId]);
    expect(rows).toEqual([{ kind: 'moved', out: at.stores, in: at.demo }]);
  });

  // A customer's own scooter in for service is theirs at the bay: never stock, never sold, handed back to nowhere of ours.
  it("takes a customer's vehicle in for service apart from stock, and hands it back", async () => {
    const at = await setup();
    const [theirs = ''] = serials(1);
    await change([{ kind: 'taken_in', itemId: at.itemId, serialNo: theirs, locationId: at.bay }]);
    expect(await unitOf(at.itemId, theirs)).toMatchObject({ ownership: 'customer', condition: 'used', location: at.bay, batch: null });
    expect(await failure(change([{ kind: 'reserved', itemId: at.itemId, serialNo: theirs, promisedTo: randomUUID() }]), 'while it'))
      .toBe('RA008');
    await change([{ kind: 'handed_back', itemId: at.itemId, serialNo: theirs }]);
    expect(await unitOf(at.itemId, theirs)).toMatchObject({ ownership: 'customer', location: null });
  });

  // The architect on RAD-94: every unit event respects the period lock, one that moves no stock included (RA003); and a
  // serial is printable ASCII, so the engine's serial key, which it locks units by, is the database's (auditor-2 on #216).
  it('refuses a stock-free unit event in a locked period, passes one after it, and holds serials to printable ASCII', async () => {
    const at = await setup();
    const [unit = ''] = serials(1);
    await receive(at.itemId, at.stores, [{ serialNo: unit }]);
    expect(await failure(change([{ kind: 'taken_in', itemId: at.itemId, serialNo: 'S-É1', locationId: at.bay }]))).toBe('23514');
    const damaged = (date: string) => c.query(`insert into radcore.unit_events (item_id, serial_no, kind, source_table, source_id,
      business_date, condition) values ($1, $2, 'condition_changed', 'files', $3, $4, 'damaged')`, [at.itemId, unit, randomUUID(), date]);
    const c = await su.connect();
    try {
      await c.query('begin');
      await c.query("select set_config('app.principal', 'system:test', true)");
      await c.query('update radcore.period_lock set locked_through = $1 where id = 1', [DATE]);
      await c.query('savepoint s');
      await expect(damaged(DATE)).rejects.toMatchObject({ code: 'RA003' });
      await c.query('rollback to savepoint s');
      await damaged('2026-11-16');
    } finally {
      await c.query('rollback');
      c.release();
    }
  });

  // RA007 at commit: a serialised item's movement with fewer units than its quantity, and a move whose units aren't in
  // the batch its batch row names. Written raw where the engine would answer first.
  it('refuses at commit a movement whose units miss its quantity or its batch (RA007)', async () => {
    const at = await setup();
    const [one = '', two = ''] = serials(2);
    await receive(at.itemId, at.stores, [{ serialNo: one }], 'B1');
    await receive(at.itemId, at.stores, [{ serialNo: two }], 'B2');
    const [b1, b2] = [await lotId(at.itemId, 'B1'), await lotId(at.itemId, 'B2')];
    expect(await failure(post({ transfers: [{ itemId: at.itemId, from: at.stores, to: at.showroom, qty: q('1'),
      batches: [{ batchId: b1, qty: q('1') }], units: [{ serialNo: two }] }] }), 'batch')).toBe('RA007');
    const c = await su.connect();
    try {
      await c.query('begin');
      await c.query("select set_config('app.principal', 'system:test', true)");
      const { rows: [m] } = await c.query<{ id: string }>(`insert into radcore.stock_movements (item_id, location_id, source_table,
        source_id, direction, qty, value, rate, business_date) values ($1, $2, 'files', $3, 'in', 1, 0, 0, $4) returning id`,
      [at.itemId, at.stores, randomUUID(), DATE]);
      await c.query('insert into radcore.stock_movement_batches (movement_id, item_id, batch_id, qty) values ($1, $2, $3, 1)', [m?.id, at.itemId, b2]);
      await expect(c.query('commit')).rejects.toMatchObject({ code: 'RA007', message: expect.stringContaining('units for a quantity') });
    } finally {
      await c.query('rollback').catch(() => undefined);
      c.release();
    }
  });

  // §5's chassis numbers: a flagged item's vehicle comes in with one and leaves with one; a number names one vehicle;
  // one recorded later needs a reason; and the flag stays on once a number is recorded.
  it('holds chassis numbers to the flag on receipt, delivery and the flag itself (RA008)', async () => {
    const at = await setup({ chassis: true });
    const [a = '', b = '', c = ''] = serials(3);
    const chassis = `MA1${tag()}${tag()}`;
    expect(await failure(receive(at.itemId, at.stores, [{ serialNo: a }]), 'chassis')).toBe('RA008');
    await receive(at.itemId, at.stores, [{ serialNo: a, chassisNo: chassis }]);
    expect(await unitOf(at.itemId, a)).toMatchObject({ chassis });
    expect(await failure(receive(at.itemId, at.stores, [{ serialNo: b, chassisNo: ` ${chassis.slice(0, 4)}-${chassis.slice(4).toLowerCase()}` }], 'B2')))
      .toBe('23505');
    expect(await failure(run((ctx) => changeItem(ctx, { id: at.itemId, hasChassis: false })))).toBe('chassis_numbers_recorded');
    const raw = await su.connect();
    try {
      await raw.query('begin');
      await raw.query("select set_config('app.principal', 'system:test', true)");
      await expect(raw.query('update radcore.items set has_chassis = false where id = $1', [at.itemId])).rejects.toMatchObject({ code: 'RA008' });
    } finally {
      await raw.query('rollback');
      raw.release();
    }
    // A unit received before the flag went on leaves only once its number is recorded, with a reason.
    const plain = await setup();
    await receive(plain.itemId, plain.showroom, [{ serialNo: c }]);
    await run((ctx) => changeItem(ctx, { id: plain.itemId, hasChassis: true }));
    const lot = await lotId(plain.itemId, 'B1');
    const deliver = () => post({ outs: [{ itemId: plain.itemId, locationId: plain.showroom, sourceLineId: randomUUID(), qty: q('1'),
      batches: [{ batchId: lot, qty: q('1') }], units: [{ serialNo: c }] }] });
    expect(await failure(deliver(), 'leaves with one')).toBe('RA008');
    const record: UnitChange = { kind: 'chassis_recorded', itemId: plain.itemId, serialNo: c, chassisNo: `MA2${tag()}${tag()}` };
    expect(await failure(change([record]))).toBe('23514');
    await change([record], 'Missed at goods receipt');
    expect(await deliver().then(() => 'ok')).toBe('ok');
  });

  // §5 (RC-026): events are append-only, and the runtime login writes no unit; an item with stock keeps its serials.
  it('keeps unit events append-only and units closed to the app, and an item with stock serialised', async () => {
    const at = await setup();
    const [unit = ''] = serials(1);
    await receive(at.itemId, at.stores, [{ serialNo: unit }]);
    const { rows: [e] } = await su.query<{ id: string }>('select e.id from radcore.unit_events e join radcore.units u on u.id = e.unit_id where u.item_id = $1', [at.itemId]);
    for (const statement of ["update radcore.unit_events set kind = 'scrapped' where id = $1", 'delete from radcore.unit_events where id = $1']) {
      await expect(su.query(statement, [e?.id])).rejects.toMatchObject({ code: 'RA001' });
    }
    await expect(pool.query("update radcore.units set condition = 'used' where item_id = $1", [at.itemId])).rejects.toMatchObject({ code: '42501' });
    // UPDATE (id) is granted only so the engine can lock units; a new id breaks the events' key.
    const app = await pool.connect();
    try {
      await app.query('begin');
      await app.query("select set_config('app.principal', 'system:test', true)");
      await expect(app.query('update radcore.units set id = gen_random_uuid() where item_id = $1', [at.itemId]))
        .rejects.toMatchObject({ code: '23503' });
    } finally {
      await app.query('rollback');
      app.release();
    }
    await expect(pool.query("insert into radcore.units (item_id, serial_no, ownership, condition, location_id) values ($1, 'X', 'ours', 'new', $2)",
      [at.itemId, at.stores])).rejects.toMatchObject({ code: '42501' });
    expect(await failure(run((ctx) => changeItem(ctx, { id: at.itemId, serialised: false })))).toBe('item_has_stock');
  });
});
