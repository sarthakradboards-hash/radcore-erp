// RAD-24 (M1-06, RC-003, RC-193, ADR-005 §7c): the three logins on a real PostgreSQL. The owner owns everything the
// migrations made; the app login reads and writes rows but changes no structure and rewrites no ledger; the read-only
// login only reads. Each test acts as a login with SET ROLE inside a transaction it rolls back, so it leaves nothing.
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { describe, expect, it } from 'vitest';

const url = process.env['TEST_DATABASE_URL'];

// ADR-005 §7's append-only tables, exactly. A partition counts as its parent.
const APPEND_ONLY = ['journal_entries', 'journal_lines', 'stock_movements', 'unit_events', 'payment_allocations',
  'credit_applications', 'audit_log', 'access_log', 'event_log', 'webhook_delivery_attempts'];
// Written only by triggers and record_access, never by an INSERT from the app.
const NO_INSERT = ['audit_log', 'access_log'];

// Anything in radcore the app login could change that it must not: an append-only table it can update, delete or
// truncate, a log it can insert into, or a view it can write through (a simple view writes as its owner).
const WRITABLE = `
  select c.relname from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_inherits i on i.inhrelid = c.oid
  left join pg_class p on p.oid = i.inhparent
  where n.nspname = 'radcore' and (
    (coalesce(p.relname, c.relname) = any($1) and c.relkind in ('r', 'p')
      and has_table_privilege('radcore_app', c.oid, 'UPDATE, DELETE, TRUNCATE'))
    or (coalesce(p.relname, c.relname) = any($2) and has_table_privilege('radcore_app', c.oid, 'INSERT'))
    or (c.relkind in ('v', 'm') and has_table_privilege('radcore_app', c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE')))
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
        temp: 'create temp table t (x int)',
      })).toEqual({ select: 'ok', insert: DENIED, update: DENIED, delete: DENIED, queue: DENIED, temp: DENIED });
    });
  });

  it('leave no append-only table, log or view writable by the app login', async () => {
    await inRollback(async (c) => {
      expect((await c.query(WRITABLE, [APPEND_ONLY, NO_INSERT])).rows).toEqual([]);
      // The check finds an append-only table, a log and a view made without their revokes.
      await c.query('set local role radcore_owner');
      await c.query('create table radcore.journal_lines (id int)');
      await c.query('create table radcore.audit_log (id int)');
      await c.query('revoke update, delete, truncate on radcore.audit_log from radcore_app');
      await c.query('create view radcore.journal_view as select * from radcore.journal_lines');
      expect((await c.query(WRITABLE, [APPEND_ONLY, NO_INSERT])).rows.map((r: { relname: string }) => r.relname))
        .toEqual(['audit_log', 'journal_lines', 'journal_view']);
    });
  });

  // ADR-004 §2: the worker runs pg-boss as the app login, so its queue work, maintenance included, needs no DDL.
  it("runs pg-boss's queue work as the app login", async () => {
    const u = new URL(url ?? '');
    u.searchParams.set('options', '-c role=radcore_app');
    const boss = new PgBoss({ connectionString: u.toString(), schema: 'pgboss', migrate: false, createSchema: false,
      supervise: false, schedule: false });
    const errors: unknown[] = [];
    boss.on('error', (e) => errors.push(e));
    const queue = `test.logins-${randomBytes(4).toString('hex')}`;
    await boss.start();
    try {
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
