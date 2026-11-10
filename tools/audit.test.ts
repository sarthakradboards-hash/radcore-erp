// RAD-30 (M1-12, RC-030, RC-046, ADR-005 §5, §7, §7c, §8): the audit engine on a real PostgreSQL 16, as each login.
// Each test runs in its own transaction as the superuser, switching login with SET ROLE, and rolls back.
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { LOG_MONTHS_AHEAD } from '../packages/db/src/migrate.ts';

const url = process.env['TEST_DATABASE_SUPERUSER_URL'];
const LOGS = ['audit_log', 'access_log', 'event_log'];

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_SUPERUSER_URL is not set: in CI the audit tests must run, not skip');
});

async function inRollback(fn: (c: pg.Client) => Promise<void>) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query('begin');
    await c.query("set local app.principal = 'user:asha'");
    await fn(c);
  } finally {
    await c.query('rollback');
    await c.end();
  }
}

// The SQLSTATE a statement fails with, or 'ok', under a savepoint so the transaction goes on.
async function outcome(c: pg.Client, text: string, params: unknown[] = []): Promise<string> {
  await c.query('savepoint s');
  try {
    await c.query(text, params);
    await c.query('release savepoint s');
    return 'ok';
  } catch (error) {
    await c.query('rollback to savepoint s');
    return (error as { code?: string }).code ?? 'unknown';
  }
}

type AuditRow = { table_name: string; record_id: string; op: string; changed: Record<string, unknown>; created_by: string };
const auditOf = async (c: pg.Client, table: string, id: string) => (await c.query<AuditRow>(
  `select table_name, record_id, op, changed, created_by from radcore.audit_log
   where table_name = $1 and record_id = $2 order by occurred_at, op`, [table, id])).rows;

describe.skipIf(!url)('the audit engine', () => {
  it('audits every insert, update and delete by trigger, as the principal, with no audit call (RC-030)', async () => {
    await inRollback(async (c) => {
      await c.query('set local role radcore_app');
      await c.query("insert into radcore.settings (key, value) values ('sales.invoice_prefix', '\"INV\"')");
      await c.query("update radcore.settings set value = '\"RB\"' where key = 'sales.invoice_prefix'");
      await c.query("update radcore.settings set value = '\"RB\"' where key = 'sales.invoice_prefix'"); // no change: no row
      await c.query("delete from radcore.settings where key = 'sales.invoice_prefix'");
      await c.query('reset role');
      const rows = await auditOf(c, 'settings', 'sales.invoice_prefix');
      expect(rows.map((r) => [r.op, r.created_by])).toEqual([['insert', 'user:asha'], ['update', 'user:asha'], ['delete', 'user:asha']]);
      expect(rows[0]?.changed).toMatchObject({ key: 'sales.invoice_prefix', value: 'INV' });
      expect(rows[1]?.changed).toEqual({ value: { old: 'INV', new: 'RB' } });
    });
  });

  it('stamps who and when itself, so the app can neither set nor forge them (ADR-005 §5)', async () => {
    await inRollback(async (c) => {
      await c.query('set local role radcore_app');
      await c.query(`insert into radcore.settings (key, value, created_by, created_at, updated_by)
        values ('ops.x', '1', 'user:someone-else', '2001-01-01', 'user:someone-else')`);
      await c.query("set local app.principal = 'user:ravi'");
      await c.query("update radcore.settings set value = '2', created_by = 'user:forged' where key = 'ops.x'");
      const { rows: [row] } = await c.query<{ created_by: string; updated_by: string; old: boolean }>(
        "select created_by, updated_by, created_at < now() - interval '1 day' as old from radcore.settings where key = 'ops.x'");
      expect(row).toEqual({ created_by: 'user:asha', updated_by: 'user:ravi', old: false });
    });
  });

  it('refuses a write with no principal with RA005, a delete included', async () => {
    await inRollback(async (c) => {
      await c.query("insert into radcore.settings (key, value) values ('ops.y', '1')");
      await c.query('set local role radcore_app');
      await c.query("set local app.principal = ''");
      expect(await outcome(c, "insert into radcore.settings (key, value) values ('ops.z', '1')")).toBe('RA005');
      expect(await outcome(c, "update radcore.settings set value = '2' where key = 'ops.y'")).toBe('RA005');
      expect(await outcome(c, "delete from radcore.settings where key = 'ops.y'")).toBe('RA005');
    });
  });

  it('writes a secret or a hash as [redacted], on insert and on change', async () => {
    await inRollback(async (c) => {
      const { rows: [s] } = await c.query<{ id: string }>(
        "insert into radcore.secrets (name, ciphertext, key_id) values ('platform.smtp', 'c1-ciphertext', 'k1') returning id");
      await c.query("update radcore.secrets set ciphertext = 'c2-ciphertext' where id = $1", [s?.id]);
      const rows = await auditOf(c, 'secrets', s?.id ?? '');
      expect(rows.map((r) => r.changed['ciphertext'])).toEqual(['[redacted]', '[redacted]']);
      expect(JSON.stringify(rows)).not.toMatch(/c[12]-ciphertext/);
    });
  });

  it('keeps every log append-only: the app can write none of them, and the owner is refused with RA001 (ADR-005 §7)', async () => {
    await inRollback(async (c) => {
      await c.query("insert into radcore.settings (key, value) values ('ops.w', '1')"); // one audit row to aim at
      const { rows: parts } = await c.query<{ name: string }>(`select c.relname as name from pg_inherits i
        join pg_class c on c.oid = i.inhrelid join pg_class p on p.oid = i.inhparent where p.relname = any($1) order by 1`, [LOGS]);
      expect(parts.length).toBeGreaterThanOrEqual(3 * 25); // 24 months and a default, per log
      await c.query('set local role radcore_app');
      for (const t of [...LOGS, ...parts.map((p) => p.name)]) {
        for (const sql of [`update radcore.${t} set id = id`, `delete from radcore.${t}`, `truncate radcore.${t}`]) {
          expect(await outcome(c, sql), `${sql} as the app`).toBe('42501');
        }
      }
      expect(await outcome(c, "insert into radcore.audit_log (table_name, record_id, op, changed) values ('x', '1', 'insert', '{}')"))
        .toBe('42501');
      expect(await outcome(c, "insert into radcore.access_log (record_table, record_id) values ('x', '1')")).toBe('42501');
      await c.query('set local role radcore_owner');
      const month = parts.find((p) => p.name.startsWith('audit_log_2'))?.name ?? '';
      expect(await outcome(c, 'update radcore.audit_log set op = op')).toBe('RA001');
      expect(await outcome(c, 'delete from radcore.audit_log')).toBe('RA001');
      expect(await outcome(c, 'truncate radcore.audit_log')).toBe('RA001');
      expect(await outcome(c, `truncate radcore.${month}`)).toBe('RA001');
      expect(await outcome(c, 'truncate radcore.audit_log_default')).toBe('RA001');
    });
  });

  it("can't be captured by a temporary audit_log: the app makes none, and the write still lands in radcore's", async () => {
    await inRollback(async (c) => {
      await c.query('set local role radcore_app');
      expect(await outcome(c, 'create temp table audit_log (id int)')).toBe('42501');
      await c.query("set local search_path = pg_temp, radcore");
      await c.query("insert into settings (key, value) values ('ops.t', '1')");
      await c.query('reset role');
      expect((await auditOf(c, 'settings', 'ops.t')).map((r) => r.op)).toEqual(['insert']);
    });
  });

  it("takes a log's time from the database: a far-off occurred_at is refused (ADR-005 §8)", async () => {
    await inRollback(async (c) => {
      expect(await outcome(c, "insert into radcore.event_log (kind, occurred_at) values ('test', now() + interval '1 day')"))
        .toBe('23514');
      expect(await outcome(c, "insert into radcore.event_log (kind) values ('test')")).toBe('ok');
    });
  });

  it('records an access through record_access only, as the principal; the read-only login cannot', async () => {
    await inRollback(async (c) => {
      await c.query('set local role radcore_app');
      await c.query("select radcore.record_access('users', 'u-1')");
      await c.query('set local role radcore_read');
      expect(await outcome(c, "select radcore.record_access('users', 'u-2')")).toBe('42501');
      await c.query('reset role');
      const { rows } = await c.query<{ record_id: string; created_by: string }>(
        "select record_id, created_by from radcore.access_log where record_table = 'users' order by record_id");
      expect(rows).toEqual([{ record_id: 'u-1', created_by: 'user:asha' }]);
    });
  });

  it('keeps 12 future months after the top-up, and a second top-up adds nothing (RC-046)', async () => {
    await inRollback(async (c) => {
      await c.query('set local role radcore_owner');
      expect((await c.query<{ n: number }>('select radcore.add_log_partitions($1) as n', [LOG_MONTHS_AHEAD])).rows[0]?.n).toBe(0);
      const { rows } = await c.query<{ log: string; ahead: number }>(`select p.relname as log, count(*)::int as ahead
        from pg_inherits i join pg_class c on c.oid = i.inhrelid join pg_class p on p.oid = i.inhparent
        where p.relname = any($1) and c.relname > p.relname || '_' || to_char(now() at time zone 'UTC', 'YYYY_MM')
          and c.relname <> p.relname || '_default'
        group by 1 order by 1`, [LOGS]);
      expect(rows.every((r) => r.ahead >= LOG_MONTHS_AHEAD), JSON.stringify(rows)).toBe(true);
    });
  });

  it('leaves no table in radcore without its triggers (ADR-005 §5)', async () => {
    await inRollback(async (c) => {
      expect((await c.query("select * from radcore.v_schema_missing_triggers where schema_name = 'radcore'")).rows).toEqual([]);
    });
  });
});
