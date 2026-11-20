// RAD-116 part 2 over the real routes (the architect's ruling; ADR-005 §9): a refusal the database finds at commit
// answers by name, 422, never 500. An allocation past what's left on a document is `exceeds_document`, and so is the
// second of two that fit alone but not together: it waits on the first's lock and is refused at its commit. The
// payment side is said first, by the service. A fixture invoice table is registered for the file and removed after
// it; it carries the who-and-when and audit triggers and a CHECK, as a document's own migration would.
import { randomUUID } from 'node:crypto';
import { openFinancialYear, recordPayment } from '@radcore/lib-accounts';
import { allocatePaymentContract, cancelPaymentContract, recordPaymentContract, reverseAllocationContract } from '@radcore/lib-accounts/contract';
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
const DOCS = 't_route_invoices';
const m = (s: string) => moneyString().parse(s);

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the allocation route tests must run, not skip');
});

describe.skipIf(!url || !superUrl)('allocations over the real routes', { timeout: 30_000 }, () => {
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  const su = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  const cfg = loadConfig(testSettings(), 'api');
  const run = <R>(fn: (ctx: Ctx) => Promise<R>) => runInTransaction(db, { readOnly: false, isolation: 'read committed' }, CLERK, randomUUID(), fn);
  async function owner<T extends pg.QueryResultRow>(text: string, values: unknown[] = [], role?: string): Promise<T[]> {
    const c = await su.connect();
    try {
      await c.query('begin');
      await c.query("set local app.principal = 'system:test'");
      if (role !== undefined) await c.query(`set local role ${role}`);
      const { rows } = await c.query<T>(text, values);
      await c.query('commit');
      return rows;
    } finally {
      c.release();
    }
  }
  const party = async () => (await owner<{ id: string }>("insert into radcore.parties (name, customer, state_code) values ($1, true, '27') returning id",
    [`Route party ${randomUUID()}`]))[0]?.id ?? '';
  const invoice = async (p: string, total: string) => (await owner<{ id: string }>(`insert into radcore.${DOCS} (party_id, status, total)
    values ($1, 'posted', $2) returning id`, [p, total]))[0]?.id ?? '';
  const bank = async () => (await su.query<{ id: string }>("select id from radcore.accounts where system_key = 'bank'")).rows[0]?.id ?? '';
  const receipt = async (p: string, amount: string) => {
    const accountId = await bank();
    return (await run((ctx) => recordPayment(ctx, { kind: 'receipt', partyId: p, businessDate: DAY, amount: m(amount), accountId }))).id;
  };

  beforeAll(async () => {
    await run((ctx) => openFinancialYear(ctx, DAY));
    // Made as the owner, as a migration's table is, so logins.test.ts, running alongside, finds nothing else's.
    await owner(`create table radcore.${DOCS} (id uuid primary key default gen_random_uuid(), party_id uuid not null, status text not null,
      total numeric(18,2) not null constraint ck_${DOCS}_total check (total >= 0), business_date date not null default '2026-11-12',
      created_at timestamptz not null default now(), created_by text not null default 'system:test',
      updated_at timestamptz not null default now(), updated_by text not null default 'system:test')`, [], 'radcore_owner');
    await owner(`select radcore.audit_attach('${DOCS}', keep => array['party_id', 'status', 'total', 'business_date'])`);
    await owner(`grant select, insert, update on radcore.${DOCS} to radcore_app`);
    await owner(`create trigger guard_applied_cancel before update of status on radcore.${DOCS}
      for each row execute function radcore.guard_applied_cancel()`);
    await owner(`insert into radcore.allocatable_documents (document_table, side, kind) values ('${DOCS}', 'receivable', 'charge')`);
  });
  afterAll(async () => {
    const c = await su.connect();
    try {
      await c.query('begin');
      await c.query('set local session_replication_role = replica');
      await c.query('delete from radcore.payment_allocations where document_table = $1', [DOCS]);
      await c.query('delete from radcore.allocatable_documents where document_table = $1', [DOCS]);
      await c.query(`drop table radcore.${DOCS}`);
      await c.query('commit');
    } finally {
      c.release();
    }
    await pool.end();
    await su.end();
  });

  /** Sends one input to a contract through the real api, and answers its status and code. */
  async function send(contract: Contract, input: unknown, server: { port: number }): Promise<[number, string | undefined]> {
    const sent = requestFor(contract, input);
    const res = await fetch(`http://127.0.0.1:${server.port}${sent.path}`, { method: sent.method, body: sent.body ?? null,
      headers: { 'content-type': 'application/json', origin: cfg.publicOrigin, 'sec-fetch-site': 'same-origin', 'idempotency-key': randomUUID() } });
    return [res.status, ((await res.json()) as { code?: string }).code];
  }
  async function api<T>(fn: (server: { port: number }) => Promise<T>): Promise<T> {
    const server = await listen(createApp(cfg, { info: vi.fn(), error: vi.fn() }, { db, authenticate: async () => CLERK, routes: accountRoutes }),
      0, '127.0.0.1');
    try {
      return await fn(server);
    } finally {
      await server.stop();
    }
  }
  const lines = (doc: string, amount: string) => [{ documentTable: DOCS, documentId: doc, amount }];
  const allocate = (id: string, doc: string, amount: string) => ({ id, businessDate: DAY, lines: lines(doc, amount) });
  const undo = (id: string | undefined, businessDate = DAY) => ({ id, businessDate, reason: 'Applied to the wrong invoice' });

  it('answers an allocation past what’s left on a document with 422 exceeds_document, found at commit', async () => {
    const p = await party();
    const inv = await invoice(p, '100.00');
    const r = await receipt(p, '150.00');
    await api(async (server) => {
      expect(await send(allocatePaymentContract, allocate(r, inv, '120.00'), server)).toEqual([422, 'exceeds_document']);
      expect(await send(allocatePaymentContract, allocate(r, inv, '100.00'), server)).toEqual([200, undefined]);
    });
  });

  it('answers the second of two allocations that fit alone but not together with 422 exceeds_document', async () => {
    const p = await party();
    const inv = await invoice(p, '100.00');
    const [r1, r2] = [await receipt(p, '60.00'), await receipt(p, '60.00')];
    await api(async (server) => {
      const both = await Promise.all([send(allocatePaymentContract, allocate(r1, inv, '60.00'), server),
        send(allocatePaymentContract, allocate(r2, inv, '60.00'), server)]);
      expect(both.map(([status]) => status).toSorted()).toEqual([200, 422]);
      expect(both.find(([status]) => status === 422)?.[1]).toBe('exceeds_document');
    });
  });

  it('says the payment side first, and answers a reversal twice, a cancel still applied and a refund past what’s left, by name', async () => {
    const p = await party();
    const inv = await invoice(p, '500.00');
    const r = await receipt(p, '100.00');
    await api(async (server) => {
      expect(await send(allocatePaymentContract, allocate(r, inv, '100.01'), server)).toEqual([422, 'exceeds_payment']);
      const [, okCode] = await send(allocatePaymentContract, allocate(r, inv, '70.00'), server);
      expect(okCode).toBeUndefined();
      const [row] = await su.query<{ id: string }>("select id from radcore.payment_allocations where payment_id = $1 and direction = 'apply'", [r])
        .then((x) => x.rows);
      expect(await send(cancelPaymentContract, { id: r, businessDate: DAY, reason: 'Bounced' }, server)).toEqual([422, 'has_allocations']);
      expect(await send(recordPaymentContract, { kind: 'refund', partyId: p, businessDate: DAY, amount: '30.01', accountId: await bank(),
        refundOf: r }, server)).toEqual([422, 'exceeds_receipt']);
      expect(await send(reverseAllocationContract, undo(row?.id, '2026-11-11'), server)).toEqual([422, 'date_before_source']);
      expect(await send(reverseAllocationContract, undo(row?.id, '2099-01-01'), server)).toEqual([422, 'date_in_future']);
      expect(await send(reverseAllocationContract, undo(row?.id), server)).toEqual([200, undefined]);
      expect(await send(reverseAllocationContract, undo(row?.id), server)).toEqual([422, 'already_reversed']);
      const why = `select r.reason from radcore.audit_log a join radcore.change_reasons r on r.id = a.reason_id
        where a.table_name = 'payment_allocations' and a.record_id = (select id::text from radcore.payment_allocations where reverses_id = $1)`;
      expect((await su.query(why, [row?.id])).rows).toEqual([{ reason: 'Applied to the wrong invoice' }]);
      expect(await send(cancelPaymentContract, { id: r, businessDate: DAY, reason: 'Bounced' }, server)).toEqual([200, undefined]);
    });
  });

  it('dates an allocation on or after its payment, said first, and its document, found at commit', async () => {
    const p = await party();
    const later = (await owner<{ id: string }>(`insert into radcore.${DOCS} (party_id, status, total, business_date) values ($1, 'posted', '10.00',
      '2026-11-13') returning id`, [p]))[0]?.id ?? '';
    const inv = await invoice(p, '10.00');
    const r = await receipt(p, '20.00');
    await api(async (server) => {
      expect(await send(allocatePaymentContract, { ...allocate(r, inv, '1.00'), businessDate: '2026-11-11' }, server)).toEqual([422, 'date_before_source']);
      expect(await send(allocatePaymentContract, allocate(r, later, '1.00'), server)).toEqual([422, 'date_before_source']);
      expect(await send(allocatePaymentContract, { ...allocate(r, later, '1.00'), businessDate: '2026-11-13' }, server)).toEqual([200, undefined]);
    });
  });

  it('makes the second allocation wait on the first’s lock on the document, and refuses it once the first commits', async () => {
    const p = await party();
    const inv = await invoice(p, '100.00');
    const [r1, r2] = [await receipt(p, '60.00'), await receipt(p, '60.00')];
    const [a, b] = [await pool.connect(), await pool.connect()];
    const ins = `insert into radcore.payment_allocations (payment_id, document_table, document_id, direction, amount, business_date)
      values ($1, $2, $3, 'apply', '60.00', '${DAY}')`;
    try {
      for (const c of [a, b]) {
        await c.query('begin');
        await c.query("set local app.principal = 'system:test'");
      }
      await a.query(ins, [r1, DOCS, inv]);
      await a.query('set constraints all immediate');
      const pid = (await b.query<{ pid: number }>('select pg_backend_pid() pid')).rows[0]?.pid;
      await b.query(ins, [r2, DOCS, inv]);
      const second = b.query('set constraints all immediate').then(() => 'ok', (e: { code?: string; constraint?: string }) => `${e.code}:${e.constraint}`);
      await vi.waitFor(async () => expect((await su.query<{ w: string | null }>('select wait_event_type w from pg_stat_activity where pid = $1', [pid]))
        .rows[0]?.w).toBe('Lock'), { timeout: 5000 });
      await a.query('commit');
      expect(await second).toBe('RA006:allocation_exceeds_document');
    } finally {
      await a.query('rollback').catch(() => undefined);
      await b.query('rollback').catch(() => undefined);
      a.release();
      b.release();
    }
  });
});
