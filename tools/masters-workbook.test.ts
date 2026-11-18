// RAD-92 (M2-14, RC-164) on a real PostgreSQL, as the runtime login: the masters workbook, written by the worker's own
// join (apps/worker/src/masters.ts) and read back. A sheet is in the file only when its starter holds that master's
// read key when the job runs, so the file never shows more than their screens would; personal columns are masked as on
// a screen, unmasked with pii:read only; a kind shows as its label; and the export is stored as XLSX. Each test seeds
// codes of its own and looks for them, since the shared database holds every other file's rows too.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { startMastersExport, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import { addPerson } from '@radcore/lib-hr';
import { addPlace } from '@radcore/lib-stock';
import pg from 'pg';
import readXlsxFile from 'read-excel-file/node';
import { afterAll, describe, expect, it } from 'vitest';
import { masters } from '../apps/worker/src/masters.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
const SNAPSHOT = { readOnly: true, isolation: 'repeatable read' } as const;
const tag = () => randomBytes(3).toString('hex').toUpperCase();
const as = (permissions: string[]): Principal => ({ kind: 'user', userId: randomUUID(), permissions });
const EVERYTHING = ['masters:export', 'locations:read', 'items:read', 'employees:read', 'pii:read'];

describe.skipIf(!url || !superUrl)('the masters workbook', () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const su = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
    await su.end();
  });
  const seeder = as(['locations:write', 'employees:write']);
  const seed = async () => {
    const code = `W${tag()}`;
    await runInTransaction(db, WRITE, seeder, randomUUID(), async (ctx: Ctx) => {
      await addPlace(ctx, { code, name: 'Workbook stock room', kind: 'stores' });
      await addPerson(ctx, { code, name: 'Ravi Kumar', phone: '+91 91234 56789', email: 'ravi.workbook@example.in' });
    });
    return code;
  };
  // The workbook as the job writes it for this starter, read back as { sheet name: rows }.
  async function workbook(starter: Principal): Promise<Record<string, unknown[][]>> {
    const dir = await mkdtemp(join(tmpdir(), 'radcore-workbook-'));
    try {
      const path = join(dir, 'masters.xlsx');
      await runInTransaction(db, SNAPSHOT, starter, randomUUID(), (ctx: Ctx) => masters.write(ctx, {}, path, 1_000_000));
      return Object.fromEntries((await readXlsxFile<string>(path)).map((s) => [s.sheet, s.data]));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  const rowOf = (sheet: unknown[][] | undefined, code: string) => sheet?.find((r) => r[0] === code);

  it('writes a sheet per master the starter may read, each with its header, and a kind as its label', async () => {
    const code = await seed();
    const book = await workbook(as(EVERYTHING));
    expect(Object.keys(book)).toEqual(['Locations', 'Items', 'Employees']);
    expect(book['Locations']?.[0]).toEqual(['code', 'name', 'kind', 'active']);
    expect(rowOf(book['Locations'], code)).toEqual([code, 'Workbook stock room', 'Stores (stock room)', 'Yes']);
    expect(book['Items']?.[0]).toEqual(['sku', 'name', 'category', 'hsn', 'unit', 'barcode', 'serialised', 'hasChassis', 'active']);
    expect(rowOf(book['Employees'], code)).toEqual([code, 'Ravi Kumar', '+919123456789', 'ravi.workbook@example.in', null, null, 'Yes']);
  });

  // The coordinator's call: the export never shows more than the screens would.
  it("leaves out a master's sheet when the starter can't read it", async () => {
    await seed();
    const book = await workbook(as(['masters:export', 'locations:read', 'items:read']));
    expect(Object.keys(book)).toEqual(['Locations', 'Items']);
  });

  it('masks the phone to its last 4 and the email whole without pii:read', async () => {
    const code = await seed();
    const book = await workbook(as(['masters:export', 'employees:read']));
    expect(Object.keys(book)).toEqual(['Employees']);
    expect(rowOf(book['Employees'], code)?.slice(2, 4)).toEqual(['••••••6789', '••••••']);
  });

  it('stores the export as XLSX, so it downloads as masters.xlsx', async () => {
    const { exportId } = await runInTransaction(db, WRITE, as(['masters:export']), randomUUID(),
      (ctx: Ctx) => startMastersExport(ctx, { filter: {} }));
    const { rows } = await su.query<{ kind: string; format: string }>('select kind, format from radcore.exports where id = $1', [exportId]);
    expect(rows).toEqual([{ kind: 'platform.masters', format: 'xlsx' }]);
  });
});
