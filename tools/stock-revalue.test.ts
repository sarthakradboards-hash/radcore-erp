// RAD-138 (M4-03; ADR-006 §4, §7) on a real PostgreSQL, as the runtime login: a caller's revaluations on the stock engine
// and where an item is on hand to take one. A revalue changes a position's value and leaves its quantity; one where the
// position holds nothing, or that would take its value below 0, is refused `nothing_to_revalue` (value 0 at quantity 0).
// The caller posts the journal lines for its revalues, so the engine writes no revaluation entry for them; its own, for
// goods into negative stock (F15), is stock-negative.test.ts's. sellableOnHand answers only sellable places holding
// more than nothing. Each test makes its own item and places.
import { randomBytes, randomUUID } from 'node:crypto';
import { openFinancialYear, postEntry } from '@radcore/lib-accounts';
import { moneyString, quantityString, unitPriceString } from '@radcore/lib-common';
import { AppError, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import { addCategory, addItem, addPlace, postStock, sellableOnHand } from '@radcore/lib-stock';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { postDocument, SOURCE_TABLE } from './stock-posting.ts';

const url = process.env['TEST_DATABASE_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
// A fixed past day, so no test reads the run date (RC-156).
const DATE = '2026-11-15';
const AS: Principal = { kind: 'user', userId: randomUUID(), permissions: ['items:write', 'locations:write', 'cost:read'] };
const tag = () => randomBytes(3).toString('hex').toUpperCase();
const q = (s: string) => quantityString().parse(s);
const m = (s: string) => moneyString({ signed: true }).parse(s);

describe.skipIf(!url)('revaluations and sellable stock', () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
  });
  const run = <T>(fn: (ctx: Ctx) => Promise<T>) => runInTransaction(db, WRITE, AS, randomUUID(), fn);
  const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof AppError ? e.code : String(e)));

  // An item and one place of each kind asked for, with `stock` units in at 100.00 at each place named.
  async function setup(stock: Readonly<Record<string, string>>) {
    return run(async (ctx) => {
      await openFinancialYear(ctx, DATE);
      const { id: categoryId } = await addCategory(ctx, { name: `Test ${tag()}` });
      const { id: itemId } = await addItem(ctx, { sku: `R-${tag()}`, name: 'Charger', categoryId, hsn: '85044030', unit: 'NOS', barcode: null,
        serialised: false, hasChassis: false, purchasePrice: unitPriceString().parse('100') });
      const places: Record<string, string> = {};
      for (const kind of Object.keys(stock)) {
        places[kind] = (await addPlace(ctx, { code: `${kind.slice(0, 3).toUpperCase()}${tag()}`, name: `${kind} ${tag()}`,
          kind: kind as 'stores' })).id;
      }
      const ins = Object.entries(stock).filter(([, qty]) => qty !== '0').map(([kind, qty]) => ({ itemId, locationId: places[kind] ?? '', qty: q(qty),
        rate: unitPriceString().parse('100'), batches: [{ batchNo: 'B1', qty: q(qty) }] }));
      await postDocument(ctx, { sourceTable: SOURCE_TABLE, sourceId: randomUUID(), businessDate: DATE, ins });
      return { itemId, places };
    });
  }
  // A revalue posted with the caller's own entry (Stock in Hand against Opening Balance Equity), as a bill posts its own.
  const revalue = (itemId: string, locationId: string, value: string) => run(async (ctx) => {
    const sourceId = randomUUID();
    const moved = await postStock(ctx, { sourceTable: SOURCE_TABLE, sourceId, businessDate: DATE, revalues: [{ itemId, locationId, value: m(value) }] });
    const up = !value.startsWith('-');
    const amount = moneyString().parse(value.replace('-', ''));
    const stock = { account: { system: 'stock' }, itemId, locationId };
    await postEntry(ctx, { kind: 'opening', businessDate: DATE, source: { table: SOURCE_TABLE, id: sourceId }, lines: up
      ? [{ ...stock, debit: amount }, { account: { system: 'opening_equity' }, credit: amount }]
      : [{ account: { system: 'opening_equity' }, debit: amount }, { ...stock, credit: amount }] });
    return { sourceId, moved };
  });
  const positionOf = async (itemId: string, locationId: string) => (await pool.query<{ qty: string; value: string }>(`select
    coalesce(sum(case direction when 'in' then qty when 'out' then -qty else 0 end), 0)::numeric(18, 0)::text as qty,
    coalesce(sum(case direction when 'out' then -value else value end), 0)::numeric(18, 2)::text as value
    from radcore.stock_movements where item_id = $1 and location_id = $2`, [itemId, locationId])).rows[0];

  it('moves a position’s value up and down and leaves its quantity, with no revaluation entry of the engine’s', async () => {
    const at = await setup({ stores: '2' });
    const stores = at.places['stores'] ?? '';
    const up = await revalue(at.itemId, stores, '150.00');
    expect(up.moved.map((x) => [x.direction, x.qty, x.value])).toEqual([['revalue', '0', '150.00']]);
    expect(await positionOf(at.itemId, stores)).toEqual({ qty: '2', value: '350.00' });
    const down = await revalue(at.itemId, stores, '-50.00');
    expect(await positionOf(at.itemId, stores)).toEqual({ qty: '2', value: '300.00' });
    const { rows } = await pool.query<{ n: number }>(`select count(*)::int as n from radcore.journal_entries
      where kind = 'revaluation' and source_id = any($1::uuid[])`, [[up.sourceId, down.sourceId]]);
    expect(rows[0]?.n).toBe(0);
  });

  it('refuses a revalue where nothing is on hand, or one taking the value below 0 (nothing_to_revalue)', async () => {
    const at = await setup({ stores: '1', store: '0' });
    expect(await code(revalue(at.itemId, at.places['store'] ?? '', '10.00'))).toBe('nothing_to_revalue');
    expect(await code(revalue(at.itemId, at.places['stores'] ?? '', '-100.01'))).toBe('nothing_to_revalue');
    expect(await code(revalue(at.itemId, at.places['stores'] ?? '', '-100.00'))).toBe('ok');
  });

  it('answers where an item is on hand at sellable places only, leaving out rejects, demo and places at nothing', async () => {
    const at = await setup({ stores: '2', store: '1', rejected: '1', demo: '1', franchisee: '0' });
    // The store's one goes out again, from its batch, so it holds nothing.
    const batchId = (await pool.query<{ id: string }>('select id from radcore.batches where item_id = $1 limit 1', [at.itemId])).rows[0]?.id ?? null;
    await run((ctx) => postDocument(ctx, { sourceTable: SOURCE_TABLE, sourceId: randomUUID(), businessDate: DATE,
      outs: [{ itemId: at.itemId, locationId: at.places['store'] ?? '', qty: q('1'), batches: [{ batchId, qty: q('1') }] }] }));
    const on = await run((ctx) => sellableOnHand(ctx, [at.itemId]));
    const got = (on.get(at.itemId) ?? []).map((p) => [p.locationId, p.qty]).sort();
    expect(got).toEqual([[at.places['stores'], '2.000']]);
  });
});
