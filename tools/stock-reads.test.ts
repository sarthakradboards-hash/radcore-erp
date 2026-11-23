// RAD-144's stock reads on a real PostgreSQL, over real HTTP through the generic handler, as the stock screens call
// them: what's on hand, item by place, its value masked without cost:read; and the units, by serial, with a unit's
// trail. Each test makes its own items and places, named by a tag, so the shuffled order and other files don't matter.
import { randomBytes, randomUUID } from 'node:crypto';
import { quantityString, unitPriceString } from '@radcore/lib-common';
import { loadConfig, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import { addCategory, addItem, addPlace } from '@radcore/lib-stock';
import { testSettings } from '@radcore/test-helpers';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp, listen } from '../apps/api/src/app.ts';
import stockRoutes from '../apps/api/src/routes/stock.ts';
import { postDocument, SOURCE_TABLE } from './stock-posting.ts';

const url = process.env['TEST_DATABASE_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
const DATE = '2026-11-15';
const staff: Principal = { kind: 'user', userId: randomUUID(), permissions: ['stock:read', 'cost:read', 'items:write', 'locations:write'] };
const operations: Principal = { kind: 'user', userId: randomUUID(), permissions: ['stock:read'] };
const q = (s: string) => quantityString().parse(s);
const r = (s: string) => unitPriceString().parse(s);
const tag = () => randomBytes(3).toString('hex').toUpperCase();

type Page<T> = { items: T[]; next: string | null };
type Position = { sku: string; locationName: string; qty: string; value: unknown; batches: { batchNo: string | null; qty: string }[] };
type Unit = { id: string; serialNo: string; locationName: string | null; ownership: string; condition: string; promised: boolean };

describe.skipIf(!url)('the stock reads', () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const db = createDatabase(pool);
  afterAll(async () => { await pool.end(); });
  const run = <T>(fn: (ctx: Ctx) => Promise<T>) => runInTransaction(db, WRITE, staff, randomUUID(), fn);

  /** GET `path` with `input` as `who`, through the handler: its status and body. */
  async function get<T>(who: Principal, path: string, input: unknown): Promise<{ status: number; body: T }> {
    const config = loadConfig(testSettings(), 'api');
    const app = createApp(config, { info: () => undefined, error: () => undefined }, { db, authenticate: async () => who, routes: stockRoutes });
    const server = await listen(app, 0, '127.0.0.1');
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}${path}?input=${encodeURIComponent(JSON.stringify(input))}`,
        // As the screens' browser sends it: only a same-origin request sees a cost unmasked (ADR-005 §7c).
        { headers: { origin: config.publicOrigin, 'sec-fetch-site': 'same-origin' } });
      return { status: res.status, body: await res.json() as T };
    } finally {
      await server.stop();
    }
  }

  /** PAD (two batches, 5 at 600.00 in all), BIKE (serialised, 2 units at 1,000.00) and ZERO (1) into place A; 1 PAD, 1 BIKE
   * and the ZERO moved to B, so A holds no ZERO. */
  async function setup() {
    const t = tag();
    const made = await run(async (ctx) => {
      const { id: categoryId } = await addCategory(ctx, { name: `Test ${t}` });
      const item = async (sku: string, serialised: boolean) => (await addItem(ctx, { sku: `${sku}-${t}`, name: `${sku} ${t}`, categoryId, hsn: '8714',
        unit: 'NOS', barcode: null, serialised, hasChassis: false })).id;
      const [pad, bike, zero] = [await item('PAD', false), await item('BIKE', true), await item('ZERO', false)];
      const place = async (code: string) => (await addPlace(ctx, { code: `${code}${t}`, name: `Place ${code}${t}`, kind: 'stores', partyId: null })).id;
      const [a, b] = [await place('A'), await place('B')];
      const serials = [`SA-${t}`, `SB-${t}`];
      await postDocument(ctx, { sourceTable: SOURCE_TABLE, sourceId: randomUUID(), businessDate: DATE, ins: [
        { itemId: pad, locationId: a, qty: q('3'), rate: r('100'), batches: [{ batchNo: 'P1', qty: q('3') }] },
        { itemId: pad, locationId: a, qty: q('2'), rate: r('150'), batches: [{ batchNo: 'P2', qty: q('2') }] },
        { itemId: bike, locationId: a, qty: q('2'), rate: r('1000'), batches: [{ batchNo: 'K1', qty: q('2') }],
          units: serials.map((serialNo) => ({ serialNo })) },
        { itemId: zero, locationId: a, qty: q('1'), rate: r('50'), batches: [{ batchNo: 'Z1', qty: q('1') }] }] });
      return { t, pad, bike, zero, a, b, serials };
    });
    const { pad, bike, zero, a, b, serials } = made;
    // The move in a save of its own, once the batches it names are committed.
    await run(async (ctx) => {
      const lot = async (itemId: string, no: string) => (await pool.query<{ id: string }>('select id from radcore.batches where item_id = $1 and batch_no = $2',
        [itemId, no])).rows[0]?.id ?? '';
      await postDocument(ctx, { sourceTable: SOURCE_TABLE, sourceId: randomUUID(), businessDate: DATE, transfers: [
        { itemId: pad, from: a, to: b, sourceLineId: null, qty: q('1'), batches: [{ batchId: await lot(pad, 'P1'), qty: q('1') }] },
        { itemId: bike, from: a, to: b, sourceLineId: null, qty: q('1'), batches: [{ batchId: await lot(bike, 'K1'), qty: q('1') }],
          units: [{ serialNo: serials[1] ?? '' }], unitEvent: 'moved' },
        { itemId: zero, from: a, to: b, sourceLineId: null, qty: q('1'), batches: [{ batchId: await lot(zero, 'Z1'), qty: q('1') }] }] });
    });
    return made;
  }

  it('lists what is on hand by item then place, a page at a time, with each value only for cost:read', async () => {
    const at = await setup();
    const input = (after?: string) => ({ filter: { search: at.t }, limit: 3, ...(after === undefined ? {} : { after }) });
    const first = await get<Page<Position>>(staff, '/stock/positions', input());
    const second = await get<Page<Position>>(staff, '/stock/positions', input(first.body.next ?? ''));
    expect([first.status, first.body.items.length, second.body.items.length, second.body.next]).toEqual([200, 3, 2, null]);
    const rows = [...first.body.items, ...second.body.items];
    // By SKU (BIKE before PAD), then place code (A before B); batches by number.
    expect(rows.map((p) => [p.sku, p.locationName, p.qty, p.batches.map((b) => `${b.batchNo ?? '?'} ${b.qty}`)])).toEqual([
      [`BIKE-${at.t}`, `Place A${at.t}`, '1.000', ['K1 1.000']], [`BIKE-${at.t}`, `Place B${at.t}`, '1.000', ['K1 1.000']],
      [`PAD-${at.t}`, `Place A${at.t}`, '4.000', ['P1 2.000', 'P2 2.000']], [`PAD-${at.t}`, `Place B${at.t}`, '1.000', ['P1 1.000']],
      // ZERO is all at B now: A's position nets to nothing and isn't listed.
      [`ZERO-${at.t}`, `Place B${at.t}`, '1.000', ['Z1 1.000']],
    ]);
    // The values: BIKE's 1,000.00 a place; PAD's 600.00 split between the places by the move.
    const value = (p: Position | undefined) => Number(p?.value);
    expect([value(rows[0]), value(rows[1]), value(rows[2]) + value(rows[3])]).toEqual([1000, 1000, 600]);
    const masked = await get<Page<Position>>(operations, '/stock/positions', { filter: { itemId: at.pad }, limit: 10 });
    expect(masked.body.items.map((p) => typeof p.value === 'object' && p.value !== null && 'masked' in p.value)).toEqual([true, true]);
    // One place's positions only.
    expect((await get<Page<Position>>(staff, '/stock/positions', { filter: { locationId: at.b }, limit: 10 })).body.items.map((p) => p.sku))
      .toEqual([`BIKE-${at.t}`, `PAD-${at.t}`, `ZERO-${at.t}`]);
  });

  it('lists the units by serial a page at a time, finds one by its prefix, and shows its trail', async () => {
    const at = await setup();
    const first = await get<Page<Unit>>(operations, '/stock/units', { filter: { itemId: at.bike }, limit: 1 });
    const second = await get<Page<Unit>>(operations, '/stock/units', { filter: { itemId: at.bike }, limit: 1, after: first.body.next });
    expect([...first.body.items, ...second.body.items].map((u) => [u.serialNo, u.locationName, u.ownership, u.condition, u.promised])).toEqual([
      [at.serials[0], `Place A${at.t}`, 'ours', 'new', false], [at.serials[1], `Place B${at.t}`, 'ours', 'new', false]]);
    expect(second.body.next).toBeNull();
    const found = await get<Page<Unit>>(operations, '/stock/units', { filter: { search: `sb-${at.t.toLowerCase()}` }, limit: 10 });
    expect(found.body.items.map((u) => u.serialNo)).toEqual([at.serials[1]]);
    const unit = await get<Unit & { events: { kind: string; locationName: string | null; source: { table: string } }[] }>(operations,
      `/stock/units/${found.body.items[0]?.id ?? ''}`, {});
    expect(unit.body.events.map((e) => [e.kind, e.locationName, e.source.table])).toEqual([
      ['received', `Place A${at.t}`, SOURCE_TABLE], ['moved', `Place B${at.t}`, SOURCE_TABLE]]);
    const missing = await get<{ code: string }>(operations, `/stock/units/${randomUUID()}`, {});
    expect([missing.status, missing.body.code]).toEqual([404, 'not_found']);
  });
});
