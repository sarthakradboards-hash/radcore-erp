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
   where table_name = $1 and record_id = $2 order by seq`, [table, id])).rows;

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
      // One transaction, so one occurred_at: seq is what keeps the order (auditor-2 on #90).
      // Only the listed columns: the key is record_id already, and the four audit columns are the row's own.
      expect(rows[0]?.changed).toEqual({ value: 'INV' });
      expect(rows[2]?.changed).toEqual({ value: 'RB' });
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
      // The owner's TRUNCATE below takes ACCESS EXCLUSIVE on each log and every partition. Taken a table at a time,
      // with this transaction already holding a partition through its own audit row, it can deadlock (40P01) with a
      // test file writing audit rows at the same moment. Locking all three logs first, before anything else, makes
      // those writers wait for this rollback instead (the coordinator on RAD-30, seen under the full parallel suite).
      await c.query('lock table radcore.audit_log, radcore.access_log, radcore.event_log in access exclusive mode');
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
      // RAD-31's record_event is the only way into event_log (the architect on RAD-30).
      expect(await outcome(c, "insert into radcore.event_log (kind) values ('sign_in')")).toBe('42501');
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
      expect(await outcome(c, "insert into radcore.event_log (kind, occurred_at) values ('sign_in', now() + interval '1 day')"))
        .toBe('23514');
      expect(await outcome(c, "insert into radcore.event_log (kind) values ('sign_in')")).toBe('ok');
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
        // Its own ids only: other files log real looks at users in the shared database (RAD-40).
        "select record_id, created_by from radcore.access_log where record_table = 'users' and record_id in ('u-1', 'u-2') order by record_id");
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

  it("stamps saved_once's rows but doesn't audit them: it's bookkeeping on every write (ADR-005 §7c)", async () => {
    await inRollback(async (c) => {
      const before = (await c.query<{ n: number }>("select count(*)::int as n from radcore.audit_log where table_name = 'saved_once'")).rows[0]?.n;
      await c.query('set local role radcore_app');
      await c.query(`insert into radcore.saved_once (principal, route, key, input_hash, expires_at)
        values ('user:asha', 'POST /notes', gen_random_uuid(), repeat('a', 64), now() + interval '1 day')`);
      const { rows: [row] } = await c.query<{ created_by: string }>(
        "select created_by from radcore.saved_once where principal = 'user:asha' and route = 'POST /notes'");
      expect(row?.created_by).toBe('user:asha');
      await c.query('reset role');
      expect((await c.query<{ n: number }>("select count(*)::int as n from radcore.audit_log where table_name = 'saved_once'")).rows[0]?.n)
        .toBe(before);
    });
  });

  it('lets neither login attach the triggers: audit_attach is for migrations only', async () => {
    await inRollback(async (c) => {
      await c.query('set local role radcore_app');
      expect(await outcome(c, "select radcore.audit_attach('settings')")).toBe('42501');
      await c.query('set local role radcore_read');
      expect(await outcome(c, "select radcore.audit_attach('settings')")).toBe('42501');
    });
  });

  // M6-16, references not copies: personal data never reaches the append-only log, only that it changed.
  it("writes a person's email and name as [redacted], and keeps their status", async () => {
    await inRollback(async (c) => {
      const { rows: [u] } = await c.query<{ id: string }>(
        "insert into radcore.users (email, display_name, role) values ('asha.rao@example.com', 'Asha Rao', 'sales') returning id");
      await c.query("update radcore.users set display_name = 'Asha R.' where id = $1", [u?.id]);
      const rows = await auditOf(c, 'users', u?.id ?? '');
      expect(rows[0]?.changed).toEqual({ status: 'invited', password_set_at: null, role: 'sales', role_since: null, email: '[redacted]',
        email_key: '[redacted]', display_name: '[redacted]', password_hash: '[redacted]' });
      expect(rows[1]?.changed).toEqual({ display_name: '[redacted]' });
      expect(JSON.stringify(rows.map((r) => r.changed))).not.toMatch(/asha|Asha/);
    });
  });

  it("stamps the outbox's rows but doesn't audit them: a reset job's data is a typed address (ADR-001 §7a)", async () => {
    await inRollback(async (c) => {
      await c.query(`insert into radcore.jobs_outbox (name, data, principal, request_id)
        values ('auth.password-reset', '{"email": "asha.rao@example.com"}', 'system:test', 'r-1')`);
      const { rows } = await c.query("select 1 from radcore.audit_log where table_name = 'jobs_outbox'");
      expect(rows).toEqual([]);
      expect((await c.query<{ n: number }>("select count(*)::int as n from radcore.audit_log where changed::text like '%asha%'"))
        .rows[0]?.n).toBe(0);
    });
  });

  it('refuses to attach a table with a column left unlisted, or listed both ways', async () => {
    await inRollback(async (c) => {
      await c.query('set local role radcore_owner');
      expect(await outcome(c, "select radcore.audit_attach('settings')")).toBe('P0001');
      expect(await outcome(c, "select radcore.audit_attach('settings', keep => array['value'], redact => array['value'])"))
        .toBe('P0001');
      expect(await outcome(c, "select radcore.audit_attach('settings', keep => array['value', 'nope'])")).toBe('P0001');
    });
  });

  // auditor-2 and the architect on #90: the lists are fixed when the table is attached, so a column added later would
  // go into the append-only log in full. The schema view finds it, by name for a secret.
  it('flags a column added to an audited table without attaching it again', async () => {
    await inRollback(async (c) => {
      const problems = async () => (await c.query<{ table_name: string; column_name: string; problem: string }>(
        'select table_name, column_name, problem from radcore.v_schema_audit_columns order by 1, 2, 3')).rows;
      expect(await problems()).toEqual([]);
      await c.query('set local role radcore_owner');
      await c.query('alter table radcore.users add column totp_secret text, add column nickname text');
      expect(await problems()).toEqual([
        { table_name: 'users', column_name: 'nickname', problem: 'unlisted' },
        { table_name: 'users', column_name: 'totp_secret', problem: 'a secret not redacted' },
        { table_name: 'users', column_name: 'totp_secret', problem: 'unlisted' }]);
    });
  });
});
