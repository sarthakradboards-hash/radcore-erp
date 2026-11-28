// RAD-157 (M5-09; ADR-009 §6, §7; ADR-006 F20; RC-039, RC-163; D-06) on PostgreSQL 16: the period lock moves forward
// freely and waits for a posting in flight; back only when someone else holding books:unlock approves, and a request the
// lock moved past is stale; two decisions at once take turns; a year closes in order, once locked and checked, with F20's
// entry exactly; a reopened year reverses its close dated 31 March, takes a posting and closes again; and a bank charge
// unmatched in a locked month is reversed today (ADR-009 §15). In a database
// of its own: the period lock is one row, and these tests commit moves of it that every other file's postings would meet.
import { randomUUID } from 'node:crypto';
import {
  askToUnlock, bookCharge, closeYear, moveLockForward, openFinancialYear, periodState, periodUnlockSpec, postManualJournal, unmatch, type BooksCheck,
  type JournalLine,
} from '@radcore/lib-accounts';
import type { Money } from '@radcore/lib-common';
import { decideApproval, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import { checkBooks } from '@radcore/lib-service';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { freshDatabase } from './test-database.ts';

const adminUrl = process.env['TEST_DATABASE_ADMIN_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
const READ = { readOnly: true, isolation: 'read committed' } as const;
const APP = `period-lock-${randomUUID().slice(0, 8)}`;
const TICKS = ['Depreciation', 'Provisions', 'Income tax', 'Interest', 'Stock valuation agreed'];
const m = (s: string) => s as Money;
const dr = (account: JournalLine['account'], amount: string): JournalLine => ({ account, debit: m(amount) });
const cr = (account: JournalLine['account'], amount: string): JournalLine => ({ account, credit: m(amount) });
const CASH = { system: 'cash' };
const SALES = { system: 'sales' };
const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) =>
  (e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code ?? String(e));

it.runIf(process.env['CI'] && !adminUrl)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_ADMIN_URL is not set: in CI the period lock tests must run, not skip');
});

describe.skipIf(!adminUrl)('the period lock and year close', { timeout: 60_000 }, () => {
  // The file's own database (RC-222: no shared `let` but this one, set once in beforeAll), as quick-bill-concurrency's.
  const own: { pool?: pg.Pool; su?: pg.Pool; db?: ReturnType<typeof createDatabase>; drop?: () => Promise<void> } = {};
  const made = <T>(x: T | undefined): T => {
    if (x === undefined) throw new Error('The database is made in beforeAll');
    return x;
  };
  const su = () => made(own.su);
  const as = (p: Principal) => <R>(fn: (ctx: Ctx) => Promise<R>) => runInTransaction(made(own.db), WRITE, p, randomUUID(), fn);
  const user = async (role: string): Promise<Principal> => {
    const { rows: [u] } = await su().query<{ id: string }>(`with p as (select set_config('app.principal', 'system:test', true))
      insert into radcore.users (email, display_name, role) select $1, $2, $3 from p returning id`, [`${randomUUID()}@example.test`, role, role]);
    return { kind: 'user', userId: u?.id ?? '', permissions: ['books:lock', 'books:unlock', 'journal:post'] };
  };
  const setLock = (through: string | null) => su().query(`with p as (select set_config('app.principal', 'system:test', true))
    update radcore.period_lock set locked_through = $1 from p where id = 1`, [through]);
  const lockNow = async () => (await su().query<{ d: string | null }>("select locked_through::text d from radcore.period_lock")).rows[0]?.d;
  const post = (p: Principal, businessDate: string, lines: JournalLine[]) =>
    as(p)((ctx) => postManualJournal(ctx, { businessDate, reason: 'Test', lines }));
  const approve = async (p: Principal, asked: { id: string; versionHash: string }) =>
    as(p)((ctx) => decideApproval(ctx, periodUnlockSpec, asked.id, { decision: 'approve', versionHash: asked.versionHash }))
      .then((r) => r.status, (e: unknown) => (e as { code?: string }).code ?? String(e));
  // An account's debits less credits in a year.
  const balance = async (where: string, fyStart: string) => (await su().query<{ b: string }>(`select coalesce(sum(l.debit - l.credit), 0)::text b
    from radcore.journal_lines l join radcore.accounts a on a.id = l.account_id where ${where} and l.fy_start = $1`, [fyStart])).rows[0]?.b;

  beforeAll(async () => {
    const fresh = await freshDatabase(adminUrl ?? '');
    own.pool = new pg.Pool({ connectionString: fresh.appUrl, max: 6, application_name: APP });
    own.su = new pg.Pool({ connectionString: fresh.superUrl, max: 3 });
    for (const p of [own.pool, own.su]) p.on('error', (e: Error & { code?: string }) => { if (e.code !== '57P01') throw e; });
    own.db = createDatabase(own.pool);
    own.drop = fresh.drop;
    await su().query(`with p as (select set_config('app.principal', 'system:test', true))
      insert into radcore.company (legal_name, gstin, address_line1, city, pincode)
      select 'Radboards Pvt Ltd', '27AAPFU0939F1ZV', 'Plot 4, Bhosari MIDC', 'Pune', '411019' from p`);
    await su().query(`with p as (select set_config('app.principal', 'system:test', true))
      insert into radcore.accounts (name, type) select 'Professional Fees', 'expense' from p`);
    const setup = await user('admin');
    for (const d of ['2024-04-01', '2025-04-01', '2026-04-01']) await as(setup)((ctx) => openFinancialYear(ctx, d));
  }, 120_000);
  afterAll(async () => {
    await own.pool?.end();
    await own.su?.end();
    await own.drop?.();
  // Dropping the file's own database can outlast the default hook time under a full run's load.
  }, 120_000);

  it('closes years in order with F20 exactly, waits for a posting in flight, and reopens, posts and closes again', async () => {
    await setLock(null);
    const clerk = await user('accounts');
    const owner = await user('owner');
    const fees = { id: (await su().query<{ id: string }>("select id from radcore.accounts where name = 'Professional Fees'")).rows[0]?.id ?? '' };
    const close = (start: string, ticks = TICKS, check: BooksCheck = (c, asAt) => checkBooks(c, { asAt }).then((r) => r.problems)) =>
      as(clerk)((ctx) => closeYear(ctx, { start, ticks, reason: 'Year end' }, check));
    const lock = (through: string) => code(as(clerk)((ctx) => moveLockForward(ctx, { through, reason: 'Month end' })));

    // 2024-25 first: it isn't locked through its 31 March yet, and a lock moves only to a day before today, and forward.
    expect(await code(close('2024-04-01'))).toBe('lock_before_year_end');
    expect(await lock('2099-01-01')).toBe('lock_in_future');
    expect(await lock('2025-03-31')).toBe('ok');
    expect(await lock('2025-03-01')).toBe('lock_not_forward');
    // 2025-26 waits for 2024-25; and every checklist item must be ticked.
    expect(await code(close('2025-04-01'))).toBe('lock_before_year_end');
    expect(await code(close('2024-04-01', TICKS.slice(1)))).toBe('checklist_incomplete');
    // Nothing to move in 2024-25: the close posts no entry.
    expect((await close('2024-04-01')).entry).toBeNull();
    expect(await code(close('2024-04-01'))).toBe('year_closed');

    // F20's start, in 2025-26: Sales Cr 1,035.00; Cost of Goods Sold Dr 600.00; Round Off Dr 0.30; Professional Fees Dr
    // 60,000.00, the last posted on 30 March while the lock moves to 31 March.
    await post(clerk, '2026-01-10', [dr(CASH, '1035.00'), cr(SALES, '1035.00')]);
    await post(clerk, '2026-02-10', [dr({ system: 'cogs' }, '600.00'), dr({ system: 'round_off' }, '0.30'), cr(CASH, '600.30')]);
    const gate = Promise.withResolvers<void>();
    const posted = Promise.withResolvers<void>();
    const inFlight = as(clerk)(async (ctx) => {
      const p = await postManualJournal(ctx, { businessDate: '2026-03-30', reason: 'Test', lines: [dr(fees, '60000.00'), cr(CASH, '60000.00')] });
      posted.resolve();
      await gate.promise;
      return p;
    });
    await posted.promise;
    const moved = lock('2026-03-31');
    // The move waits on the posting's FOR SHARE of the lock row.
    await vi.waitFor(async () => expect((await su().query<{ n: number }>(`select count(*)::int n from pg_stat_activity
      where application_name = $1 and cardinality(pg_blocking_pids(pid)) > 0`, [APP])).rows[0]?.n).toBe(1), { timeout: 10_000, interval: 20 });
    gate.resolve();
    await inFlight;
    expect(await moved).toBe('ok');

    // The books check must pass as at 31 March.
    expect(await code(close('2025-04-01', TICKS, async () => ['a problem']))).toBe('books_check_failed');
    const closed = await close('2025-04-01');
    const lines = (await su().query<{ name: string; debit: string; credit: string }>(`select a.name, l.debit::text, l.credit::text
      from radcore.journal_entries e join radcore.journal_lines l on l.entry_id = e.id join radcore.accounts a on a.id = l.account_id
      where e.number = $1 and e.business_date = '2026-03-31' and e.kind = 'year_close' order by a.name`, [closed.entry])).rows;
    expect(lines).toEqual([
      { name: 'Cost of Goods Sold', debit: '0.00', credit: '600.00' },
      { name: 'Professional Fees', debit: '0.00', credit: '60000.00' },
      { name: 'Retained Earnings', debit: '59565.30', credit: '0.00' },
      { name: 'Round Off', debit: '0.00', credit: '0.30' },
      { name: 'Sales', debit: '1035.00', credit: '0.00' },
    ]);
    expect(await balance("a.type in ('income', 'expense')", '2025-04-01')).toBe('0.00');

    // Moving back into a closed year, or reopening one with a later one closed, is refused.
    expect(await code(as(clerk)((ctx) => askToUnlock(ctx, { kind: 'move_back', through: '2026-01-31', reason: 'Fix' })))).toBe('year_closed');
    expect(await code(as(clerk)((ctx) => askToUnlock(ctx, { kind: 'reopen_year', through: '2025-02-28', reason: 'Fix' }))))
      .toBe('later_year_closed');

    // Reopened by someone else: the close reversed on 31 March, the lock back to 28 February, and the year takes a posting.
    const asked = await as(clerk)((ctx) => askToUnlock(ctx, { kind: 'reopen_year', through: '2026-02-28', reason: 'A missed sale' }));
    expect(await approve(clerk, asked)).toBe('own_request');
    expect(await approve(owner, asked)).toBe('approved');
    expect(await lockNow()).toBe('2026-02-28');
    expect(await balance("a.type in ('income', 'expense')", '2025-04-01')).not.toBe('0.00');
    expect((await su().query("select 1 from radcore.journal_entries where kind = 'year_close' and reverses_entry_id is not null and business_date = '2026-03-31'"))
      .rowCount).toBe(1);
    expect(await code(post(clerk, '2026-02-28', [dr(CASH, '1.00'), cr(SALES, '1.00')]))).toBe('period_locked');
    await post(clerk, '2026-03-15', [dr(CASH, '100.00'), cr(SALES, '100.00')]);

    // Closed again: a new entry, from the year's balances with the old close and its reversal netting to nothing.
    expect(await lock('2026-03-31')).toBe('ok');
    const again = await close('2025-04-01');
    expect(again.entry).not.toBe(closed.entry);
    expect(await balance("a.system_key = 'retained_earnings'", '2025-04-01')).toBe('59465.30');
    expect(await balance("a.type in ('income', 'expense')", '2025-04-01')).toBe('0.00');
    // Only a year_close passes the lock, and only on 31 March.
    expect(await code(post(clerk, '2026-03-31', [dr(CASH, '1.00'), cr(SALES, '1.00')]))).toBe('period_locked');
    const state = await runInTransaction(made(own.db), READ, clerk, randomUUID(), (ctx) => periodState(ctx));
    expect(state.years.map((y) => [y.start, y.closed !== null])).toEqual([['2026-04-01', false], ['2025-04-01', true], ['2024-04-01', true]]);
    expect(state.checklist).toEqual(TICKS);
  });

  it('moves the lock back only on someone else’s approval, and refuses a request the lock moved past', async () => {
    await setLock('2026-10-31');
    const admin = await user('admin');
    const owner = await user('owner');
    const back = (through: string) => as(admin)((ctx) => askToUnlock(ctx, { kind: 'move_back', through, reason: 'A late bill' }));
    expect(await code(back('2026-11-15'))).toBe('lock_not_back');
    const stale = await back('2026-09-30');
    const asked = await back('2026-09-15');
    // An admin's own request needs the owner or another admin (D-06).
    expect(await approve(admin, asked)).toBe('own_request');
    expect(await approve(owner, asked)).toBe('approved');
    expect(await lockNow()).toBe('2026-09-15');
    // The lock moved since `stale` was asked: its version no longer holds.
    expect(await approve(owner, stale)).toBe('version_changed');
    expect(await lockNow()).toBe('2026-09-15');
  });

  it('takes two decisions on move-back requests in turns, never a deadlock', async () => {
    await setLock('2026-10-31');
    const clerk = await user('accounts');
    const [a, b] = [await user('owner'), await user('admin')];
    const first = await as(clerk)((ctx) => askToUnlock(ctx, { kind: 'move_back', through: '2026-10-15', reason: 'One' }));
    const second = await as(clerk)((ctx) => askToUnlock(ctx, { kind: 'move_back', through: '2026-10-01', reason: 'Two' }));
    const both = await Promise.all([approve(a, first), approve(b, second)]);
    // Each holds the period lock FOR UPDATE before its request: the second sees the first's move and is stale.
    expect(both.toSorted()).toEqual(['approved', 'version_changed']);
    expect(['2026-10-15', '2026-10-01']).toContain(await lockNow());
  });

  it('unmatches a bank charge in a locked period, its reversal dated today (ADR-009 §15, M5-13)', async () => {
    await setLock(null);
    const clerk: Principal = { ...await user('accounts'), permissions: ['bank:read', 'bank:reconcile'] };
    const row = async (text: string, values: unknown[]) => (await su().query<{ id: string }>(
      `with p as (select set_config('app.principal', 'system:test', true)) ${text}`, values)).rows[0]?.id ?? '';
    const bank = await row(`insert into radcore.accounts (name, type, parent_id) select 'Lock Bank', 'asset', a.id from radcore.accounts a, p
      where a.system_key = 'bank' returning id`, []);
    const charges = await row("insert into radcore.accounts (name, type) select 'Bank Charges', 'expense' from p returning id", []);
    const file = await row(`insert into radcore.files (kind, store_key, filename, content_type, size, status)
      select 'statement', $1, 'statement.csv', 'text/csv', 10, 'ready' from p returning id`, [`statement/${randomUUID()}`]);
    const imported = await row(`insert into radcore.statement_imports (account_id, file_id, status, new_lines, present_lines, refusals)
      select $1, $2, 'imported', 1, 0, '[]'::jsonb from p returning id`, [bank, file]);
    const line = await row(`insert into radcore.bank_statement_lines (account_id, import_id, row_no, value_date, narration, reference, direction,
      amount, balance) select $1, $2, 2, '2026-11-10', 'SMS ALERT CHARGES', '', 'out', '59.00', '-59.00' from p returning id`, [bank, imported]);
    const { matchId } = await as(clerk)((ctx) => bookCharge(ctx, { id: line, accountId: charges }));
    // The lock moves past the charge's day; unmatching still succeeds, reversing it today, not in the locked month.
    await setLock('2026-11-20');
    // Unmatched on 25 Nov, after the lock through 20 Nov: the service reads the date, so only Date is faked.
    vi.useFakeTimers({ now: new Date('2026-11-25T06:00:00Z'), toFake: ['Date'] });
    try {
      await as(clerk)((ctx) => unmatch(ctx, { id: matchId, reason: 'Tax invoice came' }));
    } finally {
      vi.useRealTimers();
    }
    const entries = (await su().query<{ date: string; reversal: boolean }>(`select business_date::text date, reverses_entry_id is not null reversal
      from radcore.journal_entries where source_table = 'bank_matches' and source_id = $1 order by reversal`, [matchId])).rows;
    expect(entries).toEqual([{ date: '2026-11-10', reversal: false }, { date: '2026-11-25', reversal: true }]);
    await setLock(null);
  });
});
