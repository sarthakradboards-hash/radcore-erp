// The on-hand read (the architect on RAD-112) on a real PostgreSQL: an item's quantity at a place, each batch's (batch
// unknown its own row), and the serialised units free to pick, paged with a prefix search. A unit promised to another
// order line is hidden, and one promised to the form's own line is offered, marked. A sold unit, a damaged one, or one
// at another place never appears. Quantities only; posting still checks it all (RA007, RA008).
import { randomBytes, randomUUID } from 'node:crypto';
import { openFinancialYear } from '@radcore/lib-accounts';
import { quantityString, requestFor, unitPriceString } from '@radcore/lib-common';
import { loadConfig, saveSetting, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import { addCategory, addItem, addPlace, onHand, postUnitEvents, SELL_DAMAGED_UNITS, type StockPosting, type UnitChange } from '@radcore/lib-stock';
import { getOnHand } from '@radcore/lib-stock/contract';
import { testSettings } from '@radcore/test-helpers';
import pg from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createApp, listen } from '../apps/api/src/app.ts';
import stockRoutes from '../apps/api/src/routes/stock.ts';
import { postDocument, SOURCE_TABLE } from './stock-posting.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
const DATE = '2026-11-15';
const staff: Principal = { kind: 'user', userId: randomUUID(), permissions: ['items:write', 'locations:write', 'stock:read'] };
const q = (s: string) => quantityString().parse(s);
const r = (s: string) => unitPriceString().parse(s);
const tag = () => randomBytes(3).toString('hex').toUpperCase();

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the on-hand tests must run, not skip');
});

describe.skipIf(!url || !superUrl)('stock on hand', { timeout: 30_000 }, () => {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  const su = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  const cfg = loadConfig(testSettings(), 'api');
  afterAll(async () => {
    await pool.end();
    await su.end();
  });
  const run = <T>(fn: (ctx: Ctx) => Promise<T>) => runInTransaction(db, WRITE, staff, randomUUID(), fn);
  const post = (p: Omit<StockPosting, 'sourceTable' | 'sourceId' | 'businessDate'>) =>
    run((ctx) => postDocument(ctx, { sourceTable: SOURCE_TABLE, sourceId: randomUUID(), businessDate: DATE, ...p }));
  const change = (changes: UnitChange[]) => run(async (ctx) => {
    await openFinancialYear(ctx, DATE);
    await postUnitEvents(ctx, { sourceTable: SOURCE_TABLE, sourceId: randomUUID(), businessDate: DATE, changes });
  });
  const setup = (o: { serialised: boolean; chassis?: boolean }) => run(async (ctx) => {
    const { id: categoryId } = await addCategory(ctx, { name: `Test ${tag()}` });
    const { id: itemId } = await addItem(ctx, { sku: `S-${tag()}`, name: o.serialised ? 'Electric scooter' : 'Helmet', categoryId, hsn: '8711',
      unit: 'NOS', barcode: null, serialised: o.serialised, hasChassis: o.chassis === true });
    const place = async (kind: 'store' | 'stores') => (await addPlace(ctx, { code: `L${tag()}`, name: `${kind} ${tag()}`, kind })).id;
    return { itemId, showroom: await place('store'), stores: await place('stores') };
  });
  const lotId = async (itemId: string, key: string) =>
    (await su.query<{ id: string }>('select id from radcore.batches where item_id = $1 and batch_key = $2', [itemId, key])).rows[0]?.id ?? '';
  const read = (itemId: string, locationId: string, more: { forDocument?: string; q?: string; after?: string; limit?: number } = {}) =>
    run((ctx) => onHand(ctx, { itemId, locationId, limit: 50, ...more }));

  it('adds the batches up to the position, and has no units for an item with no serials', async () => {
    const at = await setup({ serialised: false });
    await post({ ins: [{ itemId: at.itemId, locationId: at.showroom, qty: q('10'), rate: r('100'), batches: [{ batchNo: 'A-1', qty: q('6') },
      { batchNo: 'B-2', qty: q('4') }] }] });
    const lot = await lotId(at.itemId, 'A1');
    await post({ outs: [{ itemId: at.itemId, locationId: at.showroom, sourceLineId: randomUUID(), qty: q('2'), batches: [{ batchId: lot, qty: q('2') }] }] });
    // Elsewhere: never counted here.
    await post({ ins: [{ itemId: at.itemId, locationId: at.stores, qty: q('3'), rate: r('100'), batches: [{ batchNo: 'C-3', qty: q('3') }] }] });
    const seen = await read(at.itemId, at.showroom);
    expect(seen.position).toBe('8.000');
    expect(seen.batches.map((b) => [b.batchNo, b.qty])).toEqual([['A-1', '4.000'], ['B-2', '4.000']]);
    expect(seen.units).toBeNull();
    // "Batch unknown", which only a negative-stock delivery makes, is rules/on-hand.test.ts's: the company-wide setting
    // that allows one is another file's to switch (stock-negative.test.ts).
  });

  it('offers the units free to pick here: not another line’s, not sold, not damaged, not elsewhere; its own line’s marked', async () => {
    const at = await setup({ serialised: true, chassis: true });
    const [free, mine, theirs, sold, damaged, away] = Array.from({ length: 6 }, () => `S-${tag()}`);
    await post({ ins: [{ itemId: at.itemId, locationId: at.showroom, qty: q('5'), rate: r('60000'), batches: [{ batchNo: 'B1', qty: q('5') }],
      units: [{ serialNo: free ?? '', chassisNo: `MA1${tag()}FREE` }, { serialNo: mine ?? '', chassisNo: `MA1${tag()}MINE` },
        { serialNo: theirs ?? '', chassisNo: `MA1${tag()}THEIR` }, { serialNo: sold ?? '', chassisNo: `MA1${tag()}SOLD` },
        { serialNo: damaged ?? '', chassisNo: `MA1${tag()}DMG`, condition: 'damaged' }] }] });
    await post({ ins: [{ itemId: at.itemId, locationId: at.stores, qty: q('1'), rate: r('60000'), batches: [{ batchNo: 'B1', qty: q('1') }],
      units: [{ serialNo: away ?? '', chassisNo: `MA1${tag()}AWAY` }] }] });
    const [myLine, theirLine] = [randomUUID(), randomUUID()];
    await change([{ kind: 'reserved', itemId: at.itemId, serialNo: mine ?? '', promisedTo: myLine },
      { kind: 'reserved', itemId: at.itemId, serialNo: theirs ?? '', promisedTo: theirLine }]);
    const lot = await lotId(at.itemId, 'B1');
    await post({ outs: [{ itemId: at.itemId, locationId: at.showroom, sourceLineId: randomUUID(), qty: q('1'), batches: [{ batchId: lot, qty: q('1') }],
      units: [{ serialNo: sold ?? '' }] }] });
    const units = async (forDocument?: string) =>
      ((await read(at.itemId, at.showroom, forDocument === undefined ? {} : { forDocument })).units?.items ?? []).map((u) => [u.serialNo, u.heldForThis]);
    expect(await units()).toEqual([[free, false]]);
    expect((await units(`sales_order_lines:${myLine}`)).toSorted()).toEqual([[free, false], [mine, true]].toSorted());
    // The position counts every unit here, promised or damaged; the pick list doesn't.
    expect((await read(at.itemId, at.showroom)).position).toBe('4.000');
    // Each unit says its condition, so a used one is picked knowingly (the architect on RAD-112).
    await change([{ kind: 'condition_changed', itemId: at.itemId, serialNo: free ?? '', condition: 'used' }]);
    expect(((await read(at.itemId, at.showroom)).units?.items ?? []).map((u) => [u.serialNo, u.condition])).toEqual([[free, 'used']]);
    // A delivery naming the damaged unit is refused at posting, whatever the picker showed (unit_damaged).
    const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => String((e as { code?: string }).code ?? e));
    expect(await code(post({ outs: [{ itemId: at.itemId, locationId: at.showroom, sourceLineId: randomUUID(), qty: q('1'),
      batches: [{ batchId: lot, qty: q('1') }], units: [{ serialNo: damaged ?? '' }] }] }))).toBe('unit_damaged');
  });

  // Sarthak on RAD-112: "Setting, default off". On, a damaged unit is offered, marked so, and a delivery may take it. The
  // setting is the company's one and only this file reads it, so it's switched on here and back off after.
  it('offers a damaged unit, marked, and lets a delivery take it, where stock.sell_damaged_units is on', async () => {
    const at = await setup({ serialised: true });
    const unit = `S-${tag()}`;
    await post({ ins: [{ itemId: at.itemId, locationId: at.showroom, qty: q('1'), rate: r('60000'), batches: [{ batchNo: 'B1', qty: q('1') }],
      units: [{ serialNo: unit, condition: 'damaged' }] }] });
    const lot = await lotId(at.itemId, 'B1');
    expect((await read(at.itemId, at.showroom)).units?.items).toEqual([]);
    await run((ctx) => saveSetting(ctx, SELL_DAMAGED_UNITS, true));
    try {
      expect(((await read(at.itemId, at.showroom)).units?.items ?? []).map((u) => [u.serialNo, u.condition])).toEqual([[unit, 'damaged']]);
      await post({ outs: [{ itemId: at.itemId, locationId: at.showroom, sourceLineId: randomUUID(), qty: q('1'), batches: [{ batchId: lot, qty: q('1') }],
        units: [{ serialNo: unit }] }] });
      expect((await read(at.itemId, at.showroom)).position).toBe('0.000');
    } finally {
      await run((ctx) => saveSetting(ctx, SELL_DAMAGED_UNITS, null));
    }
  });

  it('finds a unit by a prefix of its serial or its chassis number, and pages through them', async () => {
    const at = await setup({ serialised: true, chassis: true });
    const stem = tag();
    const serials = ['A', 'B', 'C'].map((x) => `${stem}-${x}`);
    await post({ ins: [{ itemId: at.itemId, locationId: at.showroom, qty: q('3'), rate: r('60000'), batches: [{ batchNo: 'B1', qty: q('3') }],
      units: serials.map((s, i) => ({ serialNo: s, chassisNo: `CH${stem}${String(i)}` })) }] });
    const found = async (o: { q?: string; after?: string; limit?: number }) => (await read(at.itemId, at.showroom, o)).units;
    expect((await found({ q: `${stem.toLowerCase()}-b` }))?.items.map((u) => u.serialNo)).toEqual([serials[1]]);
    expect((await found({ q: `ch${stem}2` }))?.items.map((u) => u.serialNo)).toEqual([serials[2]]);
    expect((await found({ q: '%' }))?.items).toEqual([]);
    const first = await found({ limit: 2 });
    const second = await found({ limit: 2, after: first?.next ?? '' });
    expect([first?.items.map((u) => u.serialNo), second?.items.map((u) => u.serialNo), second?.next]).toEqual([serials.slice(0, 2), [serials[2]], null]);
  });

  it('answers only with stock:read (403 without it)', async () => {
    const at = await setup({ serialised: false });
    const status = async (permissions: string[]) => {
      const principal: Principal = { kind: 'user', userId: randomUUID(), permissions };
      const server = await listen(createApp(cfg, { info: vi.fn(), error: vi.fn() }, { db, authenticate: async () => principal, routes: stockRoutes }),
        0, '127.0.0.1');
      try {
        const sent = requestFor(getOnHand, { itemId: at.itemId, locationId: at.showroom, limit: 10 });
        return (await fetch(`http://127.0.0.1:${server.port}${sent.path}`, { headers: { origin: cfg.publicOrigin, 'sec-fetch-site': 'same-origin' } }))
          .status;
      } finally {
        await server.stop();
      }
    };
    expect([await status(['items:read', 'locations:read']), await status(['stock:read'])]).toEqual([403, 200]);
  });
});
