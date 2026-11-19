// RAD-93 (M2-05, ADR-006 §1, §4, §4a; RC-025, RC-053, RC-205) on a real PostgreSQL, as the runtime login: the stock
// engine with ADR-006's hand-worked figures. One average per item and location, so demo stock stays out of the
// sellable average (F13); an issue at the location's average, all of it when it empties the place (F14); batches
// named on every in and out (F21); an append-only ledger; and the lock order, proved by two saves touching the same
// positions in opposite order, and two bringing the same new lots into different locations, all of which finish.
// Each test makes its own items and locations, so the shuffled order doesn't matter.
import { randomBytes, randomUUID } from 'node:crypto';
import { AppError, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import { moneyString, quantityString, unitPriceString } from '@radcore/lib-common';
import { openFinancialYear, postEntry } from '@radcore/lib-accounts';
import { addCategory, addItem, addPlace, postStock, type StockPosting } from '@radcore/lib-stock';
import pg from 'pg';
import { postDocument, SOURCE_TABLE } from './stock-posting.ts';
import { afterAll, describe, expect, it } from 'vitest';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
const DATE = '2026-11-15';
const staff: Principal = { kind: 'user', userId: '00000000-0000-4000-8000-000000000095',
  permissions: ['items:write', 'locations:write'] };
// The engine takes branded quantities and rates (ADR-006 §1 Types), as a contract's schema hands them over.
const q = (s: string) => quantityString().parse(s);
const r = (s: string) => unitPriceString().parse(s);
const m = (s: string) => moneyString().parse(s);
const tag = () => randomBytes(3).toString('hex').toUpperCase();

describe.skipIf(!url || !superUrl)('the stock engine', () => {
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  const su = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
    await su.end();
  });
  const run = <T>(fn: (ctx: Ctx) => Promise<T>) => runInTransaction(db, WRITE, staff, randomUUID(), fn);
  const post = (p: Omit<StockPosting, 'sourceTable' | 'sourceId' | 'businessDate'>) =>
    run((ctx) => postDocument(ctx, { sourceTable: SOURCE_TABLE, sourceId: randomUUID(), businessDate: DATE, ...p }));
  const failure = (p: Parameters<typeof post>[0]) => post(p).then(() => 'ok',
    (e: unknown) => (e instanceof AppError ? e.code : String((e as { cause?: { code?: string } }).cause?.code ?? e)));

  // An item and the locations named, each of its own.
  async function setup(kinds: readonly ('store' | 'stores' | 'demo')[]) {
    return run(async (ctx) => {
      const { id: categoryId } = await addCategory(ctx, { name: `Test ${tag()}` });
      const { id: itemId } = await addItem(ctx, { sku: `T-${tag()}`, name: 'Brake-pad set', categoryId, hsn: '8708', unit: 'NOS',
        barcode: null, serialised: false, hasChassis: false });
      const places: string[] = [];
      for (const kind of kinds) places.push((await addPlace(ctx, { code: `L${tag()}`, name: `${kind} ${tag()}`, kind })).id);
      return { itemId, places };
    });
  }
  // An item's quantity and value at a location, read as the superuser from the ledger itself.
  const onHand = async (itemId: string, locationId: string) => {
    const { rows } = await su.query<{ qty: string; value: string }>(`select
      coalesce(sum(case direction when 'in' then qty when 'out' then -qty else 0 end), 0)::text as qty,
      coalesce(sum(case direction when 'out' then -value else value end), 0)::text as value
      from radcore.stock_movements where item_id = $1 and location_id = $2`, [itemId, locationId]);
    return [Number(rows[0]?.qty).toFixed(0), Number(rows[0]?.value).toFixed(2)];
  };
  const lot = (batchNo: string, qty: string) => ({ batchNo, qty: q(qty) });

  // F13: a transfer takes the source's average; demo stock keeps its own (RC-205).
  it('moves a unit to Demo at the Stores average, and a later receipt into Stores leaves the demo unit at its cost', async () => {
    const { itemId, places: [stores = '', demo = ''] } = await setup(['stores', 'demo']);
    await post({ ins: [{ itemId, locationId: stores, qty: q('4'), rate: r('61250'), batches: [lot('S1', '4')] }] });
    const [{ batch } = { batch: '' }] = (await su.query<{ batch: string }>('select id as batch from radcore.batches where item_id = $1', [itemId])).rows;
    const moved = await post({ transfers: [{ itemId, from: stores, to: demo, qty: q('1'), batches: [{ batchId: batch, qty: q('1') }] }] });
    expect(moved.map((m) => [m.direction, m.value])).toEqual([['out', '61250.00'], ['in', '61250.00']]);
    expect([await onHand(itemId, stores), await onHand(itemId, demo)]).toEqual([['3', '183750.00'], ['1', '61250.00']]);
    await post({ ins: [{ itemId, locationId: stores, qty: q('1'), rate: r('63000'), batches: [lot('S2', '1')] }] });
    // Stores' average is now (183,750.00 + 63,000.00) / 4 = 61,687.50: an issue of one takes exactly that.
    const [issued] = await post({ outs: [{ itemId, locationId: stores, qty: q('1'), batches: [{ batchId: batch, qty: q('1') }] }] });
    expect(issued?.value).toBe('61687.50');
    expect(await onHand(itemId, demo)).toEqual(['1', '61250.00']);
  });

  // F14, and an issue that empties a location takes all of its value.
  it('issues at the average, and takes the exact remainder when a location is emptied', async () => {
    const { itemId, places: [shop = ''] } = await setup(['store']);
    await post({ ins: [{ itemId, locationId: shop, qty: q('7'), rate: r('200'), batches: [lot('P1', '7')] }] });
    const [{ batch } = { batch: '' }] = (await su.query<{ batch: string }>('select id as batch from radcore.batches where item_id = $1', [itemId])).rows;
    const [short] = await post({ outs: [{ itemId, locationId: shop, qty: q('1'), batches: [{ batchId: batch, qty: q('1') }] }] });
    expect([short?.value, await onHand(itemId, shop)]).toEqual(['200.00', ['6', '1200.00']]);
    await post({ ins: [{ itemId, locationId: shop, qty: q('3'), rate: r('233.33'), batches: [lot('P1', '3')] }] });
    const [all] = await post({ outs: [{ itemId, locationId: shop, qty: q('9'), batches: [{ batchId: batch, qty: q('9') }] }] });
    expect([all?.value, await onHand(itemId, shop)]).toEqual(['1899.99', ['0', '0.00']]);
  });

  // F21: a receipt split across two lots, then a delivery of 7 across both at 2,200.00 / 11; "L-2" and "l 2" are one batch.
  it('records each line by batch, one batch per item and number however it is written', async () => {
    const { itemId, places: [stores = ''] } = await setup(['stores']);
    await post({ ins: [{ itemId, locationId: stores, qty: q('10'), rate: r('200'), batches: [lot('L1', '6'), lot('L-2', '4')] }] });
    await post({ ins: [{ itemId, locationId: stores, qty: q('1'), rate: r('200'), batches: [lot('l 2', '1')] }] });
    const { rows: lots } = await su.query<{ id: string; key: string }>(
      'select id, batch_key as key from radcore.batches where item_id = $1 order by batch_key', [itemId]);
    expect(lots.map((l) => l.key)).toEqual(['L1', 'L2']);
    const [l1 = '', l2 = ''] = lots.map((l) => l.id);
    const [out] = await post({ outs: [{ itemId, locationId: stores, qty: q('7'), batches: [{ batchId: l1, qty: q('6') }, { batchId: l2, qty: q('1') }] }] });
    expect(out?.value).toBe('1400.00');
    const { rows } = await su.query<{ batch: string; qty: string }>(
      'select batch_id as batch, qty::text from radcore.stock_movement_batches where movement_id = $1 order by qty desc', [out?.id]);
    expect(rows.map((r) => [r.batch, Number(r.qty)])).toEqual([[l1, 6], [l2, 1]]);
  });

  it("refuses a line whose batches don't add up, an issue beyond what's on hand, a quantity of zero and a transfer to itself", async () => {
    const { itemId, places: [stores = ''] } = await setup(['stores']);
    expect(await failure({ ins: [{ itemId, locationId: stores, qty: q('5'), rate: r('10'), batches: [lot('X', '4')] }] })).toBe('batches_mismatch');
    await post({ ins: [{ itemId, locationId: stores, qty: q('2'), rate: r('10'), batches: [lot('X', '2')] }] });
    expect(await failure({ outs: [{ itemId, locationId: stores, qty: q('3'), batches: [{ batchId: null, qty: q('3') }] }] })).toBe('not_enough_stock');
    expect(await failure({ outs: [{ itemId, locationId: stores, qty: q('0'), batches: [] }] })).toBe('qty_not_positive');
    expect(await failure({ ins: [{ itemId, locationId: stores, qty: q('1'), rate: r('10'), batches: [lot('X', '1'), lot('Y', '0')] }] }))
      .toBe('qty_not_positive');
    expect(await failure({ transfers: [{ itemId, from: stores, to: stores, qty: q('1'), batches: [{ batchId: null, qty: q('1') }] }] }))
      .toBe('transfer_same_location');
  });

  // RAD-90 (#180): a batch's supplier is a party, or none; an id that's no party is refused. Rolled back, so the shared
  // database keeps no test party.
  it("keeps a batch's supplier to a party", async () => {
    const { itemId } = await setup([]);
    const c = await su.connect();
    try {
      await c.query('begin');
      await c.query("select set_config('app.principal', 'system:test', true)");
      const { rows: [party] } = await c.query<{ id: string }>(
        "insert into radcore.parties (name, supplier, state_code) values ('Pads and Co', true, '27') returning id");
      const batch = (supplier: string | undefined, no: string) =>
        c.query('insert into radcore.batches (item_id, supplier_id, batch_no) values ($1, $2, $3)', [itemId, supplier, no]);
      await batch(party?.id, 'S1');
      await expect(batch(randomUUID(), 'S2')).rejects.toMatchObject({ code: '23503' });
    } finally {
      await c.query('rollback');
      c.release();
    }
  });

  // ADR-005 §6 and ADR-006 §4: a movement needs its year opened (RC-111), and none posts on or before the period lock
  // (RA003), checked by the movements' own trigger, since a movement of value 0 has no journal line. Written raw, in a
  // rolled-back transaction, so the shared period lock is moved only there.
  it('refuses a movement in a year not opened, or on or before the period lock', async () => {
    const { itemId, places: [stores = ''] } = await setup(['stores']);
    const c = await su.connect();
    const movement = (date: string) => c.query(`insert into radcore.stock_movements (item_id, location_id, source_table, source_id,
      direction, qty, value, rate, business_date) values ($1, $2, 'files', $3, 'in', 1, 0, 0, $4)`, [itemId, stores, randomUUID(), date]);
    try {
      await c.query('begin');
      await c.query("select set_config('app.principal', 'system:test', true)");
      await c.query("insert into radcore.financial_years (start) values ('2026-04-01') on conflict do nothing");
      await c.query('savepoint s');
      await expect(movement('2041-05-01')).rejects.toMatchObject({ code: '23503', constraint: 'fk_stock_movements_fy_start' });
      await c.query('rollback to savepoint s');
      await c.query("update radcore.period_lock set locked_through = '2026-11-15' where id = 1");
      await expect(movement(DATE)).rejects.toMatchObject({ code: 'RA003' });
      await c.query('rollback to savepoint s');
      await c.query("update radcore.period_lock set locked_through = '2026-11-14' where id = 1");
      await movement(DATE);
    } finally {
      await c.query('rollback');
      c.release();
    }
  });

  // §4, checked at commit (RA007): a document's stock and books agree per item and location. Its movements with no
  // entry are refused, and so is a Stock in Hand line with no movement; postDocument's documents, matched, all pass.
  it("refuses at commit a document whose stock and books don't agree, either way", async () => {
    const { itemId, places: [stores = ''] } = await setup(['stores']);
    const atCommit = (fn: (ctx: Ctx) => Promise<unknown>) => run(async (ctx) => {
      await openFinancialYear(ctx, DATE);
      await fn(ctx);
    }).then(() => 'ok', (e: unknown) => {
      const err = (e as { cause?: { code?: string; message?: string } }).cause ?? (e as { code?: string; message?: string });
      return `${err.code ?? ''} ${/books show/.test(err.message ?? '') ? 'books' : String(err.message)}`;
    });
    const source = { table: SOURCE_TABLE, id: randomUUID() };
    expect(await atCommit((ctx) => postStock(ctx, { sourceTable: source.table, sourceId: source.id, businessDate: DATE,
      ins: [{ itemId, locationId: stores, qty: q('2'), rate: r('50'), batches: [lot('D', '2')] }] }))).toBe('RA007 books');
    expect(await atCommit((ctx) => postEntry(ctx, { kind: 'opening', businessDate: DATE, source: { table: SOURCE_TABLE, id: randomUUID() },
      lines: [{ account: { system: 'stock' }, itemId, locationId: stores, debit: m('100') }, { account: { system: 'opening_equity' }, credit: m('100') }] })))
      .toBe('RA007 books');
    // The same receipt with its entry, at a value that differs by a paisa, is refused too.
    expect(await atCommit(async (ctx) => {
      const id = randomUUID();
      await postStock(ctx, { sourceTable: SOURCE_TABLE, sourceId: id, businessDate: DATE,
        ins: [{ itemId, locationId: stores, qty: q('2'), rate: r('50'), batches: [lot('D', '2')] }] });
      await postEntry(ctx, { kind: 'opening', businessDate: DATE, source: { table: SOURCE_TABLE, id },
        lines: [{ account: { system: 'stock' }, itemId, locationId: stores, debit: m('100.01') }, { account: { system: 'opening_equity' }, credit: m('100.01') }] });
    })).toBe('RA007 books');
  });

  // ADR-005 §7: a correction is a new row, never an edit; even the owner is refused by the trigger.
  it('keeps the ledger append-only', async () => {
    const { itemId, places: [stores = ''] } = await setup(['stores']);
    const [moved] = await post({ ins: [{ itemId, locationId: stores, qty: q('1'), rate: r('10'), batches: [lot('A', '1')] }] });
    for (const statement of ['update radcore.stock_movements set qty = 2 where id = $1', 'delete from radcore.stock_movements where id = $1']) {
      await expect(su.query(statement, [moved?.id])).rejects.toMatchObject({ code: 'RA001' });
    }
  });

  // §1 (RC-053): two saves touching the same positions in opposite order both finish, again and again.
  it('lets two saves that touch the same positions in opposite order both finish', async () => {
    const { itemId, places: [a = '', b = ''] } = await setup(['stores', 'store']);
    await post({ ins: [{ itemId, locationId: a, qty: q('50'), rate: r('10'), batches: [lot('C', '50')] }, { itemId, locationId: b, qty: q('50'), rate: r('10'), batches: [lot('C', '50')] }] });
    const [{ batch } = { batch: '' }] = (await su.query<{ batch: string }>('select id as batch from radcore.batches where item_id = $1', [itemId])).rows;
    const move = (from: string, to: string) => post({ transfers: [{ itemId, from, to, qty: q('1'), batches: [{ batchId: batch, qty: q('1') }] }] });
    for (let round = 0; round < 10; round += 1) await Promise.all([move(a, b), move(b, a), move(a, b), move(b, a)]);
    expect([(await onHand(itemId, a))[0], (await onHand(itemId, b))[0]]).toEqual(['50', '50']);
  });

  // §4a: new batches are made after the position locks, in key order, so the same two new lots in opposite order,
  // into different locations, never wait on each other in a cycle.
  it('lets two saves bringing the same two new lots in opposite order, into different locations, both finish', async () => {
    const { itemId, places: [x = '', y = ''] } = await setup(['stores', 'store']);
    for (let round = 0; round < 5; round += 1) {
      const [one, two] = [`N${tag()}`, `N${tag()}`];
      await Promise.all([
        post({ ins: [{ itemId, locationId: x, qty: q('2'), rate: r('10'), batches: [lot(one, '1'), lot(two, '1')] }] }),
        post({ ins: [{ itemId, locationId: y, qty: q('2'), rate: r('10'), batches: [lot(two, '1'), lot(one, '1')] }] }),
      ]);
      const { rows } = await su.query('select 1 from radcore.batches where item_id = $1 and batch_key in ($2, $3)', [itemId, one, two]);
      expect(rows).toHaveLength(2);
    }
  });
});
