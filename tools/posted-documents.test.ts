// RAD-86 part 2 (M2-03; ADR-005 §7b; RC-004) on a real PostgreSQL 16: a posted document, and its lines, are append-
// only in the database. No posted-document table exists yet (M3 onwards), so each test makes a fixture invoice and its
// lines as the owner, attaches the two generic guards the way a document's migration will, and works as the app
// login, all in one transaction that is rolled back.
import { STATE_TRANSITIONS } from '@radcore/lib-common';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

const url = process.env['TEST_DATABASE_SUPERUSER_URL'];
const appUrl = process.env['TEST_DATABASE_URL'];

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_SUPERUSER_URL is not set: in CI the posted-document tests must run, not skip');
});

describe.skipIf(!url || !appUrl)('posted documents', () => {
  const admin = new pg.Pool({ connectionString: url, max: 2 });
  const app = new pg.Pool({ connectionString: appUrl, max: 1 });
  afterAll(async () => {
    await admin.end();
    await app.end();
  });

  // A fixture invoice and its lines, guarded as an invoice's migration will guard them, in a rolled-back transaction.
  async function withInvoice(work: (run: (sql: string, values?: unknown[]) => Promise<string>, id: () => Promise<string>) => Promise<void>) {
    const c = await admin.connect();
    try {
      await c.query('begin');
      await c.query('set local role radcore_owner');
      await c.query(`create table radcore.t_invoices (id uuid primary key default gen_random_uuid(), status text not null,
        total numeric not null, total_x2 numeric generated always as (total * 2) stored, cancelled_at timestamptz,
        cancel_reason text, irn text)`);
      await c.query(`create table radcore.t_invoice_lines (id uuid primary key default gen_random_uuid(),
        invoice_id uuid not null references radcore.t_invoices (id) on delete cascade, amount numeric not null)`);
      await c.query(`create trigger guard_posted_document before insert or update or delete on radcore.t_invoices
        for each row execute function radcore.guard_posted_document('draft', 'cancelled_at,cancel_reason', 'irn')`);
      await c.query(`create trigger guard_document_line before insert or update or delete on radcore.t_invoice_lines
        for each row execute function radcore.guard_document_line('t_invoices', 'invoice_id', 'draft')`);
      await c.query("set local app.principal = 'system:test'");
      await c.query(`insert into radcore.state_transitions (document_table, from_status, to_status)
        values ('t_invoices', 'draft', 'posted'), ('t_invoices', 'posted', 'cancelled')`);
      await c.query('grant select, insert, update, delete on radcore.t_invoices, radcore.t_invoice_lines to radcore_app');
      await c.query('set local role radcore_app');
      // Each statement in a savepoint: its SQLSTATE, or 'ok'.
      const run = async (text: string, values: unknown[] = []) => {
        await c.query('savepoint s');
        try {
          await c.query(text, values);
          await c.query('release savepoint s');
          return 'ok';
        } catch (e) {
          await c.query('rollback to savepoint s');
          return (e as { code?: string }).code ?? 'error';
        }
      };
      const id = async () => (await c.query<{ id: string }>(
        "insert into radcore.t_invoices (status, total) values ('draft', 100) returning id")).rows[0]?.id ?? '';
      await work(run, id);
    } finally {
      await c.query('rollback');
      c.release();
    }
  }

  it('holds the same moves as lib-common, and is closed to the app login', async () => {
    const { rows } = await admin.query<{ document_table: string; from_status: string; to_status: string }>(
      'select document_table, from_status, to_status from radcore.state_transitions');
    expect(rows.map((r) => `${r.document_table}:${r.from_status}>${r.to_status}`).toSorted())
      .toEqual(Object.entries(STATE_TRANSITIONS).flatMap(([t, moves]) => moves.map(([f, to]) => `${t}:${f}>${to}`)).toSorted());
    const c = await app.connect();
    try {
      const refused = await c.query('select 1 from radcore.state_transitions').then(() => 'ok', (e: { code?: string }) => e.code);
      expect(refused).toBe('42501');
    } finally {
      c.release();
    }
  });

  it('refuses a move out of cancelled in the table itself, and a guard naming a column its table lacks (the auditor on #185)', async () => {
    await withInvoice(async (run, id) => {
      expect(await run("set local role radcore_owner")).toBe('ok');
      expect(await run(`insert into radcore.state_transitions (document_table, from_status, to_status)
        values ('t_invoices', 'cancelled', 'posted')`)).toBe('23514');
      expect(await run(`create trigger guard_typo before insert or update or delete on radcore.t_invoices
        for each row execute function radcore.guard_posted_document('draft', 'cancelled_on', 'irn')`)).toBe('ok');
      expect(await run(`create trigger guard_line_typo before insert or update or delete on radcore.t_invoice_lines
        for each row execute function radcore.guard_document_line('t_invoices', 'invoice', 'draft')`)).toBe('ok');
      expect(await run('set local role radcore_app')).toBe('ok');
      expect(await run("insert into radcore.t_invoices (status, total) values ('draft', 1)")).toBe('42703');
      // Take the misnamed guard off again, so a draft can be made for the line's case.
      expect(await run('set local role radcore_owner')).toBe('ok');
      expect(await run('drop trigger guard_typo on radcore.t_invoices')).toBe('ok');
      expect(await run('set local role radcore_app')).toBe('ok');
      const doc = await id();
      expect(await run('insert into radcore.t_invoice_lines (invoice_id, amount) values ($1, 1)', [doc])).toBe('42703');
    });
  });

  it('is inserted only as a draft, with its cancel and write-once columns empty', async () => {
    await withInvoice(async (run) => {
      expect(await run("insert into radcore.t_invoices (status, total) values ('posted', 100)")).toBe('RA004');
      expect(await run("insert into radcore.t_invoices (status, total, irn) values ('draft', 100, 'IRN1')")).toBe('RA004');
      expect(await run("insert into radcore.t_invoices (status, total, cancelled_at) values ('draft', 100, now())")).toBe('RA004');
      expect(await run("insert into radcore.t_invoices (status, total) values ('draft', 100)")).toBe('ok');
    });
  });

  it('lets a draft change and be deleted, lines and all, and moves only as state_transitions allows', async () => {
    await withInvoice(async (run, id) => {
      const doc = await id();
      expect(await run('insert into radcore.t_invoice_lines (invoice_id, amount) values ($1, 60), ($1, 40)', [doc])).toBe('ok');
      expect(await run('update radcore.t_invoices set total = 90 where id = $1', [doc])).toBe('ok');
      expect(await run('update radcore.t_invoice_lines set amount = 50 where invoice_id = $1', [doc])).toBe('ok');
      // No move from draft straight to cancelled is listed.
      expect(await run("update radcore.t_invoices set status = 'cancelled' where id = $1", [doc])).toBe('RA004');
      expect(await run('delete from radcore.t_invoices where id = $1', [doc])).toBe('ok');
    });
  });

  it('never edits a posted document, its lines, or deletes either (RC-004)', async () => {
    await withInvoice(async (run, id) => {
      const doc = await id();
      expect(await run('insert into radcore.t_invoice_lines (invoice_id, amount) values ($1, 100)', [doc])).toBe('ok');
      expect(await run("update radcore.t_invoices set status = 'posted' where id = $1", [doc])).toBe('ok');
      expect(await run('update radcore.t_invoices set total = 1 where id = $1', [doc])).toBe('RA004');
      expect(await run('delete from radcore.t_invoices where id = $1', [doc])).toBe('RA004');
      expect(await run("update radcore.t_invoices set status = 'draft' where id = $1", [doc])).toBe('RA004');
      expect(await run('update radcore.t_invoice_lines set amount = 1 where invoice_id = $1', [doc])).toBe('RA004');
      expect(await run('delete from radcore.t_invoice_lines where invoice_id = $1', [doc])).toBe('RA004');
      expect(await run('insert into radcore.t_invoice_lines (invoice_id, amount) values ($1, 5)', [doc])).toBe('RA004');
      // A line can't be moved off it to a draft, either.
      const other = await id();
      expect(await run('update radcore.t_invoice_lines set invoice_id = $2 where invoice_id = $1', [doc, other])).toBe('RA004');
    });
  });

  it('writes its write-once and cancel columns once: the IRN after posting, the cancel fields only as it is cancelled', async () => {
    await withInvoice(async (run, id) => {
      const doc = await id();
      expect(await run("update radcore.t_invoices set status = 'posted' where id = $1", [doc])).toBe('ok');
      expect(await run("update radcore.t_invoices set irn = 'IRN1' where id = $1", [doc])).toBe('ok');
      expect(await run("update radcore.t_invoices set irn = 'IRN2' where id = $1", [doc])).toBe('RA004');
      expect(await run("update radcore.t_invoices set cancel_reason = 'typo' where id = $1", [doc])).toBe('RA004');
      expect(await run(`update radcore.t_invoices set status = 'cancelled', cancelled_at = now(), cancel_reason = 'typo'
        where id = $1`, [doc])).toBe('ok');
      // Cancelled is final, and its cancel fields stay as written.
      expect(await run("update radcore.t_invoices set status = 'posted' where id = $1", [doc])).toBe('RA004');
      expect(await run("update radcore.t_invoices set cancel_reason = 'other' where id = $1", [doc])).toBe('RA004');
    });
  });
});
