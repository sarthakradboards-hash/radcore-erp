// RAD-165's first PR (the architect on RAD-168; ADR-006 §6, F19) on PostgreSQL 16, as the app login: money moved
// between our own accounts posts `transfer`, Dr where it went and Cr where it came from; the same account or one that
// isn't Cash or a bank is refused; a cancel mirrors the entry, dated that day.
import { randomUUID } from 'node:crypto';
import { cancelTransfer, openFinancialYear, recordTransfer, systemAccountId, transferById, transfersPage } from '@radcore/lib-accounts';
import { moneyString } from '@radcore/lib-common';
import type { Ctx, Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
const clerk: Principal = { kind: 'user', userId: randomUUID(), permissions: ['payments:read', 'payments:write'] };
// A fixed past day, so no test reads the run date (RC-156).
const DAY = '2026-11-12';
const m = (s: string) => moneyString().parse(s);

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the transfer tests must run, not skip');
});

describe.skipIf(!url || !superUrl)('transfers between own accounts', { timeout: 30_000 }, () => {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  const su = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
    await su.end();
  });
  const run = <R>(fn: (ctx: Ctx) => Promise<R>) => runInTransaction(db, WRITE, clerk, randomUUID(), fn);
  const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e as { code?: string }).code ?? String(e));
  const linesOf = async (entry: string) => (await su.query<{ key: string | null; debit: string; credit: string; kind: string }>(
    `select a.system_key key, l.debit::text, l.credit::text, l.entry_kind kind from radcore.journal_lines l
     join radcore.accounts a on a.id = l.account_id where l.entry_id = $1 order by l.line_no`, [entry])).rows;
  const ids = () => run(async (ctx) => ({ cash: await systemAccountId(ctx, 'cash'), bank: await systemAccountId(ctx, 'bank'),
    sales: await systemAccountId(ctx, 'sales') }));
  beforeAll(async () => {
    await run((ctx) => openFinancialYear(ctx, DAY));
  });

  it('posts cash paid into the bank as F19, numbered TR, and lists it', async () => {
    const { cash, bank } = await ids();
    const moved = await run((ctx) => recordTransfer(ctx, { fromAccountId: cash, toAccountId: bank, amount: m('10000.00'), businessDate: DAY,
      reference: 'SLIP 42' }));
    expect(moved.number).toMatch(/^TR\//);
    const [row] = (await su.query<{ entry: string }>('select posted_entry_id entry from radcore.transfers where id = $1', [moved.id])).rows;
    expect(await linesOf(row?.entry ?? '')).toEqual([{ key: 'bank', debit: '10000.00', credit: '0.00', kind: 'transfer' },
      { key: 'cash', debit: '0.00', credit: '10000.00', kind: 'transfer' }]);
    const shown = await run((ctx) => transferById(ctx, { id: moved.id }));
    expect([shown.status, shown.from.id, shown.to.id, shown.amount, shown.reference]).toEqual(['posted', cash, bank, '10000.00', 'SLIP 42']);
    const listed = await run((ctx) => transfersPage(ctx, { filter: { accountId: bank }, limit: 50 }));
    expect(listed.items.map((t) => t.id)).toContain(moved.id);
  });

  it('refuses the same account, and one that isn’t Cash or a bank', async () => {
    const { cash, bank, sales } = await ids();
    expect(await code(run((ctx) => recordTransfer(ctx, { fromAccountId: cash, toAccountId: cash, amount: m('1.00'), businessDate: DAY }))))
      .toBe('same_account');
    expect(await code(run((ctx) => recordTransfer(ctx, { fromAccountId: sales, toAccountId: bank, amount: m('1.00'), businessDate: DAY }))))
      .toBe('not_money_account');
    expect(await code(run((ctx) => recordTransfer(ctx, { fromAccountId: cash, toAccountId: bank, amount: m('0.00'), businessDate: DAY }))))
      .toBe('amount_not_positive');
  });

  it('cancels by mirroring the entry, dated the day of the cancel, once', async () => {
    const { cash, bank } = await ids();
    const moved = await run((ctx) => recordTransfer(ctx, { fromAccountId: bank, toAccountId: cash, amount: m('250.50'), businessDate: DAY }));
    expect(await code(run((ctx) => cancelTransfer(ctx, { id: moved.id, businessDate: '2026-11-11', reason: 'Too early' }))))
      .toBe('date_before_source');
    await run((ctx) => cancelTransfer(ctx, { id: moved.id, businessDate: '2026-11-13', reason: 'Wrong account' }));
    const [row] = (await su.query<{ entry: string; date: string }>(`select t.cancel_entry_id entry, e.business_date::text date from radcore.transfers t
      join radcore.journal_entries e on e.id = t.cancel_entry_id where t.id = $1`, [moved.id])).rows;
    expect(row?.date).toBe('2026-11-13');
    expect(await linesOf(row?.entry ?? '')).toEqual([{ key: 'cash', debit: '0.00', credit: '250.50', kind: 'transfer' },
      { key: 'bank', debit: '250.50', credit: '0.00', kind: 'transfer' }]);
    expect(await code(run((ctx) => cancelTransfer(ctx, { id: moved.id, businessDate: '2026-11-13', reason: 'Again' })))).toBe('not_posted');
  });
});
