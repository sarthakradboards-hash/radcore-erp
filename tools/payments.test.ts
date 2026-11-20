// RAD-116 part 1 (M3-12; ADR-007 §1–§5, §8; ADR-006 §6, F8) on a real PostgreSQL 16, as the app login. A receipt
// posts Dr Bank or Cash, Dr TDS Receivable for what the customer held back, Cr Debtors for the whole; a payment posts
// Dr Creditors, Cr Bank or Cash (and Cr TDS Payable for TDS held); a refund pays a customer back against the receipt it
// names. Each is numbered at posting (RV, PV), dated in an open year, after the lock and not after today. Cash past
// the limits waits as a draft for an owner's approval (RC-114). A posted payment is frozen, and cancelled only by a
// mirror entry dated the cancellation's day. Each test uses parties of its own.
import { randomUUID } from 'node:crypto';
import { cancelPayment, cashLimitSpec, heldLeft, openFinancialYear, recordHeldReceipt, recordPayment, refundHeld } from '@radcore/lib-accounts';
import { recordPaymentContract } from '@radcore/lib-accounts/contract';
import { moneyString, requestFor } from '@radcore/lib-common';
import { AppError, decideApproval, loadConfig, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import { testSettings } from '@radcore/test-helpers';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp, listen } from '../apps/api/src/app.ts';
import accountRoutes from '../apps/api/src/routes/accounts.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
const CLERK: Principal = { kind: 'user', userId: randomUUID(), permissions: ['payments:write'] };
const DAY = '2026-11-10';
const m = (s: string) => moneyString().parse(s);

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the payment tests must run, not skip');
});

describe.skipIf(!url || !superUrl)('receipts, payments and refunds', { timeout: 30_000 }, () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const su = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
    await su.end();
  });
  const as = (p: Principal) => <R>(fn: (ctx: Ctx) => Promise<R>) => runInTransaction(db, WRITE, p, randomUUID(), fn);
  const run = as(CLERK);
  const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof AppError ? e.code
    : (e as { cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code ?? String(e)));
  const systemId = async (key: string) => (await su.query<{ id: string }>('select id from radcore.accounts where system_key = $1', [key])).rows[0]?.id ?? '';
  /** A party of the test's own, a customer and a supplier, added as the owner. */
  const party = async () => {
    const c = await su.connect();
    try {
      await c.query('begin');
      await c.query("set local app.principal = 'system:test'");
      const { rows } = await c.query<{ id: string }>("insert into radcore.parties (name, customer, supplier, state_code) values ($1, true, true, '27') returning id",
        [`Test party ${randomUUID()}`]);
      await c.query('commit');
      return rows[0]?.id ?? '';
    } finally {
      c.release();
    }
  };
  // An entry's lines as [system key, party?, debit, credit], in line order.
  const linesOf = async (entryId: string | null) => (await su.query<{ k: string; p: string | null; d: string; c: string }>(`select
    a.system_key k, l.party_id p, l.debit::text d, l.credit::text c from radcore.journal_lines l join radcore.accounts a on a.id = l.account_id
    where l.entry_id = $1 order by l.line_no`, [entryId])).rows.map((r) => [r.k, r.p, r.d, r.c]);
  const paymentRow = async (id: string) => (await su.query<{ status: string; number: string | null; posted_entry_id: string | null;
    cancel_entry_id: string | null }>('select status, number, posted_entry_id, cancel_entry_id from radcore.payments where id = $1', [id])).rows[0];

  beforeAll(async () => {
    await run((ctx) => openFinancialYear(ctx, DAY));
  });

  it('posts a receipt with TDS held back: Dr Bank, Dr TDS Receivable, Cr Debtors for the whole (F8), numbered RV', async () => {
    const p = await party();
    const bank = await systemId('bank');
    const r = await run((ctx) => recordPayment(ctx, { kind: 'receipt', partyId: p, businessDate: DAY, amount: m('10000.00'), tds: m('200.00'),
      accountId: bank }));
    expect(r).toMatchObject({ status: 'posted', number: expect.stringMatching(/^RV\/26-27\/\d{5}$/) });
    const row = await paymentRow(r.id);
    expect(await linesOf(row?.posted_entry_id ?? null)).toEqual([
      ['bank', null, '9800.00', '0.00'], ['tds_receivable', null, '200.00', '0.00'], ['debtors', p, '0.00', '10000.00']]);
  });

  it('posts a payment: Dr Creditors, Cr Bank, and Cr TDS Payable for TDS held, numbered PV', async () => {
    const p = await party();
    const r = await run(async (ctx) => recordPayment(ctx, { kind: 'payment', partyId: p, businessDate: DAY, amount: m('5000.00'),
      tds: m('50.00'), accountId: await systemId('bank') }));
    expect(r).toMatchObject({ status: 'posted', number: expect.stringMatching(/^PV\/26-27\/\d{5}$/) });
    expect(await linesOf((await paymentRow(r.id))?.posted_entry_id ?? null)).toEqual([
      ['creditors', p, '5000.00', '0.00'], ['bank', null, '0.00', '4950.00'], ['tds_payable', null, '0.00', '50.00']]);
  });

  it('refunds a customer against the receipt it names, never more than is left of it, nor dated before it', async () => {
    const p = await party();
    const bank = await systemId('bank');
    const receipt = await run((ctx) => recordPayment(ctx, { kind: 'receipt', partyId: p, businessDate: '2026-11-05', amount: m('3000.00'),
      tds: m('0.00'), accountId: bank }));
    const refund = await run((ctx) => recordPayment(ctx, { kind: 'refund', partyId: p, businessDate: DAY, amount: m('1000.00'), tds: m('0.00'),
      accountId: bank, refundOf: receipt.id }));
    expect(await linesOf((await paymentRow(refund.id))?.posted_entry_id ?? null)).toEqual([
      ['debtors', p, '1000.00', '0.00'], ['bank', null, '0.00', '1000.00']]);
    const again = (amount: string, date = DAY, partyId = p) => code(run((ctx) => recordPayment(ctx, { kind: 'refund', partyId, businessDate: date,
      amount: m(amount), tds: m('0.00'), accountId: bank, refundOf: receipt.id })));
    expect(await again('2000.01')).toBe('exceeds_receipt');
    expect(await again('100.00', '2026-11-04')).toBe('date_before_source');
    const other = await party();
    expect(await again('100.00', DAY, other)).toBe('refund_other_party');
    expect(await again('2000.00')).toBe('ok');
  });

  it('refuses a switched-off bank account by name, over the real route, never a server error (the auditor on #234)', async () => {
    const c = await su.connect();
    let account = '';
    try {
      await c.query('begin');
      await c.query("set local app.principal = 'system:test'");
      account = (await c.query<{ id: string }>(`insert into radcore.accounts (name, type, parent_id, active)
        values ($1, 'asset', (select id from radcore.accounts where system_key = 'bank'), false) returning id`, [`Old bank ${randomUUID()}`])).rows[0]?.id ?? '';
      await c.query('commit');
    } finally {
      c.release();
    }
    const p = await party();
    const cfg = loadConfig(testSettings(), 'api');
    const server = await listen(createApp(cfg, { info: vi.fn(), error: vi.fn() }, { db, authenticate: async () => CLERK, routes: accountRoutes }),
      0, '127.0.0.1');
    try {
      const sent = requestFor(recordPaymentContract, { kind: 'receipt', partyId: p, businessDate: DAY, amount: '100.00', accountId: account });
      const res = await fetch(`http://127.0.0.1:${server.port}${sent.path}`, { method: sent.method, body: sent.body ?? null,
        headers: { 'content-type': 'application/json', origin: cfg.publicOrigin, 'sec-fetch-site': 'same-origin', 'idempotency-key': randomUUID() } });
      expect([res.status, ((await res.json()) as { code?: string }).code]).toEqual([422, 'account_inactive']);
    } finally {
      await server.stop();
    }
  });

  it('refunds an advance held for a document only through that document, never over the route (RAD-117)', async () => {
    const p = await party();
    const bank = await systemId('bank');
    // Any table stands in for bookings here: lib-accounts never reads the document it names.
    const booking = { table: 'parties', id: randomUUID() };
    const advance = await run((ctx) => recordHeldReceipt(ctx, { partyId: p, businessDate: DAY, amount: m('500.00'), accountId: bank }, booking));
    const cfg = loadConfig(testSettings(), 'api');
    const server = await listen(createApp(cfg, { info: vi.fn(), error: vi.fn() }, { db, authenticate: async () => CLERK, routes: accountRoutes }),
      0, '127.0.0.1');
    try {
      const sent = requestFor(recordPaymentContract, { kind: 'refund', partyId: p, businessDate: DAY, amount: '100.00', accountId: bank,
        refundOf: advance.id });
      const res = await fetch(`http://127.0.0.1:${server.port}${sent.path}`, { method: sent.method, body: sent.body ?? null,
        headers: { 'content-type': 'application/json', origin: cfg.publicOrigin, 'sec-fetch-site': 'same-origin', 'idempotency-key': randomUUID() } });
      expect([res.status, ((await res.json()) as { code?: string }).code]).toEqual([422, 'refund_through_owner']);
    } finally {
      await server.stop();
    }
    const through = (receiptId: string, owner: { table: string; id: string }, amount = '100.00') => code(run((ctx) => refundHeld(ctx,
      { receiptId, owner, partyId: p, businessDate: DAY, amount: m(amount), accountId: bank })));
    expect(await through(advance.id, { ...booking, id: randomUUID() })).toBe('refund_through_owner');
    expect(await through(advance.id, booking, '500.01')).toBe('exceeds_receipt');
    expect(await through(advance.id, booking)).toBe('ok');
    const plain = await run((ctx) => recordPayment(ctx, { kind: 'receipt', partyId: p, businessDate: DAY, amount: m('50.00'), accountId: bank }));
    expect(await through(plain.id, booking)).toBe('refund_through_owner');
  });

  it('counts a held receipt’s refunds waiting for approval as gone from what’s left, until refused (the architect on RAD-117)', async () => {
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
    const booking = { table: 'parties', id: randomUUID() };
    const advance = await run(async (ctx) => recordHeldReceipt(ctx, { partyId: p, businessDate: DAY, amount: m('20000.00'),
      accountId: await systemId('bank') }, booking));
    const left = () => run((ctx) => heldLeft(ctx, booking)).then((h) => h.left);
    expect(await left()).toBe('20000.00');
    // In cash past the day's limit, it waits as a draft for an owner.
    const waiting = await run(async (ctx) => refundHeld(ctx, { receiptId: advance.id, owner: booking, partyId: p, businessDate: DAY,
      amount: m('12000.00'), accountId: await systemId('cash') }));
    expect(waiting).toMatchObject({ status: 'pending_approval' });
    expect(await left()).toBe('8000.00');
    const [request] = (await su.query<{ id: string }>("select id from radcore.approvals where kind = 'cash-limit' and record_id = $1",
      [waiting.id])).rows;
    const owner: Principal = { kind: 'user', userId: ownerId, permissions: ['payments:approve'] };
    await as(owner)((ctx) => decideApproval(ctx, cashLimitSpec, request?.id ?? '', { decision: 'reject', reason: 'Pay it by bank' }));
    expect(await left()).toBe('20000.00');
  });

  it('refuses TDS on a refund, TDS of the whole amount, a date after today, and a year never opened', async () => {
    const bank = await systemId('bank');
    const someone = await party();
    const post = (o: { tds?: string; date?: string; kind?: 'receipt' | 'refund' }) => code(run((ctx) => recordPayment(ctx, {
      kind: o.kind ?? 'receipt', partyId: someone, businessDate: o.date ?? DAY, amount: m('100.00'), tds: m(o.tds ?? '0.00'), accountId: bank })));
    expect(await post({ tds: '100.00' })).toBe('invalid_tds');
    expect(await post({ date: '2099-01-01' })).toBe('date_in_future');
    expect(await post({ date: '2019-05-01' })).toBe('year_not_open');
    expect(await post({ kind: 'refund' })).toBe('refund_needs_receipt');
  });

  it('holds cash past the day’s limit as a draft for an owner’s approval, then posts it on approval (RC-114)', async () => {
    // The approver is a person whose account is older than the request (approvals.ts's approver_too_new).
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
    const owner: Principal = { kind: 'user', userId: ownerId, permissions: ['payments:approve'] };
    const p = await party();
    const cash = await systemId('cash');
    const take = (amount: string) => run((ctx) => recordPayment(ctx, { kind: 'receipt', partyId: p, businessDate: DAY, amount: m(amount),
      tds: m('0.00'), accountId: cash }));
    expect(await take('150000.00')).toMatchObject({ status: 'posted' });
    const held = await take('50000.00');
    expect(held).toMatchObject({ status: 'pending_approval', number: null });
    expect(await paymentRow(held.id)).toMatchObject({ status: 'draft', number: null, posted_entry_id: null });
    const [request] = (await su.query<{ id: string; version_digest: string }>("select id, version_digest from radcore.approvals where kind = 'cash-limit' and record_id = $1",
      [held.id])).rows;
    await as(owner)((ctx) => decideApproval(ctx, cashLimitSpec, request?.id ?? '', { decision: 'approve', versionHash: request?.version_digest ?? '' }));
    expect(await paymentRow(held.id)).toMatchObject({ status: 'posted', number: expect.stringMatching(/^RV\//) });
    // A payment out in cash: over Rs 10,000 to one party in a day waits too.
    const q = await party();
    const pay = (amount: string) => run((ctx) => recordPayment(ctx, { kind: 'payment', partyId: q, businessDate: DAY, amount: m(amount),
      tds: m('0.00'), accountId: cash }));
    expect(await pay('10000.00')).toMatchObject({ status: 'posted' });
    expect(await pay('0.01')).toMatchObject({ status: 'pending_approval' });
  });

  it('re-checks a refund that waited for approval: two can’t both post past the receipt, nor one after it’s cancelled (the architect on #234)', async () => {
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
    const owner: Principal = { kind: 'user', userId: ownerId, permissions: ['payments:approve'] };
    const [bank, cash] = [await systemId('bank'), await systemId('cash')];
    const receive = (partyId: string) => run((ctx) => recordPayment(ctx, { kind: 'receipt', partyId, businessDate: '2026-11-05',
      amount: m('20000.00'), accountId: bank }));
    // A cash refund over Rs 10,000 waits for an owner (section 40A(3)), still a draft.
    const refund = (partyId: string, receiptId: string) => run((ctx) => recordPayment(ctx, { kind: 'refund', partyId, businessDate: DAY,
      amount: m('15000.00'), accountId: cash, refundOf: receiptId }));
    const approve = async (paymentId: string) => {
      const [r] = (await su.query<{ id: string; version_digest: string }>(
        "select id, version_digest from radcore.approvals where kind = 'cash-limit' and record_id = $1 and decided_at is null", [paymentId])).rows;
      return code(as(owner)((ctx) => decideApproval(ctx, cashLimitSpec, r?.id ?? '', { decision: 'approve', versionHash: r?.version_digest ?? '' })));
    };
    const p = await party();
    const receipt = await receive(p);
    const [a, b] = [await refund(p, receipt.id), await refund(p, receipt.id)];
    expect([a.status, b.status]).toEqual(['pending_approval', 'pending_approval']);
    expect(await approve(a.id)).toBe('ok');
    expect(await approve(b.id)).toBe('exceeds_receipt');
    expect([(await paymentRow(a.id))?.status, (await paymentRow(b.id))?.status]).toEqual(['posted', 'draft']);
    // A refund waiting when its receipt is cancelled never posts.
    const q = await party();
    const second = await receive(q);
    const waiting = await refund(q, second.id);
    await run((ctx) => cancelPayment(ctx, { id: second.id, businessDate: DAY, reason: 'Cheque bounced' }));
    expect(await approve(waiting.id)).toBe('receipt_not_posted');
    expect((await paymentRow(waiting.id))?.status).toBe('draft');
  });

  it('cancels a posted payment by a mirror entry dated the cancellation’s day, once; a posted one is frozen', async () => {
    const p = await party();
    const r = await run(async (ctx) => recordPayment(ctx, { kind: 'receipt', partyId: p, businessDate: '2026-11-03', amount: m('700.00'),
      tds: m('0.00'), accountId: await systemId('bank') }));
    expect(await code(run((ctx) => cancelPayment(ctx, { id: r.id, businessDate: '2026-11-02', reason: 'Bounced' })))).toBe('date_before_source');
    await run((ctx) => cancelPayment(ctx, { id: r.id, businessDate: DAY, reason: 'Cheque bounced' }));
    const row = await paymentRow(r.id);
    expect(row?.status).toBe('cancelled');
    expect(await linesOf(row?.cancel_entry_id ?? null)).toEqual([['bank', null, '0.00', '700.00'], ['debtors', p, '700.00', '0.00']]);
    expect(await code(run((ctx) => cancelPayment(ctx, { id: r.id, businessDate: DAY, reason: 'Again' })))).toBe('not_posted');
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query("set local app.principal = 'system:test'");
      expect(await code(c.query('update radcore.payments set amount = 1 where id = $1', [r.id]))).toBe('RA004');
    } finally {
      await c.query('rollback');
      c.release();
    }
  });
});
