// RAD-92 (M2-14, ADR-005 §3 to §5, ADR-006 §4): locations on a real PostgreSQL, as the runtime login, through lib-stock's
// services. A location's code is unique whatever its case or spacing; its kind is one of LOCATION_KINDS, refused by the
// table's CHECK as well as the contract; it's switched off, never deleted; every change is audited; and the stock keys
// went to the roles the plan's table names. Each test makes codes of its own, so the shuffled order doesn't matter.
import { randomBytes } from 'node:crypto';
import { AppError, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import { addPlace, listPlaces, updatePlace } from '@radcore/lib-stock';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
const READ = { readOnly: true, isolation: 'read committed' } as const;
const USER = '00000000-0000-4000-8000-000000000092';
const admin: Principal = { kind: 'user', userId: USER, permissions: ['locations:read', 'locations:write'] };
const tag = () => randomBytes(3).toString('hex').toUpperCase();
const codeOf = (e: unknown) => (e instanceof AppError ? e.code : String((e as { cause?: { code?: string } }).cause?.code ?? e));

describe.skipIf(!url || !superUrl)('locations', () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const admin_ = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
    await admin_.end();
  });
  const write = <T>(fn: (ctx: Ctx) => Promise<T>) => runInTransaction(db, WRITE, admin, `req-${tag()}`, fn);
  const read = <T>(fn: (ctx: Ctx) => Promise<T>) => runInTransaction(db, READ, admin, `req-${tag()}`, fn);
  const failure = (fn: (ctx: Ctx) => Promise<unknown>) => write(fn).then(() => 'ok', codeOf);

  it('adds a location and refuses a second with the same code, whatever its case or spacing', async () => {
    const code = `L-${tag()}`;
    const { id } = await write((ctx) => addPlace(ctx, { code, name: 'Main stock room', kind: 'stores' }));
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await failure((ctx) => addPlace(ctx, { code: ` ${code.toLowerCase()} `, name: 'Another', kind: 'store' })))
      .toBe('code_taken');
  });

  it('lists by code a page at a time, filtered by kind, status and search, never skipping or repeating', async () => {
    const prefix = `P${tag()}`;
    for (const [n, kind] of [['3', 'demo'], ['1', 'store'], ['2', 'store']] as const) {
      await write((ctx) => addPlace(ctx, { code: `${prefix}-${n}`, name: `Floor ${prefix} ${n}`, kind }));
    }
    const page = (after?: string) => read((ctx) => listPlaces(ctx,
      { filter: { search: prefix, kind: 'store' }, limit: 1, ...(after === undefined ? {} : { after }) }));
    const first = await page();
    const second = await page(first.next ?? undefined);
    expect([...first.items, ...second.items].map((l) => l.code)).toEqual([`${prefix}-1`, `${prefix}-2`]);
    expect(second.next).toBeNull();
    const all = await read((ctx) => listPlaces(ctx, { filter: { search: prefix }, limit: 10 }));
    expect(all.items.map((l) => [l.code, l.kind, l.active])).toEqual([
      [`${prefix}-1`, 'store', true], [`${prefix}-2`, 'store', true], [`${prefix}-3`, 'demo', true]]);
  });

  it('renames, recodes, moves and switches a location off, and answers not_found for no such location', async () => {
    const code = `U-${tag()}`;
    const { id } = await write((ctx) => addPlace(ctx, { code, name: 'Bay one', kind: 'service_bay' }));
    await write((ctx) => updatePlace(ctx, { id, code: `${code}X`, name: 'Bay 1', kind: 'rejected', active: false }));
    const inactive = await read((ctx) => listPlaces(ctx, { filter: { search: `${code}X`, status: 'inactive' }, limit: 5 }));
    expect(inactive.items).toEqual([{ id, code: `${code}X`, name: 'Bay 1', kind: 'rejected', active: false }]);
    expect(await failure((ctx) => updatePlace(ctx, { id: '00000000-0000-4000-8000-0000000000ff', name: 'x' }))).toBe('not_found');
  });

  // ADR-005 §4: the table refuses a kind the contract would, so no other path stores one.
  it('refuses a kind outside LOCATION_KINDS in the table itself', async () => {
    expect(await failure((ctx) => addPlace(ctx, { code: `K-${tag()}`, name: 'Warehouse', kind: 'warehouse' as 'store' })))
      .toBe('23514');
  });

  it('audits each change, as the person who made it, and never deletes', async () => {
    const code = `A-${tag()}`;
    const { id } = await write((ctx) => addPlace(ctx, { code, name: 'Audited', kind: 'in_transit' }));
    await write((ctx) => updatePlace(ctx, { id, active: false }));
    const { rows } = await admin_.query<{ op: string; by: string }>(
      "select op, created_by as by from radcore.audit_log where table_name = 'locations' and record_id = $1 order by seq", [id]);
    expect(rows).toEqual([{ op: 'insert', by: `user:${USER}` }, { op: 'update', by: `user:${USER}` }]);
    await expect(pool.query('delete from radcore.locations where id = $1', [id])).rejects.toMatchObject({ code: '42501' });
  });

  // The architect on RAD-92, from the plan's role table: everyone who touches stock reads locations; admin writes them.
  it('grants locations:read to every role but HR and marketing, and locations:write to admin only', async () => {
    const { rows } = await admin_.query<{ role: string; permission: string }>(
      "select role, permission from radcore.role_grants where permission like 'locations:%' order by permission, role");
    expect(rows.map((r) => `${r.permission} ${r.role}`)).toEqual([
      ...['accounts', 'admin', 'counter', 'operations', 'owner', 'sales', 'service_head', 'stores', 'technician']
        .map((r) => `locations:read ${r}`), 'locations:write admin']);
  });
});
