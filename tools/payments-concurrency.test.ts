// Cash saves for one party take turns at the day's limit without deadlocking (ADR-006 §1 step 3, ADR-007 §8; the
// auditor on RAD-116). The party is held FOR NO KEY UPDATE through lib-accounts' holdParty: a payment's own insert
// references the party by foreign key (KEY SHARE), which a FOR UPDATE would wait on, so two cash saves for one party
// each held KEY SHARE and waited for the other (40P01, a 409). NO KEY UPDATE doesn't conflict with KEY SHARE.
import { randomUUID } from 'node:crypto';
import { openFinancialYear, recordPayment } from '@radcore/lib-accounts';
import { moneyString } from '@radcore/lib-common';
import type { Ctx, Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const CLERK: Principal = { kind: 'user', userId: randomUUID(), permissions: ['payments:write'] };
const DAY = '2026-11-10';
const m = (s: string) => moneyString().parse(s);

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the payment concurrency tests must run, not skip');
});

describe.skipIf(!url || !superUrl)('cash saves for one party at once', { timeout: 30_000 }, () => {
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  const su = new pg.Pool({ connectionString: superUrl, max: 2 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
    await su.end();
  });
  const run = <R>(fn: (ctx: Ctx) => Promise<R>) => runInTransaction(db, { readOnly: false, isolation: 'read committed' }, CLERK, randomUUID(), fn);
  const cash = async () => (await su.query<{ id: string }>("select id from radcore.accounts where system_key = 'cash'")).rows[0]?.id ?? '';
  const party = async () => {
    const c = await su.connect();
    try {
      await c.query('begin');
      await c.query("set local app.principal = 'system:test'");
      const { rows } = await c.query<{ id: string }>("insert into radcore.parties (name, customer, supplier, state_code) values ($1, true, true, '27') returning id",
        [`Cash party ${randomUUID()}`]);
      await c.query('commit');
      return rows[0]?.id ?? '';
    } finally {
      c.release();
    }
  };
  const receipt = async (partyId: string, amount: string) => {
    const accountId = await cash();
    return run((ctx) => recordPayment(ctx, { kind: 'receipt', partyId, businessDate: DAY, amount: m(amount), accountId }));
  };

  beforeAll(async () => {
    await run((ctx) => openFinancialYear(ctx, DAY));
  });

  it('doesn’t wait on another transaction that references the party, as every payment insert does (KEY SHARE)', async () => {
    const p = await party();
    const other = await su.connect();
    try {
      await other.query('begin');
      await other.query('select id from radcore.parties where id = $1 for key share', [p]);
      const pid = (await other.query<{ pid: number }>('select pg_backend_pid() pid')).rows[0]?.pid;
      let status = 'saving';
      const saved = receipt(p, '100.00').then((r) => { status = r.status; });
      // Whichever comes first: the save finishes, or the database shows it waiting on the other transaction.
      const blocked = async () => (await su.query<{ n: number }>('select count(*)::int n from pg_stat_activity where $1 = any(pg_blocking_pids(pid))',
        [pid])).rows[0]?.n ?? 0;
      await vi.waitFor(async () => expect(status !== 'saving' || await blocked() > 0).toBe(true), { timeout: 10_000 });
      expect(status).toBe('posted');
      await saved;
    } finally {
      await other.query('rollback');
      other.release();
    }
  });

  it('posts two at once without a deadlock, the second counting the first at the day’s limit', async () => {
    const p = await party();
    const both = await Promise.allSettled([receipt(p, '150000.00'), receipt(p, '150000.00')]);
    expect(both.map((b) => (b.status === 'fulfilled' ? b.value.status : String(b.reason))).toSorted()).toEqual(['pending_approval', 'posted']);
  });
});
