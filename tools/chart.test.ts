// RAD-86's chart follow-up (the architect's ruling; ADR-006 §2, ADR-005 §9) on a real PostgreSQL 16, as the app
// login. An account may have a code, unique where set. An account other than a system one can be switched off, only
// while its balance is zero, read with the period lock held FOR UPDATE. A switched-off account takes no new postings,
// in the engine (account_inactive) and in the database (RA009), except a reversal of an entry already on it. Switching
// back on is always allowed. Each test adds accounts of its own; entries are dated in 2027-28, which no other file uses.
import { randomBytes, randomUUID } from 'node:crypto';
import { changeAccount, chartOfAccounts, openFinancialYear, postManual, reverseJournalEntry } from '@radcore/lib-accounts';
import type { Money } from '@radcore/lib-common';
import { AppError, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SECOND_FACTOR_KEYS } from '../packages/lib-platform/src/permissions.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const write = { readOnly: false, isolation: 'read committed' } as const;
const AS: Principal = { kind: 'system', name: 'test', permissions: ['accounts:write', 'journal:read', 'journal:post', 'journal:reverse'] };
const DAY = '2027-08-10';
const letters = () => [...randomBytes(8)].map((b) => String.fromCharCode(65 + (b % 26))).join('');
const m = (s: string) => s as Money;

it('lets accounts:write change the chart without the second factor: it moves no money', () => {
  expect(SECOND_FACTOR_KEYS.includes('accounts:write')).toBe(false);
});

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the chart tests must run, not skip');
});

describe.skipIf(!url || !superUrl)('the chart of accounts', { timeout: 30_000 }, () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const admin = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  const run = <R>(fn: (ctx: Ctx) => Promise<R>) => runInTransaction(db, write, AS, randomUUID(), fn);
  const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof AppError ? e.code
    : (e as { cause?: { code?: string }; code?: string }).cause?.code ?? (e as { code?: string }).code ?? String(e)));
  const systemId = async (key: string) =>
    (await pool.query<{ id: string }>('select id from radcore.accounts where system_key = $1', [key])).rows[0]?.id ?? '';
  /** One statement as the app login, in a transaction that names who wrote it, as the audit needs. */
  async function asApp<T extends pg.QueryResultRow>(text: string, values: unknown[]): Promise<T[]> {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query("set local app.principal = 'system:test'");
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
  /** An ordinary expense account of the test's own, added as the app login. */
  const account = async () => (await asApp<{ id: string }>(
    "insert into radcore.accounts (name, type) values ($1, 'expense') returning id", [`Test expense ${letters()}`]))[0]?.id ?? '';
  const post = async (debit: string, credit: string, amount: string) =>
    run((ctx) => postManual(ctx, { businessDate: DAY, reason: 'Test',
      lines: [{ accountId: debit, debit: m(amount) }, { accountId: credit, credit: m(amount) }] }));
  const shown = async (id: string) => (await run((ctx) => chartOfAccounts(ctx))).items.find((a) => a.id === id);

  beforeAll(async () => {
    await run((ctx) => openFinancialYear(ctx, DAY));
  });
  afterAll(async () => {
    await pool.end();
    await admin.end();
  });

  it('grants accounts:write to admin, owner and accounts, in each role and its template', async () => {
    for (const table of ['role_grants', 'role_templates']) {
      const { rows } = await admin.query<{ roles: string[] }>(`select array_agg(role order by role) roles from radcore.${table}
        where permission = 'accounts:write' and role in (select role from radcore.role_templates)`);
      expect(rows[0]?.roles, table).toEqual(['accounts', 'admin', 'owner']);
    }
  });

  it('gives an account a code, unique where set, and clears it', async () => {
    const [a, b] = [await account(), await account()];
    const c = `T${letters().slice(0, 6)}`;
    expect(await code(run((ctx) => changeAccount(ctx, { id: a, code: c, reason: 'CA scheme' })))).toBe('ok');
    expect(await shown(a)).toMatchObject({ code: c, active: true });
    expect(await code(run((ctx) => changeAccount(ctx, { id: b, code: c, reason: 'CA scheme' })))).toBe('code_taken');
    expect(await code(run((ctx) => changeAccount(ctx, { id: a, code: null, reason: 'No codes after all' })))).toBe('ok');
    expect(await code(run((ctx) => changeAccount(ctx, { id: b, code: c, reason: 'CA scheme' })))).toBe('ok');
    expect(await code(run((ctx) => changeAccount(ctx, { id: randomUUID(), code: c, reason: 'x' })))).toBe('not_found');
  });

  it('never switches a system account off, in the service and in the database', async () => {
    const cash = await systemId('cash');
    expect(await code(run((ctx) => changeAccount(ctx, { id: cash, active: false, reason: 'x' })))).toBe('system_account');
    expect(await code(asApp('update radcore.accounts set active = false where id = $1', [cash]))).toBe('23514');
  });

  it('switches an account off only at a zero balance, and then posts nothing new to it but a reversal', async () => {
    const [travel, bank] = [await account(), await systemId('bank')];
    const spent = await post(travel, bank, '30.00');
    expect(await code(run((ctx) => changeAccount(ctx, { id: travel, active: false, reason: 'Retired' })))).toBe('account_not_empty');
    const moved = await post(bank, travel, '30.00');
    expect(await code(run((ctx) => changeAccount(ctx, { id: travel, active: false, reason: 'Retired' })))).toBe('ok');
    expect(await shown(travel)).toMatchObject({ active: false });
    // No new posting, in the engine and in the database, however it's written.
    expect(await code(post(travel, bank, '5.00'))).toBe('account_inactive');
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query("set local app.principal = 'system:test'");
      const entry = randomUUID();
      await c.query(`insert into radcore.journal_entries (id, number, kind, business_date, source_table, source_id, reason)
        values ($1, $2, 'manual', $3, 'journal_entries', $1, 'raw')`, [entry, `RAW/${letters()}`, DAY]);
      expect(await code(c.query(`insert into radcore.journal_lines (entry_id, line_no, entry_kind, business_date, account_id,
        account_control_kind, debit, credit) values ($1, 1, 'manual', $2, $3, 'none', 5, 0)`, [entry, DAY, travel]))).toBe('RA009');
    } finally {
      await c.query('rollback');
      c.release();
    }
    // A reversal of an entry already on it still posts, so an old entry can be cancelled.
    expect(await code(run((ctx) => reverseJournalEntry(ctx, { id: spent.id, businessDate: DAY, reason: 'Wrong head' })))).toBe('ok');
    expect(moved.number).toMatch(/^JV\/27-28\//);
    // Switching back on is always allowed, and the account posts again.
    expect(await code(run((ctx) => changeAccount(ctx, { id: travel, active: true, reason: 'Back in use' })))).toBe('ok');
    expect(await code(post(travel, bank, '5.00'))).toBe('ok');
  });
});
