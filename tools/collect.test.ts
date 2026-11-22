// RAD-119 (M3-15) on a real PostgreSQL: a party's statement and the To collect list, read from the journal's Debtors
// lines and what's been allocated to each bill. A fixture invoice table, made as the owner and registered as a
// receivable charge, stands in for lib-sales' invoices; each invoice's entry posts Dr Debtors, Cr Sales. Its dates are
// in the past, so with no credit days both are overdue whatever the run date (RC-156).
import { randomUUID } from 'node:crypto';
import {
  allocatePayment, openFinancialYear, partyStatement, postEntry, recordPayment, remindersPage, setCreditTerms, toCollectPage,
} from '@radcore/lib-accounts';
import { getPartyStatement, recordReminder } from '@radcore/lib-accounts/contract';
import { remindWithLink } from '@radcore/lib-sales';
import { moneyString, requestFor } from '@radcore/lib-common';
import { loadConfig, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import { testSettings } from '@radcore/test-helpers';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp, listen } from '../apps/api/src/app.ts';
import accountRoutes from '../apps/api/src/routes/accounts.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const CLERK: Principal = { kind: 'user', userId: randomUUID(), permissions: ['payments:write', 'receivables:read', 'receivables:remind'] };
const INVOICES = 't_collect_invoices';
const m = (s: string) => moneyString().parse(s);

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the To collect tests must run, not skip');
});

describe.skipIf(!url || !superUrl)('what parties owe', { timeout: 30_000 }, () => {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  const su = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  const cfg = loadConfig(testSettings(), 'api');
  const run = <R>(fn: (ctx: Ctx) => Promise<R>, p: Principal = CLERK) =>
    runInTransaction(db, { readOnly: false, isolation: 'read committed' }, p, randomUUID(), fn);
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
  /** A party of its own, managed by `manager` (`user:<id>`), or by no one. */
  const managedParty = async (manager: string | null) => {
    const rows = await owner<{ id: string }>("insert into radcore.parties (name, customer, state_code) values ($1, true, '27') returning id",
      [`Scoped party ${randomUUID()}`]);
    if (manager !== null) await owner('insert into radcore.party_managers (party_id, owner) values ($1, $2)', [rows[0]?.id, manager]);
    return rows;
  };
  const bank = async () => (await su.query<{ id: string }>("select id from radcore.accounts where system_key = 'bank'")).rows[0]?.id ?? '';
  /** An invoice of `total` to the party, dated `on`: its fixture row, and its entry, Dr Debtors, Cr Sales. */
  const invoice = async (partyId: string, on: string, total: string) => {
    const [row] = await owner<{ id: string }>(`insert into radcore.${INVOICES} (party_id, status, total, business_date) values ($1, 'posted', $2, $3)
      returning id`, [partyId, total, on]);
    const id = row?.id ?? '';
    await run((ctx) => postEntry(ctx, { kind: 'invoice', businessDate: on, source: { table: INVOICES, id },
      lines: [{ account: { system: 'debtors' }, partyId, debit: m(total) }, { account: { system: 'sales' }, credit: m(total) }] }));
    return id;
  };
  const receipt = async (partyId: string, on: string, amount: string) => {
    const accountId = await bank();
    return (await run((ctx) => recordPayment(ctx, { kind: 'receipt', partyId, businessDate: on, amount: m(amount), accountId }))).id;
  };

  beforeAll(async () => {
    await run((ctx) => openFinancialYear(ctx, '2026-04-10'));
    await owner(`create table radcore.${INVOICES} (id uuid primary key default gen_random_uuid(), party_id uuid not null, status text not null,
      total numeric(18,2) not null, business_date date not null,
      created_at timestamptz not null default now(), created_by text not null default 'system:test',
      updated_at timestamptz not null default now(), updated_by text not null default 'system:test')`, [], 'radcore_owner');
    await owner(`select radcore.audit_attach('${INVOICES}', keep => array['party_id', 'status', 'total', 'business_date'])`);
    await owner(`grant select, insert, update on radcore.${INVOICES} to radcore_app`);
    await owner(`create trigger guard_applied_cancel before update of status on radcore.${INVOICES}
      for each row execute function radcore.guard_applied_cancel()`);
    await owner(`insert into radcore.allocatable_documents (document_table, side, kind) values ('${INVOICES}', 'receivable', 'charge')`);
  });
  afterAll(async () => {
    const c = await su.connect();
    try {
      await c.query('begin');
      await c.query('set local session_replication_role = replica');
      await c.query('delete from radcore.payment_allocations where document_table = $1', [INVOICES]);
      await c.query("update radcore.journal_entries set source_table = 'journal_entries', source_id = id where source_table = $1", [INVOICES]);
      await c.query('delete from radcore.allocatable_documents where document_table = $1', [INVOICES]);
      await c.query(`drop table radcore.${INVOICES}`);
      await c.query('commit');
    } finally {
      c.release();
    }
    await pool.end();
    await su.end();
  });

  it('reads a party’s statement and what there is to collect from its Debtors lines and what’s allocated to each bill', async () => {
    const [p] = await owner<{ id: string }>(`insert into radcore.parties (name, customer, state_code, credit_days) values ($1, true, '27', 365)
      returning id`, [`Owing party ${randomUUID()}`]);
    const party = p?.id ?? '';
    const early = await invoice(party, '2026-04-10', '100.00');
    const late = await invoice(party, '2026-11-12', '50.00');
    const advance = await receipt(party, '2026-11-12', '30.00');
    const paid = await receipt(party, '2026-11-12', '40.00');
    await run((ctx) => allocatePayment(ctx, { id: paid, businessDate: '2026-11-12', lines: [{ documentTable: INVOICES, documentId: early,
      amount: m('40.00') }] }));
    const s = await run((ctx) => partyStatement(ctx, { id: party, from: '2026-04-01', to: '2026-11-30' }));
    expect([s.opening, s.closing, s.lines.map((l) => [l.kind, l.debit, l.credit, l.balance])]).toEqual(['0.00', '80.00', [
      ['invoice', '100.00', '0.00', '100.00'], ['invoice', '50.00', '0.00', '150.00'], ['payment_in', '0.00', '30.00', '120.00'],
      ['payment_in', '0.00', '40.00', '80.00']]]);
    // Each bill is due its party's 365 days after its date; the advance of 30 is on no bill.
    expect(s.openBills.map((b) => [b.id, b.amount, b.paid, b.open, b.due])).toEqual([[early, '100.00', '40.00', '60.00', '2027-04-10'],
      [late, '50.00', '0.00', '50.00', '2027-11-12']]);
    expect(s.toCollect).toMatchObject({ outstanding: '80.00', notOnABill: '-30.00' });
    // With no credit days, both are overdue, the April one first; the range starts with the balance before it.
    await owner('update radcore.parties set credit_days = 0 where id = $1', [party]);
    const again = await run((ctx) => partyStatement(ctx, { id: party, from: '2026-11-01', to: '2026-11-30' }));
    expect(again.toCollect).toEqual({ outstanding: '80.00', overdue: '110.00', oldestDue: '2026-04-10', notOnABill: '-30.00' });
    expect([again.opening, again.lines.length]).toEqual(['100.00', 3]);
    expect(advance).toEqual(expect.any(String));
    // The To collect list has the party, with the same figures.
    const found = async (after?: string): Promise<unknown> => {
      const page = await run((ctx) => toCollectPage(ctx, { filter: {}, limit: 200, ...(after === undefined ? {} : { after }) }));
      return page.items.find((i) => i.partyId === party) ?? (page.next === null ? undefined : found(page.next));
    };
    expect(await found()).toMatchObject({ outstanding: '80.00', overdue: '110.00', notOnABill: '-30.00', lastReminderAt: null });
    // A reminder records the amounts as they are, answers with its text, and shows on the list.
    const sent = await run((ctx) => remindWithLink(ctx, { id: party, channel: 'whatsapp', note: 'Asked for the April bill' }));
    expect(sent).toMatchObject({ outstanding: '80.00', overdue: '110.00', oldestDue: '2026-04-10', channel: 'whatsapp' });
    expect(sent.text).toMatch(/80\.00 is outstanding, of which .*110\.00 has been due since/);
    // The fixture's bills aren't invoices, so there's nothing to link (RAD-118's links are invoices').
    expect([sent.link, sent.noLink]).toEqual([null, 'not_an_invoice']);
    const listed = await run((ctx) => remindersPage(ctx, { id: party, filter: {}, limit: 10 }));
    expect(listed.items.map((r) => [r.id, r.overdue, r.by.id])).toEqual([[sent.id, '110.00', CLERK.userId]]);
    expect(await found()).toMatchObject({ lastReminderAt: sent.asAt });
    // It's append-only (ADR-005 §7).
    for (const change of ['update radcore.payment_reminders set note = null where id = $1', 'delete from radcore.payment_reminders where id = $1']) {
      expect(await owner(change, [sent.id]).then(() => 'ok', (e: { code?: string }) => e.code)).toBe('RA001');
    }
  });

  it('at own, shows and reminds only the parties a person manages; managers are set under parties:manage (the architect on RAD-119)', async () => {
    const me = randomUUID();
    const keys = ['receivables:read', 'receivables:remind'];
    const SALES: Principal = { kind: 'user', userId: me, permissions: keys, ownScope: keys };
    const owing = async (manager: string | null) => {
      const [p] = await managedParty(manager);
      await invoice(p?.id ?? '', '2026-11-12', '75.00');
      return p?.id ?? '';
    };
    const mine = await owing(`user:${me}`);
    const theirs = await owing(`user:${randomUUID()}`);
    const unassigned = await owing(null);
    const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => String((e as { code?: string }).code ?? e));
    const listed = async (after?: string): Promise<string[]> => {
      const page = await run((ctx) => toCollectPage(ctx, { filter: {}, limit: 200, ...(after === undefined ? {} : { after }) }), SALES);
      return [...page.items.map((i) => i.partyId), ...(page.next === null ? [] : await listed(page.next))];
    };
    const seen = await listed();
    expect([seen.includes(mine), seen.includes(theirs), seen.includes(unassigned)]).toEqual([true, false, false]);
    const statementOf = (id: string) => code(run((ctx) => partyStatement(ctx, { id, from: '2026-11-01', to: '2026-11-30' }), SALES));
    expect([await statementOf(mine), await statementOf(theirs), await statementOf(unassigned)]).toEqual(['ok', 'not_found', 'not_found']);
    const remindOf = (id: string) => code(run((ctx) => remindWithLink(ctx, { id, channel: 'phone' }), SALES));
    expect([await remindOf(mine), await remindOf(theirs)]).toEqual(['ok', 'not_found']);
    expect(await code(run((ctx) => remindersPage(ctx, { id: theirs, filter: {}, limit: 10 }), SALES))).toBe('not_found');
    // Who manages a party is set under parties:manage, and then they see it.
    const assign = (p: Principal, who = me) => code(run((ctx) => setCreditTerms(ctx, { id: unassigned, creditDays: null, creditLimit: null,
      accountManager: who, reason: 'Ravi looks after this dealer' }), p));
    expect(await assign(SALES)).toBe('forbidden');
    const manager: Principal = { kind: 'user', userId: randomUUID(), permissions: ['parties:manage'] };
    // Only a person with an account, switched on, manages a party (the auditor on #276).
    expect(await assign(manager)).toBe('unknown_user');
    // An account that's switched off is no manager either (the auditor's NIT on #276).
    const off = randomUUID();
    await owner(`insert into radcore.users (id, email, display_name, status, password_hash, role) values ($1, $2, 'Asha', 'disabled', 'x', 'sales')`,
      [off, `${off}@example.test`]);
    expect(await assign(manager, off)).toBe('unknown_user');
    await owner(`insert into radcore.users (id, email, display_name, status, password_hash, role) values ($1, $2, 'Ravi', 'active', 'x', 'sales')`,
      [me, `${me}@example.test`]);
    expect(await assign(manager)).toBe('ok');
    expect(await statementOf(unassigned)).toBe('ok');
  });

  it.each(['invoices', 'credit_notes'])('names each numbered row of %s, and no draft, through v_sales_document_refs (backend-3’s OK on RAD-119)',
    async (table) => {
      // One statement, one snapshot: other files' documents come and go, but never between these three counts.
      const [counts] = (await su.query<{ numbered: number; shown: number; rows: number }>(`select
        (select count(*)::int from radcore.${table} where status <> 'draft') as numbered,
        (select count(*)::int from radcore.v_sales_document_refs v join radcore.${table} d on d.id = v.document_id
          and d.status <> 'draft' and d.number = v.number and d.business_date = v.business_date) as shown,
        (select count(*)::int from radcore.v_sales_document_refs where document_table = $1) as rows`, [table])).rows;
      expect([counts?.shown, counts?.rows]).toEqual([counts?.numbered, counts?.numbered]);
    });

  it('shows a statement only to receivables:read, never to parties:read alone (RC-042)', async () => {
    const [p] = await owner<{ id: string }>("insert into radcore.parties (name, customer, state_code) values ($1, true, '27') returning id",
      [`Quiet party ${randomUUID()}`]);
    const status = async (principal: Principal) => {
      const server = await listen(createApp(cfg, { info: vi.fn(), error: vi.fn() }, { db, authenticate: async () => principal, routes: accountRoutes }),
        0, '127.0.0.1');
      try {
        const sent = requestFor(getPartyStatement, { id: p?.id, from: '2026-04-01', to: '2026-11-30' });
        return (await fetch(`http://127.0.0.1:${server.port}${sent.path}`, { method: sent.method,
          headers: { origin: cfg.publicOrigin, 'sec-fetch-site': 'same-origin' } })).status;
      } finally {
        await server.stop();
      }
    };
    expect(await status({ kind: 'user', userId: randomUUID(), permissions: ['parties:read'] })).toBe(403);
    expect(await status(CLERK)).toBe(200);
    // A reminder answers with the amounts, so receivables:remind alone isn't enough (the architect's ruling).
    const reminded = async (permissions: string[]) => {
      const principal: Principal = { kind: 'user', userId: randomUUID(), permissions };
      const server = await listen(createApp(cfg, { info: vi.fn(), error: vi.fn() }, { db, authenticate: async () => principal, routes: accountRoutes }),
        0, '127.0.0.1');
      try {
        const sent = requestFor(recordReminder, { id: p?.id, channel: 'phone' });
        return (await fetch(`http://127.0.0.1:${server.port}${sent.path}`, { method: sent.method, body: sent.body ?? null,
          headers: { 'content-type': 'application/json', origin: cfg.publicOrigin, 'sec-fetch-site': 'same-origin', 'idempotency-key': randomUUID() } }))
          .status;
      } finally {
        await server.stop();
      }
    };
    expect(await reminded(['receivables:remind'])).toBe(403);
    // This party owes nothing, so there's nothing to remind them of (the auditor on #276).
    expect(await reminded(['receivables:remind', 'receivables:read'])).toBe(422);
  });
});

