// RAD-89 (M2-10, RC-162, D-15): items, categories and units of measure on a real PostgreSQL as the runtime login. A
// quantity follows its item's unit, so 1.5 Nos is refused; an SKU and a barcode are unique; only a serialised item can
// have a chassis number, in the contract, the service and the database. Every SKU and name here is the test's own.
import { randomBytes, randomUUID } from 'node:crypto';
import { AppError, viewLinks, type Ctx, type Files, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import {
  addCategory, addItem, addItemPicture, changeItem, checkQuantity, dropItemPicture, getItemById, listItemsPage, listUnits,
  renameCategory,
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

  // The store's signing calls, as ctx.files sees them: a view link names its key and its checked type.
  const files: Files = {
    presignUpload: async () => { throw new Error('not used here'); },
    downloadUrl: async () => { throw new Error('a picture is never downloaded'); },
    viewUrl: async (key, contentType) => `https://files.example.test/${key}?view=${encodeURIComponent(contentType)}`,
  };
  const run = <R>(fn: (ctx: Ctx) => Promise<R>) => runInTransaction(db, write, AS, randomUUID(), fn, files);
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

  it('switches an item off rather than deleting it, and the app can delete no item or category (ADR-005 §3)', async () => {
    const categoryId = await category();
    const { id } = await newItem({ categoryId });
    expect(await code(run((ctx) => changeItem(ctx, { id, active: false })))).toBe('ok');
    const listed = async (active?: boolean) => (await run((ctx) => listItemsPage(ctx, {
      filter: { categoryId, ...(active === undefined ? {} : { active }) }, limit: 10 }))).items.map((i) => [i.id, i.active]);
    expect([await listed(), await listed(true), await listed(false)]).toEqual([[[id, false]], [], [[id, false]]]);
    // As the app's own login: masters are switched off, never deleted, and the units are read-only.
    const refused = (q: string, v: unknown[] = []) => pool.query(q, v).then(() => 'ok', (e: { code?: string }) => e.code);
    expect(await Promise.all([refused('delete from radcore.items where id = $1', [id]),
      refused('delete from radcore.item_categories where id = $1', [categoryId]),
      refused("update radcore.units_of_measure set decimals = 1 where code = 'NOS'")])).toEqual(['42501', '42501', '42501']);
  });

  it('pictures an item with ready item pictures only, shown inline with no download event (RAD-89, ADR-004 §2)', async () => {
    const file = async (kind: string, status: string) => {
      const id = randomUUID();
      // Every write names its principal, or the stamp trigger refuses it (RA005), whoever writes.
      const c = await superPool.connect();
      try {
        await c.query('begin');
        await c.query("set local app.principal = 'system:test'");
        await c.query(`insert into radcore.files (id, kind, store_key, filename, content_type, size, status)
          values ($1, $2, $3, 'p.webp', 'image/webp', 2048, $4)`, [id, kind, `${kind}/${id}`, status]);
        await c.query('commit');
      } finally {
        c.release();
      }
      return id;
    };
    const { id } = await newItem();
    const [ready, checking, photo] = [await file('item_picture', 'ready'), await file('item_picture', 'checking'), await file('photo', 'ready')];
    const attach = (fileId: string) => code(run((ctx) => addItemPicture(ctx, { id, fileId })));
    expect([await attach(ready), await attach(checking), await attach(photo), await attach(ready)])
      .toEqual(['ok', 'not_ready', 'not_found', 'picture_attached']);
    const answer = await run((ctx) => getItemById(ctx, { id }));
    expect(answer.pictures).toEqual([{ fileId: ready, url: `https://files.example.test/item_picture/${ready}?view=image%2Fwebp` }]);
    // Viewing writes no download event: only a download kind's link does (RC-031).
    expect((await superPool.query("select 1 from radcore.event_log where kind = 'download' and detail->>'fileId' = $1", [ready])).rows).toEqual([]);
    await expect(run((ctx) => viewLinks(ctx, 'photo', [photo]))).rejects.toThrow(/downloaded/);
    // At most 8 pictures, each in its own place.
    for (let i = 0; i < 7; i += 1) expect(await attach(await file('item_picture', 'ready'))).toBe('ok');
    expect(await attach(await file('item_picture', 'ready'))).toBe('too_many_pictures');
    expect([await code(run((ctx) => dropItemPicture(ctx, { id, fileId: ready }))), await code(run((ctx) => dropItemPicture(ctx, { id, fileId: ready })))])
      .toEqual(['ok', 'not_found']);
    expect((await run((ctx) => getItemById(ctx, { id }))).pictures).toHaveLength(7);
  });
});
