// Refunds of a credit note (RAD-114, the architect's ruling and build rules; ADR-007 §6, ADR-005 §7a, §9) on a real
// PostgreSQL. A refund names exactly one source, a receipt or a credit; a credit's is checked by the database when it
// posts, under the credit's lock, each rule by name, and its applications and posted refunds share its total. The
// credit's lock comes when the refund is written, before the cash limit takes the party (ADR-006 §1). Fixture credit
// and charge tables are made as the owner, as a migration's are, registered for the file and removed after it.
import { randomUUID } from 'node:crypto';
import { applyCredit, openFinancialYear, refundCredit } from '@radcore/lib-accounts';
import { cashLimitApproval, recordPaymentContract } from '@radcore/lib-accounts/contract';
import { moneyString, requestFor, type Contract } from '@radcore/lib-common';
import { loadConfig, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import { testSettings } from '@radcore/test-helpers';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp, listen } from '../apps/api/src/app.ts';
import accountRoutes from '../apps/api/src/routes/accounts.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const CLERK: Principal = { kind: 'user', userId: randomUUID(), permissions: ['payments:write'] };
const DAY = '2026-11-12';
const CREDITS = 't_refund_credits';
const DEBITS = 't_refund_debits';
const INVOICES = 't_refund_invoices';
const m = (s: string) => moneyString().parse(s);

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the credit refund tests must run, not skip');
});

describe.skipIf(!url || !superUrl)('refunds of a credit note', { timeout: 30_000 }, () => {
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  const su = new pg.Pool({ connectionString: superUrl, max: 2 });
  const db = createDatabase(pool);
  const cfg = loadConfig(testSettings(), 'api');
  const as = (p: Principal) => <R>(fn: (ctx: Ctx) => Promise<R>) => runInTransaction(db, { readOnly: false, isolation: 'read committed' }, p,
    randomUUID(), fn);
  const run = as(CLERK);
  async function owner<T extends pg.QueryResultRow>(text: string, values: unknown[] = [], role?: string): Promise<T[]> {
    const c = await su.connect();
    try {
      await c.query('begin');
      await c.query("set local app.principal = 'system:test'");
      if (role !== undefined) await c.query(`set local role ${role}`);
      const { rows } = await c.query<T>(text, values);
      await c.query('commit');
      return rows;
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
  }
  const party = async () => (await owner<{ id: string }>("insert into radcore.parties (name, customer, supplier, state_code) values ($1, true, true, '27') returning id",
    [`Refund party ${randomUUID()}`]))[0]?.id ?? '';
  const doc = async (table: string, p: string, total: string, o: { status?: string; date?: string } = {}) => (await owner<{ id: string }>(
    `insert into radcore.${table} (party_id, status, total, business_date) values ($1, $2, $3, $4) returning id`,
    [p, o.status ?? 'posted', total, o.date ?? DAY]))[0]?.id ?? '';
  const account = async (key: string) => (await su.query<{ id: string }>('select id from radcore.accounts where system_key = $1', [key])).rows[0]?.id ?? '';
  const applied = (credit: string, invoice: string, amount: string) => owner(`insert into radcore.credit_applications (credit_table, credit_id,
    document_table, document_id, direction, amount, business_date) values ($1, $2, $3, $4, 'apply', $5, $6)`, [CREDITS, credit, INVOICES, invoice, amount, DAY]);

  beforeAll(async () => {
    await run((ctx) => openFinancialYear(ctx, DAY));
    for (const t of [CREDITS, DEBITS, INVOICES]) {
      await owner(`create table radcore.${t} (id uuid primary key default gen_random_uuid(), party_id uuid not null, status text not null,
        -- The CHECK every money column has, by its name (ADR-005 §1), so tools/schema.test.ts's v_schema_numeric_without_check,
        -- run at the same time, doesn't find these fixtures (the auditor on RAD-151).
        total numeric(18,2) not null constraint ck_${t}_total check (total >= 0 and total <> 'NaN'), business_date date not null,
        created_at timestamptz not null default now(), created_by text not null default 'system:test',
        updated_at timestamptz not null default now(), updated_by text not null default 'system:test')`, [], 'radcore_owner');
      await owner(`select radcore.audit_attach('${t}', keep => array['party_id', 'status', 'total', 'business_date'])`);
      await owner(`grant select, insert, update on radcore.${t} to radcore_app`);
      await owner(`create trigger guard_applied_cancel before update of status on radcore.${t}
        for each row execute function radcore.guard_applied_cancel()`);
    }
    await owner(`insert into radcore.allocatable_documents (document_table, side, kind) values ('${CREDITS}', 'receivable', 'credit'),
      ('${DEBITS}', 'payable', 'credit'), ('${INVOICES}', 'receivable', 'charge')`);
  });
  afterAll(async () => {
    const c = await su.connect();
    try {
      await c.query('begin');
      await c.query('set local session_replication_role = replica');
      await c.query('delete from radcore.credit_applications where credit_table = $1', [CREDITS]);
      await c.query('update radcore.payments set credit_table = null, credit_id = null, refund_of_id = id, kind = kind where credit_table = any($1)',
        [[CREDITS, DEBITS]]);
      await c.query('delete from radcore.allocatable_documents where document_table = any($1)', [[CREDITS, DEBITS, INVOICES]]);
      for (const t of [CREDITS, DEBITS, INVOICES]) await c.query(`drop table radcore.${t}`);
      await c.query('commit');
    } finally {
      c.release();
    }
    await pool.end();
    await su.end();
  });

  async function api<T>(principal: Principal, fn: (send: (c: Contract, input: unknown) => Promise<[number, string | undefined]>) => Promise<T>) {
    const server = await listen(createApp(cfg, { info: vi.fn(), error: vi.fn() }, { db, authenticate: async () => principal, routes: accountRoutes }),
      0, '127.0.0.1');
    try {
      return await fn(async (contract, input) => {
        const sent = requestFor(contract, input);
        const res = await fetch(`http://127.0.0.1:${server.port}${sent.path}`, { method: sent.method, body: sent.body ?? null,
          headers: { 'content-type': 'application/json', origin: cfg.publicOrigin, 'sec-fetch-site': 'same-origin', 'idempotency-key': randomUUID() } });
        return [res.status, ((await res.json()) as { code?: string }).code];
      });
    } finally {
      await server.stop();
    }
  }

  it('refunds what’s left of a credit note, and refuses each wrong one by name over the real route', async () => {
    const [p, q] = [await party(), await party()];
    const bank = await account('bank');
    const credit = await doc(CREDITS, p, '100.00');
    await applied(credit, await doc(INVOICES, p, '500.00'), '30.00');
    const refund = (o: { credit?: { table: string; id: string }; partyId?: string; amount?: string; businessDate?: string; refundOf?: string }) =>
      ({ kind: 'refund', partyId: o.partyId ?? p, businessDate: o.businessDate ?? DAY, amount: o.amount ?? '1.00', accountId: bank,
        ...(o.credit === undefined && o.refundOf === undefined ? { credit: { table: CREDITS, id: credit } } : {}),
        ...(o.credit === undefined ? {} : { credit: o.credit }), ...(o.refundOf === undefined ? {} : { refundOf: o.refundOf }) });
    await api(CLERK, async (send) => {
      expect(await send(recordPaymentContract, refund({ credit: { table: CREDITS, id: await doc(CREDITS, p, '10.00', { status: 'draft' }) } })))
        .toEqual([422, 'credit_not_posted']);
      expect(await send(recordPaymentContract, refund({ partyId: q }))).toEqual([422, 'refund_other_party']);
      expect(await send(recordPaymentContract, refund({ businessDate: '2026-11-11' }))).toEqual([422, 'date_before_source']);
      expect(await send(recordPaymentContract, refund({ credit: { table: DEBITS, id: await doc(DEBITS, p, '10.00') } }))).toEqual([422, 'wrong_credit']);
      expect(await send(recordPaymentContract, refund({ credit: { table: INVOICES, id: await doc(INVOICES, p, '10.00') } }))).toEqual([422, 'wrong_credit']);
      expect(await send(recordPaymentContract, refund({ credit: { table: CREDITS, id: randomUUID() } }))).toEqual([422, 'wrong_credit']);
      expect(await send(recordPaymentContract, refund({ credit: { table: 'payments', id: randomUUID() } }))).toEqual([422, 'wrong_credit']);
      expect(await send(recordPaymentContract, refund({ credit: { table: CREDITS, id: credit }, refundOf: randomUUID() })))
        .toEqual([422, 'refund_needs_receipt']);
      // 30 applied, so 70 is left to refund, and no more.
      expect(await send(recordPaymentContract, refund({ amount: '70.01' }))).toEqual([422, 'exceeds_credit']);
      expect(await send(recordPaymentContract, refund({ amount: '70.00' }))).toEqual([200, undefined]);
      expect(await send(recordPaymentContract, refund({ amount: '0.01' }))).toEqual([422, 'exceeds_credit']);
    });
    // The note can't be cancelled while a refund names it.
    expect(await owner(`update radcore.${CREDITS} set status = 'cancelled' where id = $1`, [credit]).then(() => 'ok',
      (e: { constraint?: string }) => e.constraint)).toBe('document_still_applied');
  });

  it('makes a refund and an application of one credit take turns: the second waits on the first, then is refused if it’s over', async () => {
    const p = await party();
    const credit = await doc(CREDITS, p, '100.00');
    const invoice = await doc(INVOICES, p, '500.00');
    const app = await su.connect();
    try {
      await app.query('begin');
      await app.query("set local app.principal = 'system:test'");
      await app.query(`insert into radcore.credit_applications (credit_table, credit_id, document_table, document_id, direction, amount, business_date)
        values ($1, $2, $3, $4, 'apply', '60.00', $5)`, [CREDITS, credit, INVOICES, invoice, DAY]);
      await app.query('set constraints all immediate');
      const pid = (await app.query<{ pid: number }>('select pg_backend_pid() pid')).rows[0]?.pid;
      const bank = await account('bank');
      const refunded = run((ctx) => refundCredit(ctx, { creditTable: CREDITS, creditId: credit, partyId: p, businessDate: DAY, amount: m('50.00'),
        accountId: bank })).then(() => 'ok', (e: unknown) => String((e as { cause?: { constraint?: string } }).cause?.constraint
        ?? (e as { constraint?: string }).constraint ?? e));
      await vi.waitFor(async () => expect((await su.query<{ n: number }>(
        'select count(*)::int n from pg_stat_activity where $1 = any(pg_blocking_pids(pid))', [pid])).rows[0]?.n).toBe(1), { timeout: 10_000 });
      await app.query('commit');
      expect(await refunded).toBe('refund_exceeds_credit');
    } finally {
      await app.query('rollback').catch(() => undefined);
      app.release();
    }
  });

  it('applies and refunds one credit at once without a deadlock, the two within its total', async () => {
    const p = await party();
    const credit = await doc(CREDITS, p, '100.00');
    const invoice = await doc(INVOICES, p, '500.00');
    const bank = await account('bank');
    const both = await Promise.allSettled([
      run((ctx) => applyCredit(ctx, { creditTable: CREDITS, creditId: credit, documentTable: INVOICES, documentId: invoice, amount: m('40.00'),
        businessDate: DAY })),
      run((ctx) => refundCredit(ctx, { creditTable: CREDITS, creditId: credit, partyId: p, businessDate: DAY, amount: m('40.00'), accountId: bank })),
    ]);
    expect(both.map((b) => (b.status === 'fulfilled' ? 'ok' : String(b.reason)))).toEqual(['ok', 'ok']);
    expect((await su.query<{ u: string }>('select radcore.credit_used($1, $2)::text u', [CREDITS, credit])).rows).toEqual([{ u: '80.00' }]);
  });

  it('locks the credit before the party: a cancel that holds the note, then the party, never deadlocks a cash refund', async () => {
    const p = await party();
    const credit = await doc(CREDITS, p, '100.00');
    const cash = await account('cash');
    const cancel = await su.connect();
    try {
      await cancel.query('begin');
      await cancel.query("set local app.principal = 'system:test'");
      await cancel.query(`select id from radcore.${CREDITS} where id = $1 for update`, [credit]);
      const pid = (await cancel.query<{ pid: number }>('select pg_backend_pid() pid')).rows[0]?.pid;
      const refunded = run((ctx) => refundCredit(ctx, { creditTable: CREDITS, creditId: credit, partyId: p, businessDate: DAY, amount: m('10.00'),
        accountId: cash })).then((r) => r.status, (e: unknown) => String((e as { code?: string }).code ?? e));
      await vi.waitFor(async () => expect((await su.query<{ n: number }>(
        'select count(*)::int n from pg_stat_activity where $1 = any(pg_blocking_pids(pid))', [pid])).rows[0]?.n).toBe(1), { timeout: 10_000 });
      // The refund waits on the note before it holds the party, so the cancel takes the party without waiting.
      const held = await cancel.query('select id from radcore.parties where id = $1 for no key update', [p]).then(() => 'ok',
        (e: { code?: string }) => e.code);
      await cancel.query('commit');
      expect([held, await refunded]).toEqual(['ok', 'posted']);
    } finally {
      await cancel.query('rollback').catch(() => undefined);
      cancel.release();
    }
  });

  it('checks a cash refund that waited for approval again when it posts, and answers an over-refund by name', async () => {
    const c = await su.connect();
    let ownerId = '';
    try {
      await c.query('begin');
      await c.query("set local app.principal = 'system:test'");
      ownerId = (await c.query<{ id: string }>("insert into radcore.users (email, display_name, role) values ($1, 'Owner', 'owner') returning id",
        [`${randomUUID()}@example.test`])).rows[0]?.id ?? '';
      await c.query('commit');
    } finally {
      c.release();
    }
    const p = await party();
    const credit = await doc(CREDITS, p, '20000.00');
    const waiting = await run(async (ctx) => refundCredit(ctx, { creditTable: CREDITS, creditId: credit, partyId: p, businessDate: DAY,
      amount: m('12000.00'), accountId: await account('cash') }));
    expect(waiting).toMatchObject({ status: 'pending_approval' });
    await applied(credit, await doc(INVOICES, p, '50000.00'), '10000.00');
    const [request] = (await su.query<{ id: string; version_digest: string }>(
      "select id, version_digest from radcore.approvals where kind = 'cash-limit' and record_id = $1", [waiting.id])).rows;
    const approver: Principal = { kind: 'user', userId: ownerId, permissions: ['payments:approve'] };
    await api(approver, async (send) => {
      expect(await send(cashLimitApproval.decide, { id: request?.id, decision: 'approve', versionHash: request?.version_digest }))
        .toEqual([422, 'exceeds_credit']);
    });
    expect((await su.query('select status from radcore.payments where id = $1', [waiting.id])).rows).toEqual([{ status: 'draft' }]);
  });
});
