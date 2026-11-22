// An approval whose approved() posts takes its locks in ADR-006 §1's one order (the architect on RAD-114): the period,
// through its spec's lockFirst, before the engine locks the record. While someone moves the period lock, the decision
// waits on the period holding nothing else, so the record stays free and the two take turns, never deadlock.
import { randomUUID } from 'node:crypto';
import { cashLimitSpec, openFinancialYear, recordPayment } from '@radcore/lib-accounts';
import { moneyString } from '@radcore/lib-common';
import { decideApproval, requestApproval, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const CLERK: Principal = { kind: 'user', userId: randomUUID(), permissions: ['payments:write'] };
const DAY = '2026-11-10';

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the approval lock order test must run, not skip');
});

describe.skipIf(!url || !superUrl)('an approval that posts', { timeout: 30_000 }, () => {
  // Its own name, so the test waits on its own decision, not on another file's posting queued behind the same lock.
  const APP = `approval-period-${randomUUID().slice(0, 8)}`;
  const pool = new pg.Pool({ connectionString: url, max: 3, application_name: APP });
  const su = new pg.Pool({ connectionString: superUrl, max: 3 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
    await su.end();
  });
  const as = (p: Principal) => <R>(fn: (ctx: Ctx) => Promise<R>) => runInTransaction(db, { readOnly: false, isolation: 'read committed' }, p,
    randomUUID(), fn);
  const asSystem = (text: string, values: unknown[]) => su.query<{ id: string }>(
    `with p as (select set_config('app.principal', 'system:test', true)) ${text}`, values).then((r) => r.rows[0]?.id ?? '');

  beforeAll(async () => {
    await as(CLERK)((ctx) => openFinancialYear(ctx, DAY));
  });

  it('holds the period before it locks the payment, so a move of the period lock and the decision take turns', async () => {
    // The approver's account is older than the request (approver_too_new).
    const ownerId = await asSystem("insert into radcore.users (email, display_name, role) select $1, 'Owner', 'owner' from p returning id",
      [`${randomUUID()}@example.test`]);
    const party = await asSystem("insert into radcore.parties (name, supplier, state_code) select $1, true, '27' from p returning id",
      [`Cash party ${randomUUID()}`]);
    const cash = (await su.query<{ id: string }>("select id from radcore.accounts where system_key = 'cash'")).rows[0]?.id ?? '';
    const held = await as(CLERK)((ctx) => recordPayment(ctx, { kind: 'payment', partyId: party, businessDate: DAY,
      amount: moneyString().parse('10000.01'), accountId: cash }));
    expect(held.status).toBe('pending_approval');
    const [request] = (await su.query<{ id: string; version_digest: string }>(
      "select id, version_digest from radcore.approvals where kind = 'cash-limit' and record_id = $1", [held.id])).rows;
    const mover = await su.connect();
    const other = await su.connect();
    try {
      // Someone moving the period lock: FOR UPDATE on its row, held.
      await mover.query('begin');
      await mover.query("set local app.principal = 'system:test'");
      // ADR-006 §1's order, as holdPeriod takes it: the company row, then the period lock (RAD-76).
      await mover.query('select id from radcore.company for share');
      await mover.query('select id from radcore.period_lock where id = 1 for update');
      const pid = (await mover.query<{ pid: number }>('select pg_backend_pid() pid')).rows[0]?.pid;
      const owner: Principal = { kind: 'user', userId: ownerId, permissions: ['payments:approve'] };
      const decided = as(owner)((ctx) => decideApproval(ctx, cashLimitSpec, request?.id ?? '', { decision: 'approve',
        versionHash: request?.version_digest ?? '' })).then((r) => r.status, (e: unknown) => String((e as { code?: string }).code ?? e));
      // The period lock stops every posting while it's held, other files' too, so it's held no longer than this check.
      await vi.waitFor(async () => expect((await su.query<{ n: number }>(
        'select count(*)::int n from pg_stat_activity where application_name = $2 and $1 = any(pg_blocking_pids(pid))', [pid, APP])).rows[0]?.n)
        .toBe(1), { timeout: 10_000, interval: 20 });
      // The decision waits on the period, holding nothing else: the payment's row is free.
      await other.query('begin');
      const free = await other.query('select id from radcore.payments where id = $1 for update nowait', [held.id]).then(() => 'free',
        (e: { code?: string }) => e.code);
      await mover.query('rollback');
      await other.query('rollback');
      expect([free, await decided]).toEqual(['free', 'approved']);
      expect((await su.query('select status from radcore.payments where id = $1', [held.id])).rows).toEqual([{ status: 'posted' }]);
    } finally {
      await other.query('rollback').catch(() => undefined);
      await mover.query('rollback').catch(() => undefined);
      other.release();
      mover.release();
    }
  });

  it('rejects a draft the period would refuse: lockFirst takes locks and refuses nothing (the auditor on #275)', async () => {
    const ownerId = await asSystem("insert into radcore.users (email, display_name, role) select $1, 'Owner', 'owner' from p returning id",
      [`${randomUUID()}@example.test`]);
    const party = await asSystem("insert into radcore.parties (name, supplier, state_code) select $1, true, '27' from p returning id",
      [`Old party ${randomUUID()}`]);
    const cash = (await su.query<{ id: string }>("select id from radcore.accounts where system_key = 'cash'")).rows[0]?.id ?? '';
    // A draft dated in a year nobody opened: holdPeriod refuses it (year_not_open), as it would a locked period.
    const draft = await asSystem(`insert into radcore.payments (kind, party_id, business_date, amount, account_id)
      select 'payment', $1, '2019-05-01', '20000.00', $2 from p returning id`, [party, cash]);
    await as(CLERK)((ctx) => requestApproval(ctx, cashLimitSpec, draft));
    const [request] = (await su.query<{ id: string; version_digest: string }>(
      "select id, version_digest from radcore.approvals where kind = 'cash-limit' and record_id = $1", [draft])).rows;
    const owner: Principal = { kind: 'user', userId: ownerId, permissions: ['payments:approve'] };
    const decide = (decision: 'approve' | 'reject') => as(owner)((ctx) => decideApproval(ctx, cashLimitSpec, request?.id ?? '',
      decision === 'approve' ? { decision, versionHash: request?.version_digest ?? '' } : { decision, reason: 'Dated in a closed year' }))
      .then((r) => r.status, (e: unknown) => String((e as { code?: string }).code ?? e));
    // Approving posts, and the posting refuses the date by name; rejecting goes through.
    expect(await decide('approve')).toBe('year_not_open');
    expect(await decide('reject')).toBe('rejected');
  });
});
