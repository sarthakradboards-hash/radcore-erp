// RAD-111 (RC-131; ADR-006 §4, the architect's ruling on RAD-111) on a real PostgreSQL, as the runtime login: the average
// cost a sale's below-cost check reads. One item and place's V / Q, or over the sellable places with no place given, so
// demo stock (F13) never moves the cost of what's sold; null with nothing on hand. Each test makes its own item and places.
import { randomBytes, randomUUID } from 'node:crypto';
import { quantityString, unitPriceString } from '@radcore/lib-common';
import type { Ctx, Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import { addCategory, addItem, addPlace, averageCost, type StockPosting } from '@radcore/lib-stock';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { postDocument, SOURCE_TABLE } from './stock-posting.ts';

const url = process.env['TEST_DATABASE_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
const DATE = '2026-11-15';
const staff: Principal = { kind: 'user', userId: '00000000-0000-4000-8000-000000000111',
  permissions: ['items:write', 'locations:write'] };
const q = (s: string) => quantityString().parse(s);
const r = (s: string) => unitPriceString().parse(s);
const tag = () => randomBytes(3).toString('hex').toUpperCase();

describe.skipIf(!url)('the average cost', () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const db = createDatabase(pool);
  afterAll(async () => { await pool.end(); });
  const run = <T>(fn: (ctx: Ctx) => Promise<T>) => runInTransaction(db, WRITE, staff, randomUUID(), fn);
  const post = (p: Omit<StockPosting, 'sourceTable' | 'sourceId' | 'businessDate'>) =>
    run((ctx) => postDocument(ctx, { sourceTable: SOURCE_TABLE, sourceId: randomUUID(), businessDate: DATE, ...p }));
  const cost = (itemId: string, locationId: string | null) => run((ctx) => averageCost(ctx, itemId, locationId));
  async function setup() {
    return run(async (ctx) => {
      const { id: categoryId } = await addCategory(ctx, { name: `Test ${tag()}` });
      const { id: itemId } = await addItem(ctx, { sku: `C-${tag()}`, name: 'Brake-pad set', categoryId, hsn: '8708', unit: 'NOS',
        barcode: null, serialised: false, hasChassis: false });
      const place = async (kind: 'stores' | 'store' | 'demo') => (await addPlace(ctx, { code: `L${tag()}`, name: `${kind} ${tag()}`, kind })).id;
      return { itemId, stores: await place('stores'), showroom: await place('store'), demo: await place('demo'), empty: await place('store') };
    });
  }
  const lot = (qty: string) => [{ batchNo: 'C1', qty: q(qty) }];

  it("is a place's V / Q, and over the sellable places leaves demo stock out (F13)", async () => {
    const at = await setup();
    await post({ ins: [{ itemId: at.itemId, locationId: at.stores, qty: q('4'), rate: r('61250'), batches: lot('4') }] });
    await post({ ins: [{ itemId: at.itemId, locationId: at.demo, qty: q('1'), rate: r('90000'), batches: lot('1') },
      { itemId: at.itemId, locationId: at.showroom, qty: q('2'), rate: r('64000'), batches: lot('2') }] });
    expect(await cost(at.itemId, at.stores)).toBe('61250.000000');
    expect(await cost(at.itemId, at.demo)).toBe('90000.000000');
    // Stores 4 at 245,000.00 and Showroom 2 at 128,000.00: 373,000.00 / 6; Demo's 90,000.00 isn't in it.
    expect(await cost(at.itemId, null)).toBe('62166.666667');
  });

  it('is null at a place with nothing on hand, and with no stock anywhere', async () => {
    const at = await setup();
    expect(await cost(at.itemId, null)).toBeNull();
    expect(await cost(at.itemId, at.empty)).toBeNull();
    await post({ ins: [{ itemId: at.itemId, locationId: at.demo, qty: q('1'), rate: r('100'), batches: lot('1') }] });
    expect(await cost(at.itemId, null)).toBeNull();
  });
});
