// RAD-93 (M2-05, ADR-006 §4, §4a; RC-062) on a real PostgreSQL, as the runtime login: negative stock and the commit
// checks (RA007), with ADR-006's hand-worked figures. A delivery in negative-stock mode takes what's there at its value
// and the rest at the last receipt's rate; the receipt that follows revalues, so no value is left without units (F15).
// The database refuses at commit what the engine can't see: a batch taken below zero, "batch unknown" above zero.
// A back-dated issue can't make a later day negative. The setting is the company's one, so each test sets it first.
import { randomBytes, randomUUID } from 'node:crypto';
import { quantityString, unitPriceString } from '@radcore/lib-common';
import { AppError, saveSetting, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import { NEGATIVE_STOCK, addCategory, addItem, addPlace, postStock, type StockPosting } from '@radcore/lib-stock';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
const staff: Principal = { kind: 'user', userId: '00000000-0000-4000-8000-000000000096',
  permissions: ['items:write', 'locations:write'] };
const q = (s: string) => quantityString().parse(s);
const r = (s: string) => unitPriceString().parse(s);
const tag = () => randomBytes(3).toString('hex').toUpperCase();

describe.skipIf(!url || !superUrl)('negative stock and the commit checks', () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const su = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await run((ctx) => saveSetting(ctx, NEGATIVE_STOCK, null));
    await pool.end();
    await su.end();
  });
  const run = <T>(fn: (ctx: Ctx) => Promise<T>) => runInTransaction(db, WRITE, staff, randomUUID(), fn);
  const negative = (on: boolean) => run((ctx) => saveSetting(ctx, NEGATIVE_STOCK, on));
  const post = (p: Omit<StockPosting, 'sourceTable' | 'sourceId' | 'businessDate'>, businessDate = '2026-11-18') =>
    run((ctx) => postStock(ctx, { sourceTable: 'test_documents', sourceId: randomUUID(), businessDate, ...p }));
  const failure = (p: Parameters<typeof post>[0], date?: string) => post(p, date).then(() => 'ok', (e: unknown) => {
    if (e instanceof AppError) return e.code;
    const err = e as { code?: string; cause?: { code?: string } };
    return err.code ?? err.cause?.code ?? String(e);
  });
  async function place() {
    return run(async (ctx) => {
      const { id: categoryId } = await addCategory(ctx, { name: `Test ${tag()}` });
      const { id: itemId } = await addItem(ctx, { sku: `N-${tag()}`, name: 'Brake-pad set', categoryId, hsn: '8708', unit: 'NOS',
        barcode: null, serialised: false, hasChassis: false });
      const { id: locationId } = await addPlace(ctx, { code: `L${tag()}`, name: `Showroom ${tag()}`, kind: 'store' });
      return { itemId, locationId };
    });
  }
  const onHand = async (itemId: string, locationId: string) => {
    const { rows } = await su.query<{ qty: string; value: string }>(`select
      coalesce(sum(case direction when 'in' then qty when 'out' then -qty else 0 end), 0)::text as qty,
      coalesce(sum(case direction when 'out' then -value else value end), 0)::text as value
      from radcore.stock_movements where item_id = $1 and location_id = $2`, [itemId, locationId]);
    return [Number(rows[0]?.qty).toFixed(0), Number(rows[0]?.value).toFixed(2)];
  };
  const batchesOf = async (itemId: string, locationId: string) => (await su.query<{ key: string | null; qty: string }>(
    `select k.batch_key as key, v.qty::text from radcore.v_batch_on_hand v left join radcore.batches k on k.id = v.batch_id
      where v.item_id = $1 and v.location_id = $2 order by k.batch_key nulls last`, [itemId, locationId])).rows
    .map((b) => [b.key ?? 'unknown', Number(b.qty)]);
  const lotId = async (itemId: string, key: string) =>
    (await su.query<{ id: string }>('select id from radcore.batches where item_id = $1 and batch_key = $2', [itemId, key])).rows[0]?.id ?? '';

  // F15: PAD at Showroom, 7 at 1,400.00, last `in` rate 200.00. A sale of 10 leaves −3 at −600.00.
  async function oversold() {
    const { itemId, locationId } = await place();
    await post({ ins: [{ itemId, locationId, qty: q('7'), rate: r('200'), batches: [{ batchNo: 'P1', qty: q('7') }] }] });
    const p1 = await lotId(itemId, 'P1');
    const [sale] = await post({ outs: [{ itemId, locationId, qty: q('10'), delivery: true,
      batches: [{ batchId: p1, qty: q('7') }, { batchId: null, qty: q('3') }] }] });
    expect([sale?.value, await onHand(itemId, locationId)]).toEqual(['2000.00', ['-3', '-600.00']]);
    return { itemId, locationId };
  }
  const receive = (at: { itemId: string; locationId: string }, qty: string) =>
    post({ ins: [{ ...at, qty: q(qty), rate: r('240'), batches: [{ batchNo: 'P2', qty: q(qty) }] }] });

  it('sells beyond what is on hand at the estimate, then revalues on receipt so the units end at what they cost (F15)', async () => {
    await negative(true);
    const at = await oversold();
    const moved = await receive(at, '5');
    expect(moved.map((m) => [m.direction, m.value])).toEqual([['in', '1200.00'], ['revalue', '-120.00']]);
    expect(await onHand(at.itemId, at.locationId)).toEqual(['2', '480.00']);
    expect(await batchesOf(at.itemId, at.locationId)).toEqual([['P1', 0], ['P2', 5], ['unknown', -3]]);
  });

  it('leaves zero value at zero units, and keeps the estimate on units still missing (F15 variants)', async () => {
    await negative(true);
    const exact = await oversold();
    expect((await receive(exact, '3')).map((m) => m.value)).toEqual(['720.00', '-120.00']);
    expect(await onHand(exact.itemId, exact.locationId)).toEqual(['0', '0.00']);
    const part = await oversold();
    expect((await receive(part, '2')).map((m) => m.value)).toEqual(['480.00', '-80.00']);
    expect(await onHand(part.itemId, part.locationId)).toEqual(['-1', '-200.00']);
  });

  it('lets only a delivery go below zero, and only with negative stock allowed and a rate to estimate from', async () => {
    await negative(true);
    const { itemId, locationId } = await place();
    expect(await failure({ outs: [{ itemId, locationId, qty: q('1'), delivery: true, batches: [{ batchId: null, qty: q('1') }] }] }))
      .toBe('no_estimate');
    await post({ ins: [{ itemId, locationId, qty: q('2'), rate: r('50'), batches: [{ batchNo: 'A', qty: q('2') }] }] });
    expect(await failure({ outs: [{ itemId, locationId, qty: q('3'), batches: [{ batchId: null, qty: q('3') }] }] })).toBe('not_enough_stock');
    await negative(false);
    expect(await failure({ outs: [{ itemId, locationId, qty: q('3'), delivery: true, batches: [{ batchId: null, qty: q('3') }] }] }))
      .toBe('not_enough_stock');
  });

  // F21's variants: the database refuses what the location's total would allow.
  it('refuses at commit a pick beyond its batch, and an in to "batch unknown" at zero (RA007)', async () => {
    await negative(false);
    const { itemId, locationId } = await place();
    await post({ ins: [{ itemId, locationId, qty: q('10'), rate: r('200'), batches: [{ batchNo: 'L1', qty: q('6') }, { batchNo: 'L2', qty: q('4') }] }] });
    const l1 = await lotId(itemId, 'L1');
    expect(await failure({ outs: [{ itemId, locationId, qty: q('7'), batches: [{ batchId: l1, qty: q('7') }] }] })).toBe('RA007');
    expect(await failure({ ins: [{ itemId, locationId, qty: q('1'), rate: r('200'), batches: [{ batchNo: null, qty: q('1') }] }] })).toBe('RA007');
    await post({ outs: [{ itemId, locationId, qty: q('7'), batches: [{ batchId: l1, qty: q('6') }, { batchId: await lotId(itemId, 'L2'), qty: q('1') }] }] });
    expect(await batchesOf(itemId, locationId)).toEqual([['L1', 0], ['L2', 3]]);
  });

  it('shows the batch still to arrive as "batch unknown", below zero, after an over-delivery (F21)', async () => {
    await negative(true);
    const { itemId, locationId } = await place();
    await post({ ins: [{ itemId, locationId, qty: q('10'), rate: r('200'), batches: [{ batchNo: 'L1', qty: q('6') }, { batchNo: 'L2', qty: q('4') }] }] });
    await post({ outs: [{ itemId, locationId, qty: q('12'), delivery: true, batches: [{ batchId: await lotId(itemId, 'L1'), qty: q('6') },
      { batchId: await lotId(itemId, 'L2'), qty: q('4') }, { batchId: null, qty: q('2') }] }] });
    expect(await batchesOf(itemId, locationId)).toEqual([['L1', 0], ['L2', 0], ['unknown', -2]]);
  });

  // §4: an issue dated D needs the lowest running quantity from D onward to cover it.
  it('refuses a back-dated issue that would make a later day negative', async () => {
    await negative(false);
    const { itemId, locationId } = await place();
    await post({ ins: [{ itemId, locationId, qty: q('5'), rate: r('100'), batches: [{ batchNo: 'B', qty: q('5') }] }] }, '2026-11-10');
    const b = await lotId(itemId, 'B');
    await post({ outs: [{ itemId, locationId, qty: q('4'), batches: [{ batchId: b, qty: q('4') }] }] }, '2026-11-12');
    expect(await failure({ outs: [{ itemId, locationId, qty: q('2'), batches: [{ batchId: b, qty: q('2') }] }] }, '2026-11-11'))
      .toBe('not_enough_stock');
    expect(await failure({ outs: [{ itemId, locationId, qty: q('1'), batches: [{ batchId: b, qty: q('1') }] }] }, '2026-11-11')).toBe('ok');
  });

  it('lets a back-dated delivery go below zero in negative-stock mode, where a later day needs no cover', async () => {
    await negative(true);
    const { itemId, locationId } = await place();
    await post({ ins: [{ itemId, locationId, qty: q('5'), rate: r('100'), batches: [{ batchNo: 'B', qty: q('5') }] }] }, '2026-11-10');
    const b = await lotId(itemId, 'B');
    await post({ outs: [{ itemId, locationId, qty: q('4'), batches: [{ batchId: b, qty: q('4') }] }] }, '2026-11-12');
    expect(await failure({ outs: [{ itemId, locationId, qty: q('1'), delivery: true, batches: [{ batchId: b, qty: q('1') }] }] }, '2026-11-11'))
      .toBe('ok');
  });

  // The estimate is the last `in`'s cost, and a transfer in has a value but no rate.
  it('estimates from a transfer in when a location was stocked only by transfers', async () => {
    await negative(true);
    const { itemId, locationId: store } = await place();
    const { id: shop } = await run((ctx) => addPlace(ctx, { code: `L${tag()}`, name: `Shop ${tag()}`, kind: 'store' }));
    await post({ ins: [{ itemId, locationId: store, qty: q('2'), rate: r('50'), batches: [{ batchNo: 'T', qty: q('2') }] }] });
    const t = await lotId(itemId, 'T');
    await post({ transfers: [{ itemId, from: store, to: shop, qty: q('2'), batches: [{ batchId: t, qty: q('2') }] }] });
    const [sale] = await post({ outs: [{ itemId, locationId: shop, qty: q('3'), delivery: true,
      batches: [{ batchId: t, qty: q('2') }, { batchId: null, qty: q('1') }] }] });
    expect(sale?.value).toBe('150.00');
  });

  // The database holds the back-dated rule too, whatever path writes: here a raw insert the engine would refuse.
  it('refuses at commit a back-dated out that leaves a later day below zero, though the total stays above (RA007)', async () => {
    await negative(false);
    const { itemId, locationId } = await place();
    await post({ ins: [{ itemId, locationId, qty: q('5'), rate: r('100'), batches: [{ batchNo: 'B', qty: q('5') }] }] }, '2026-11-10');
    const b = await lotId(itemId, 'B');
    await post({ outs: [{ itemId, locationId, qty: q('4'), batches: [{ batchId: b, qty: q('4') }] }] }, '2026-11-12');
    await post({ ins: [{ itemId, locationId, qty: q('10'), rate: r('100'), batches: [{ batchNo: 'B', qty: q('10') }] }] }, '2026-11-13');
    const c = await su.connect();
    try {
      await c.query('begin');
      await c.query("set local app.principal = 'system:test'");
      const { rows: [moved] } = await c.query<{ id: string }>(`insert into radcore.stock_movements
        (item_id, location_id, source_table, source_id, direction, qty, value, business_date)
        values ($1, $2, 'test_documents', $3, 'out', 2, 200, '2026-11-11') returning id`, [itemId, locationId, randomUUID()]);
      await c.query('insert into radcore.stock_movement_batches (movement_id, item_id, batch_id, qty) values ($1, $2, $3, 2)',
        [moved?.id, itemId, b]);
      await expect(c.query('commit')).rejects.toMatchObject({ code: 'RA007' });
    } finally {
      await c.query('rollback').catch(() => undefined);
      c.release();
    }
  });
});
