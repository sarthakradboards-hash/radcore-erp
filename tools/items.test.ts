// RAD-89 (M2-10, RC-162, D-15): items, categories and units of measure on a real PostgreSQL as the runtime login. A
// quantity follows its item's unit, so 1.5 Nos is refused; an SKU and a barcode are unique; only a serialised item can
// have a chassis number, in the contract, the service and the database. Every SKU and name here is the test's own.
import { randomBytes, randomUUID } from 'node:crypto';
import { AppError, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import {
  addCategory, addItem, changeItem, checkQuantity, getItemById, listItemsPage, listUnits, renameCategory,
} from '@radcore/lib-stock';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const write = { readOnly: false, isolation: 'read committed' } as const;
const AS: Principal = { kind: 'system', name: 'test', permissions: [] };
const tag = () => randomBytes(5).toString('hex').toUpperCase();

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the item tests must run, not skip');
});

describe.skipIf(!url)('items and units of measure', { timeout: 30_000 }, () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const db = createDatabase(pool);
  const superPool = new pg.Pool({ connectionString: superUrl, max: 1 });
  afterAll(async () => { await Promise.all([pool.end(), superPool.end()]); });

  const run = <R>(fn: (ctx: Ctx) => Promise<R>) => runInTransaction(db, write, AS, randomUUID(), fn);
  const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof AppError ? e.code : String(e)));
  const category = async () => (await run((ctx) => addCategory(ctx, { name: `Test ${tag()}` }))).id;
  const newItem = async (o: Partial<Parameters<typeof addItem>[1]> = {}) => {
    const sku = `T-${tag()}`;
    const { id } = await run(async (ctx) => addItem(ctx, { sku, name: `Test item ${sku}`, categoryId: o.categoryId ?? await category(),
      hsn: '87116020', unit: 'NOS', barcode: null, serialised: false, hasChassis: false, ...o }));
    return { id, sku };
  };

  it('keeps a Nos quantity whole and a kilogram one to three decimals (RC-162)', async () => {
    const units = await run(listUnits);
    expect(units.units.find((u) => u.code === 'NOS')?.decimals).toBe(0);
    expect(units.units.find((u) => u.code === 'KGS')?.decimals).toBe(3);
    const nos = await newItem();
    const kgs = await newItem({ unit: 'KGS' });
    expect(await Promise.all([code(run((ctx) => checkQuantity(ctx, nos.id, '1.5'))), code(run((ctx) => checkQuantity(ctx, nos.id, '2'))),
      code(run((ctx) => checkQuantity(ctx, kgs.id, '1.505'))), code(run((ctx) => checkQuantity(ctx, kgs.id, '1.5055')))]))
      .toEqual(['quantity_too_precise', 'ok', 'ok', 'quantity_too_precise']);
  });

  it('keeps category names apart whatever the case or spacing', async () => {
    const name = `Spares ${tag()}`;
    const id = (await run((ctx) => addCategory(ctx, { name }))).id;
    expect(await code(run((ctx) => addCategory(ctx, { name: `  ${name.toUpperCase().replace(' ', '   ')}` })))).toBe('name_taken');
    expect(await code(run((ctx) => renameCategory(ctx, { id, name: `${name} and tools` })))).toBe('ok');
    expect(await code(run((ctx) => renameCategory(ctx, { id: randomUUID(), name: `Other ${tag()}` })))).toBe('not_found');
  });

  it('keeps an SKU unique whatever its case, and a barcode unique where set', async () => {
    const barcode = `89${tag()}`;
    const first = await newItem({ barcode });
    const categoryId = await category();
    expect(await code(run((ctx) => addItem(ctx, { sku: first.sku.toLowerCase(), name: 'Dup', categoryId, hsn: '8711', unit: 'NOS',
      barcode: null, serialised: false, hasChassis: false })))).toBe('sku_taken');
    expect(await code(newItem({ barcode }))).toBe('barcode_taken');
    expect(await code(newItem({ categoryId: randomUUID() }))).toBe('unknown_category');
    expect(await code(newItem({ unit: 'XYZ' }))).toBe('unknown_unit');
    // Many items without a barcode are fine.
    expect([await code(newItem()), await code(newItem())]).toEqual(['ok', 'ok']);
  });

  it('gives a chassis number only to a serialised item, in the service and the database (D-15)', async () => {
    const plain = await newItem();
    expect(await code(run((ctx) => changeItem(ctx, { id: plain.id, hasChassis: true })))).toBe('chassis_needs_serial');
    expect(await code(run((ctx) => changeItem(ctx, { id: plain.id, serialised: true, hasChassis: true })))).toBe('ok');
    expect(await run((ctx) => getItemById(ctx, { id: plain.id }))).toMatchObject({ serialised: true, hasChassis: true });
    expect(await code(run((ctx) => changeItem(ctx, { id: plain.id, serialised: false })))).toBe('chassis_needs_serial');
    expect(await code(run((ctx) => changeItem(ctx, { id: randomUUID(), name: 'Gone' })))).toBe('not_found');
    const c = await superPool.connect();
    try {
      await c.query('begin');
      await c.query("set local app.principal = 'system:test'");
      const refused = await c.query('update radcore.items set serialised = false where id = $1', [plain.id])
        .then(() => 'ok', (e: { constraint?: string }) => e.constraint);
      await c.query('rollback');
      expect(refused).toBe('ck_items_chassis');
    } finally {
      c.release();
    }
  });

  it('lists items by name, a page at a time, found by a word of the name, the SKU or the barcode', async () => {
    const categoryId = await category();
    const word = `Zx${tag()}`;
    const made = [];
    for (const [i, part] of ['alpha', 'bravo', 'charlie'].entries()) {
      made.push(await newItem({ categoryId, name: `${word} ${part}`, barcode: `${word}-${i}` }));
    }
    const page = (after?: string) => run((ctx) => listItemsPage(ctx, { filter: { categoryId }, limit: 2, ...(after ? { after } : {}) }));
    const first = await page();
    const second = await page(first.next ?? undefined);
    expect([...first.items, ...second.items].map((i) => i.id)).toEqual(made.map((m) => m.id));
    expect(second.next).toBeNull();
    const find = async (search: string) => (await run((ctx) => listItemsPage(ctx, { filter: { search }, limit: 10 }))).items.map((i) => i.id);
    expect(await find(`${word.toLowerCase()} BRAVO`)).toEqual([made[1]?.id]);
    expect(await find(made[2]?.sku ?? '')).toEqual([made[2]?.id]);
    expect(await find(`${word}-0`)).toEqual([made[0]?.id]);
  });
});
