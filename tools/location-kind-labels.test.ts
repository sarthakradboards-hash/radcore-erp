// RAD-92 (Sarthak's "Make labels editable", the architect's design): a location kind's label is a setting an admin
// renames, on a real PostgreSQL as the runtime login. Each kind answers its label and sellable rule; a rename shows on
// the next request; two kinds never show one label; resetting puts the default back; the code never changes. The
// settings are shared by every file running at once, so each test renames a kind of its own and puts it back.
import { randomBytes, randomUUID } from 'node:crypto';
import { AppError, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import { listKinds, setKindLabel } from '@radcore/lib-stock';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
const READ = { readOnly: true, isolation: 'read committed' } as const;
const admin: Principal = { kind: 'user', userId: '00000000-0000-4000-8000-000000000094', permissions: ['locations:read', 'locations:write'] };
const word = () => `Bay ${randomBytes(3).toString('hex')}`;

describe.skipIf(!url || !superUrl)('location kind labels', () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const su = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
    await su.end();
  });
  const kinds = () => runInTransaction(db, READ, admin, randomUUID(), (ctx: Ctx) => listKinds(ctx));
  const label = (kind: 'demo' | 'job_work' | 'in_transit', to: string | null) =>
    runInTransaction(db, WRITE, admin, randomUUID(), (ctx: Ctx) => setKindLabel(ctx, { kind, label: to }))
      .then(() => 'ok', (e: unknown) => (e instanceof AppError ? e.code : String(e)));

  it('answers every kind in order with its default label and whether it is sellable', async () => {
    const { kinds: all } = await kinds();
    expect(all.map((k) => [k.kind, k.sellable])).toEqual([['store', true], ['stores', true], ['service_bay', true],
      ['franchisee', true], ['rejected', false], ['demo', false], ['job_work', false], ['in_transit', false]]);
    expect(all.find((k) => k.kind === 'store')?.label).toBe('Store (sales floor)');
  });

  it('renames a label for the next request, keeps one row per kind, and resets to the default', async () => {
    const name = word();
    try {
      expect(await label('demo', `  ${name} `)).toBe('ok');
      expect((await kinds()).kinds.find((k) => k.kind === 'demo')?.label).toBe(name);
      const { rows } = await su.query<{ value: unknown }>("select value from radcore.settings where key = 'stock.location_kind_label_demo'");
      expect(rows).toEqual([{ value: name }]);
    } finally {
      expect(await label('demo', null)).toBe('ok');
    }
    expect((await kinds()).kinds.find((k) => k.kind === 'demo')?.label).toBe('Demo');
    expect((await su.query("select 1 from radcore.settings where key = 'stock.location_kind_label_demo'")).rowCount).toBe(0);
  });

  // drizzle's jsonb() parsed a stored string a second time, so "2024" read back as a number and "null" as null, and
  // every request reading the setting then failed (RAD-98 found it).
  it('reads back a label that looks like a number, null or true as the text it is', async () => {
    try {
      for (const name of ['2024', 'null', 'true', '{"a":1}']) {
        expect(await label('demo', name)).toBe('ok');
        expect((await kinds()).kinds.find((k) => k.kind === 'demo')?.label).toBe(name);
      }
    } finally {
      expect(await label('demo', null)).toBe('ok');
    }
  });

  it("refuses another kind's label, whatever its case or spacing, and a reset onto a label in use", async () => {
    expect(await label('job_work', ' rejected ')).toBe('label_in_use');
    const name = word();
    try {
      // job_work shows `In transit`, in_transit's default, while in_transit is renamed away from it.
      expect(await label('in_transit', name)).toBe('ok');
      expect(await label('job_work', 'In transit')).toBe('ok');
      expect(await label('in_transit', null)).toBe('label_in_use');
    } finally {
      expect(await label('job_work', null)).toBe('ok');
      expect(await label('in_transit', null)).toBe('ok');
    }
  });

  it('audits a rename with its old and new values, as the person who made it', async () => {
    const [first, second] = [word(), word()];
    try {
      expect(await label('demo', first)).toBe('ok');
      expect(await label('demo', second)).toBe('ok');
      const { rows } = await su.query<{ op: string; changed: { value?: { old?: unknown; new?: unknown } }; by: string }>(
        `select op, changed, created_by as by from radcore.audit_log where table_name = 'settings'
         and record_id = 'stock.location_kind_label_demo' order by seq desc limit 1`);
      expect(rows[0]).toMatchObject({ op: 'update', changed: { value: { old: first, new: second } }, by: 'user:00000000-0000-4000-8000-000000000094' });
    } finally {
      expect(await label('demo', null)).toBe('ok');
    }
  });
});
