// RAD-95 (M2-07, ADR-006 §7, RC-063) on a real PostgreSQL 16, as the app login: the books check, in one REPEATABLE
// READ snapshot. After real postings the whole database is healthy. A movement written behind the engines' backs (as
// the owner, with the triggers off) is found: its value isn't in the books, and its batches don't add up. As at a
// date before it, the dated comparison leaves it out, while the current position still finds the batches. Each test
// uses an item and places of its own; the broken row is removed before the test ends.
import { randomBytes, randomUUID } from 'node:crypto';
import { quantityString, unitPriceString } from '@radcore/lib-common';
import type { Ctx, Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import { addCategory, addItem, addPlace, checkBooks } from '@radcore/lib-stock';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { postDocument, SOURCE_TABLE } from './stock-posting.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
const SNAPSHOT = { readOnly: true, isolation: 'repeatable read' } as const;
const DAY = '2026-11-16';
const staff: Principal = { kind: 'system', name: 'test', permissions: ['items:write', 'locations:write', 'journal:read'] };
const tag = () => randomBytes(3).toString('hex').toUpperCase();
const q = (s: string) => quantityString().parse(s);

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the books check tests must run, not skip');
});

describe.skipIf(!url || !superUrl)('the books check', { timeout: 30_000 }, () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const su = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
    await su.end();
  });
  const run = <T>(fn: (ctx: Ctx) => Promise<T>) => runInTransaction(db, WRITE, staff, randomUUID(), fn);
  const check = (asAt?: string) => runInTransaction(db, SNAPSHOT, staff, randomUUID(),
    (ctx) => checkBooks(ctx, asAt === undefined ? {} : { asAt }));
  const setup = () => run(async (ctx) => {
    const { id: categoryId } = await addCategory(ctx, { name: `Books ${tag()}` });
    const { id: itemId } = await addItem(ctx, { sku: `B-${tag()}`, name: 'Brake-pad set', categoryId, hsn: '8708', unit: 'NOS',
      barcode: null, serialised: false, hasChassis: false });
    const place = async (kind: 'stores' | 'demo') => (await addPlace(ctx, { code: `L${tag()}`, name: `${kind} ${tag()}`, kind })).id;
    return { itemId, stores: await place('stores'), demo: await place('demo') };
  });

  it('finds the whole database healthy after real postings, in and moved', async () => {
    const { itemId, stores, demo } = await setup();
    await run((ctx) => postDocument(ctx, { sourceTable: SOURCE_TABLE, sourceId: randomUUID(), businessDate: DAY,
      ins: [{ itemId, locationId: stores, qty: q('3'), rate: unitPriceString().parse('250'), batches: [{ batchNo: `H${tag()}`, qty: q('3') }] }] }));
    const [{ batch = '' } = {}] = (await su.query<{ batch: string }>('select id as batch from radcore.batches where item_id = $1', [itemId])).rows;
    await run((ctx) => postDocument(ctx, { sourceTable: SOURCE_TABLE, sourceId: randomUUID(), businessDate: DAY,
      transfers: [{ itemId, from: stores, to: demo, qty: q('1'), batches: [{ batchId: batch, qty: q('1') }] }] }));
    expect(await check()).toEqual({ problems: [] });
    expect(await check(DAY)).toEqual({ problems: [] });
  });

  it('finds a movement written behind the engines’ backs, and as at an earlier date only what is current', async () => {
    const { itemId, demo } = await setup();
    const c = await su.connect();
    const later = '2026-12-01';
    const bad = randomUUID();
    try {
      await c.query('begin');
      await c.query("set local app.principal = 'system:test'");
      await c.query('set local session_replication_role = replica');
      await c.query(`insert into radcore.stock_movements (id, item_id, location_id, source_table, source_id, direction, qty, value, business_date)
        values ($1, $2, $3, 'files', $4, 'in', 1, 50, $5)`, [bad, itemId, demo, randomUUID(), later]);
      await c.query('commit');
      const mine = (r: { problems: { check: string; itemId: string | null; locationId: string | null }[] }) =>
        r.problems.filter((p) => p.itemId === itemId).map((p) => [p.check, p.locationId]);
      expect(mine(await check())).toEqual([['stock_value', demo], ['batches', demo]]);
      expect(mine(await check(DAY))).toEqual([['batches', demo]]);
    } finally {
      await c.query('begin');
      await c.query('set local session_replication_role = replica');
      await c.query('delete from radcore.stock_movements where id = $1', [bad]);
      await c.query('commit');
      c.release();
    }
    expect(await check()).toEqual({ problems: [] });
  });
});
