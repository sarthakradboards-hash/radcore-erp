// RAD-24 (M1-06, RC-003, RC-193, ADR-005 §7c): the three logins on a real PostgreSQL. The owner owns everything the
// migrations made; the app login reads and writes rows but changes no structure and rewrites no ledger; the read-only
// login only reads. Each test acts as a login with SET ROLE inside a transaction it rolls back, so it leaves nothing.
import { randomBytes } from 'node:crypto';
import { loadConfig } from '@radcore/lib-platform';
import { createJobQueue } from '@radcore/lib-platform/runtime';
import { testPassword, testSettings } from '@radcore/test-helpers';
import pg from 'pg';
import { describe, expect, it } from 'vitest';

// A superuser on the test database, so each test can switch between the three logins.
const url = process.env['TEST_DATABASE_SUPERUSER_URL'];
// What every other database test gets: the runtime login (tools/test-database.ts).
const appUrl = process.env['TEST_DATABASE_URL'];
// The test server uses trust auth; the settings check wants a password, which the server ignores.
const withPassword = (u: string) => {
  const parsed = new URL(u);
  parsed.password = testPassword();
  return parsed.toString();
};

// ADR-005 §7's append-only tables, exactly.
const APPEND_ONLY = ['journal_entries', 'journal_lines', 'stock_movements', 'unit_events', 'payment_allocations',
  'credit_applications', 'audit_log', 'access_log', 'event_log', 'webhook_delivery_attempts'];
// Written only by triggers and record_access, never by an INSERT from the app.
const NO_INSERT = ['audit_log', 'access_log'];
const EVERY = 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER';

// Anything in radcore a login could reach that it must not:
// - an append-only table the app can update, delete or truncate, or a log it can insert into;
// - a view the app can write through (a simple view writes as its owner);
// - a partition either login holds any privilege on. Rows go through the parent, so a partition has no grants: the
//   owner's default privileges would otherwise let the app insert straight into an audit_log partition the top-up made.
const EXPOSED = `
  select c.relname from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'radcore' and (
    (c.relname = any($1) and has_table_privilege('radcore_app', c.oid, 'UPDATE, DELETE, TRUNCATE'))
    or (c.relname = any($2) and has_table_privilege('radcore_app', c.oid, 'INSERT'))
    or (c.relkind in ('v', 'm') and has_table_privilege('radcore_app', c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE'))
    or (c.relispartition and (has_table_privilege('radcore_app', c.oid, '${EVERY}')
      or has_table_privilege('radcore_read', c.oid, '${EVERY}'))))
  order by 1`;

async function inRollback(fn: (c: pg.Client) => Promise<void>) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query('begin');
    await fn(c);
  } finally {
    await c.query('rollback');
    await c.end();
  }
}

// The SQLSTATE a statement fails with, or 'ok'. It runs under a savepoint, so the transaction goes on.
async function outcome(c: pg.Client, text: string): Promise<string> {
  await c.query('savepoint s');
  try {
    await c.query(text);
    await c.query('release savepoint s');
    return 'ok';
  } catch (error) {
    await c.query('rollback to savepoint s');
    return (error as { code?: string }).code ?? 'unknown';
  }
}
// One after another: each statement's savepoint must close before the next opens.
async function outcomes(c: pg.Client, statements: Record<string, string>): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const [name, text] of Object.entries(statements)) result[name] = await outcome(c, text);
  return result;
}

const DENIED = '42501';

describe.skipIf(!url)('the three logins', () => {
  it('are three plain logins, none a superuser or able to make roles or databases', async () => {
    await inRollback(async (c) => {
      const { rows } = await c.query(`select rolname, rolcanlogin, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls,
        rolreplication from pg_roles where rolname = any($1) order by rolname`, [['radcore_app', 'radcore_owner', 'radcore_read']]);
      const plain = { rolcanlogin: true, rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolbypassrls: false, rolreplication: false };
      expect(rows).toEqual([{ rolname: 'radcore_app', ...plain }, { rolname: 'radcore_owner', ...plain },
        { rolname: 'radcore_read', ...plain }]);
    });
  });

  it('give the owner the database and everything the migrations made', async () => {
    await inRollback(async (c) => {
      const { rows } = await c.query(`
        select pg_get_userbyid(datdba) as owner from pg_database where datname = current_database()
        union select pg_get_userbyid(nspowner) from pg_namespace where nspname in ('radcore', 'pgboss', 'drizzle')
        union select pg_get_userbyid(c.relowner) from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname in ('radcore', 'pgboss', 'drizzle')`);
      expect(rows).toEqual([{ owner: 'radcore_owner' }]);
    });
  });

  // ADR-005 §7c (RAD-47): pg_trgm's functions keep PUBLIC's EXECUTE, so what closes them is that neither login may
  // use the schema they live in.
  it('keep pg_trgm in radcore_ext, which neither login may use', async () => {
    await inRollback(async (c) => {
      const { rows } = await c.query(`select n.nspname as schema, pg_get_userbyid(n.nspowner) as owner,
        has_schema_privilege('radcore_app', n.oid, 'USAGE') as app, has_schema_privilege('radcore_read', n.oid, 'USAGE') as read
        from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm'`);
      expect(rows).toEqual([{ schema: 'radcore_ext', owner: 'radcore_owner', app: false, read: false }]);
    });
  });

  // The ticket's proof. journal_lines doesn't exist yet (M2-03), so this makes it the way its migration will: as the
  // owner, then the append-only revoke. ADR-005 §7's triggers (M1-12) refuse the owner's own UPDATE and DELETE too.
  it("the app login can't drop, alter or delete a journal line (RC-003)", async () => {
    await inRollback(async (c) => {
      await c.query('set local role radcore_owner');
      await c.query('create table radcore.journal_lines (id int primary key, debit numeric not null)');
      await c.query('revoke update, delete, truncate on radcore.journal_lines from radcore_app');
      await c.query('set local role radcore_app');
      expect(await outcomes(c, {
        insert: 'insert into radcore.journal_lines values (1, 10)',
        select: 'select * from radcore.journal_lines',
        update: 'update radcore.journal_lines set debit = 0',
        delete: 'delete from radcore.journal_lines',
        truncate: 'truncate radcore.journal_lines',
        alter: 'alter table radcore.journal_lines add column note text',
        drop: 'drop table radcore.journal_lines',
      })).toEqual({ insert: 'ok', select: 'ok', update: DENIED, delete: DENIED, truncate: DENIED, alter: DENIED, drop: DENIED });
    });
  });

  it('the app login makes no structure anywhere, and no temporary table', async () => {
    await inRollback(async (c) => {
      const [view] = (await c.query<{ name: string }>(`select c.relname as name from pg_class c
        join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'radcore' and c.relkind = 'v' order by 1 limit 1`)).rows;
      await c.query('set local role radcore_app');
      expect(await outcomes(c, {
        table: 'create table radcore.t (x int)',
        publicTable: 'create table public.t (x int)',
        queueTable: 'create table pgboss.t (x int)',
        schema: 'create schema t',
        temp: 'create temp table audit_log (x int)',
        fn: 'create function radcore.f() returns int language sql as $$ select 1 $$',
        alterView: `alter view radcore.${view?.name ?? ''} rename to t`,
        dropView: `drop view radcore.${view?.name ?? ''}`,
      })).toEqual({ table: DENIED, publicTable: DENIED, queueTable: DENIED, schema: DENIED, temp: DENIED, fn: DENIED,
        alterView: DENIED, dropView: DENIED });
    });
  });

  it('the read-only login reads, and writes nothing (RC-193)', async () => {
    await inRollback(async (c) => {
      await c.query('set local role radcore_owner');
      await c.query('create table radcore.notes (id int primary key)');
      await c.query('insert into radcore.notes values (1)');
      await c.query('set local role radcore_read');
      expect(await outcomes(c, {
        select: 'select * from radcore.notes',
        insert: 'insert into radcore.notes values (2)',
        update: 'update radcore.notes set id = 3',
        delete: 'delete from radcore.notes',
        queue: 'select * from pgboss.job',
        // RAD-65: not even the ciphertexts.
        secrets: 'select * from radcore.secrets',
        temp: 'create temp table t (x int)',
      })).toEqual({ select: 'ok', insert: DENIED, update: DENIED, delete: DENIED, queue: DENIED, secrets: DENIED,
        temp: DENIED });
    });
  });

  it('leave no append-only table, log, view or partition open to the app or read-only login', async () => {
    await inRollback(async (c) => {
      const exposed = async () => (await c.query<{ relname: string }>(EXPOSED, [APPEND_ONLY, NO_INSERT])).rows.map((r) => r.relname);
      expect(await exposed()).toEqual([]);
      // The check finds each of them made without its revokes, the way the owner's default privileges leave them.
      await c.query('set local role radcore_owner');
      await c.query('create table radcore.journal_lines (id int)');
      await c.query('create view radcore.journal_view as select * from radcore.journal_lines');
      // The real audit_log (RAD-30) given back an INSERT, and a month added without its revokes.
      await c.query('grant insert on radcore.audit_log to radcore_app');
      await c.query("create table radcore.audit_log_2099_01 partition of radcore.audit_log for values from ('2099-01-01') to ('2099-02-01')");
      await c.query("create table radcore.audit_log_2099_02 partition of radcore.audit_log for values from ('2099-02-01') to ('2099-03-01')");
      await c.query('revoke all on radcore.audit_log_2099_02 from radcore_app, radcore_read');
      expect(await exposed()).toEqual(['audit_log', 'audit_log_2099_01', 'journal_lines', 'journal_view']);
    });
  });

  // ADR-004 §2: the worker runs pg-boss as the app login, through lib-platform's own queue settings. Rebuilding the
  // job indexes needs their owner, so it's off there (reindex: false) and an owner task instead.
  it("runs pg-boss's queue work and maintenance as the app login", async () => {
    const boss = createJobQueue(loadConfig(testSettings({ DATABASE_URL: withPassword(appUrl ?? '') }), 'worker').database,
      { info: () => undefined, error: () => undefined });
    const errors: unknown[] = [];
    boss.on('error', (e) => errors.push(e));
    const queue = `test.logins-${randomBytes(4).toString('hex')}`;
    await boss.start();
    try {
      expect((await boss.getDb().executeSql('select current_user as login')).rows).toEqual([{ login: 'radcore_app' }]);
      await boss.createQueue(queue);
      const id = await boss.send(queue, { n: 1 });
      const [job] = await boss.fetch(queue);
      expect(job?.id).toBe(id);
      await boss.complete(queue, id ?? '');
      await boss.supervise(queue);
      expect((await boss.getJobById(queue, id ?? ''))?.state).toBe('completed');
      await boss.deleteQueue(queue);
    } finally {
      await boss.stop({ graceful: false });
    }
    expect(errors).toEqual([]);
  });
});
