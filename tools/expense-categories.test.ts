// RAD-152 (M5-02; ADR-009 §2, §3, §10) on a real PostgreSQL, as the runtime login: expense categories and the accounts
// each may post to. The database holds a category to ordinary expense accounts (a composite key to accounts' id, type
// and control kind), so one pointed at Bank or Debtors is refused even past the service; the service names the account
// picked wrong. Every name is the test's own, so the shuffled files share nothing.
import { randomUUID } from 'node:crypto';
import { addExpenseCategory, changeExpenseCategory, expenseCategoriesList, systemAccountId } from '@radcore/lib-accounts';
import { createExpenseCategory, setExpenseCategory } from '@radcore/lib-accounts/contract';
import { AppError, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { rawOf } from '../packages/db/src/tx.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
const staff: Principal = { kind: 'user', userId: randomUUID(), permissions: ['accounts:write', 'journal:read'] };
const named = (what: string) => `${what} ${randomUUID().slice(0, 8)}`;

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the expense category tests must run, not skip');
});

it('refuses a blocked category with no clause, an allowed one with a clause, and a clause 17(5) doesn’t have', () => {
  const accountIds = [randomUUID()];
  expect(createExpenseCategory.input.safeParse({ name: 'Staff welfare', credit: 'blocked', blockedClause: null, accountIds }).success).toBe(false);
  expect(createExpenseCategory.input.safeParse({ name: 'Staff welfare', credit: 'blocked', blockedClause: '(b)(i)', accountIds }).success).toBe(true);
  expect(createExpenseCategory.input.safeParse({ name: 'Travel', credit: 'allowed', blockedClause: '(b)', accountIds }).success).toBe(false);
  expect(createExpenseCategory.input.safeParse({ name: 'Travel', credit: 'blocked', blockedClause: '(z)', accountIds }).success).toBe(false);
  // Only (b) has sub-clauses (the auditor on #425).
  expect(createExpenseCategory.input.safeParse({ name: 'Travel', credit: 'blocked', blockedClause: '(h)(i)', accountIds }).success).toBe(false);
  expect(createExpenseCategory.input.safeParse({ name: 'Travel', credit: 'blocked', blockedClause: '(b)', accountIds: [...accountIds, ...accountIds] }).success).toBe(false);
  expect(setExpenseCategory.input.safeParse({ id: randomUUID(), credit: 'blocked', reason: 'CA-05' }).success).toBe(false);
  expect(setExpenseCategory.input.safeParse({ id: randomUUID(), credit: 'allowed', reason: 'CA-05' }).success).toBe(true);
});

describe.skipIf(!url || !superUrl)('expense categories', { timeout: 30_000 }, () => {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  const su = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
    await su.end();
  });
  const as = <R>(fn: (ctx: Ctx) => Promise<R>) => runInTransaction(db, WRITE, staff, randomUUID(), fn);
  const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof AppError ? e.code
    : (e as { cause?: { constraint?: string } }).cause?.constraint ?? String(e)));
  /** An account as a person adds one under the chart's groups. */
  const account = async (type: string, active = true) => {
    const c = await su.connect();
    try {
      await c.query('begin');
      await c.query("select set_config('app.principal', 'system:test', true)");
      const { rows } = await c.query<{ id: string }>('insert into radcore.accounts (name, type, active) values ($1, $2, $3) returning id',
        [named(`Test ${type}`), type, active]);
      await c.query('commit');
      return rows[0]?.id ?? '';
    } finally {
      c.release();
    }
  };
  const find = async (id: string) => (await as(expenseCategoriesList)).items.find((c) => c.id === id);

  it('adds a blocked category on two expense accounts, then allows it on one, and switches it off', async () => {
    const [travel, meals] = [await account('expense'), await account('expense')];
    const name = named('Staff welfare');
    const { id } = await as((ctx) => addExpenseCategory(ctx, createExpenseCategory.input.parse({ name, credit: 'blocked', blockedClause: '(b)(i)', accountIds: [travel, meals] })));
    const made = await find(id);
    expect([made?.name, made?.credit, made?.blockedClause, made?.active]).toEqual([name, 'blocked', '(b)(i)', true]);
    expect(made?.accounts.map((a) => a.id).sort()).toEqual([travel, meals].sort());
    await as((ctx) => changeExpenseCategory(ctx, setExpenseCategory.input.parse({ id, credit: 'allowed', accountIds: [meals], reason: 'CA-05' })));
    const allowed = await find(id);
    expect([allowed?.credit, allowed?.blockedClause, allowed?.accounts.map((a) => a.id)]).toEqual(['allowed', null, [meals]]);
    await as((ctx) => changeExpenseCategory(ctx, setExpenseCategory.input.parse({ id, active: false, reason: 'Not used' })));
    expect((await find(id))?.active).toBe(false);
  });

  it('refuses a second category of the same name, whatever its case or spacing', async () => {
    const accountIds = [await account('expense')];
    const name = named('Office rent');
    await as((ctx) => addExpenseCategory(ctx, { name, credit: 'allowed', blockedClause: null, accountIds }));
    expect(await code(as((ctx) => addExpenseCategory(ctx, { name: ` ${name.toUpperCase()}  `.replace(' ', '  '), credit: 'allowed',
      blockedClause: null, accountIds })))).toBe('name_taken');
  });

  it('names Bank, Debtors, an income account or a switched-off one as not an expense account', async () => {
    const ok = await account('expense');
    const wrong = [await as((ctx) => systemAccountId(ctx, 'bank')), await as((ctx) => systemAccountId(ctx, 'debtors')), await account('income'),
      await account('expense', false), randomUUID()];
    for (const bad of wrong) {
      expect(await code(as((ctx) => addExpenseCategory(ctx, { name: named('Travel'), credit: 'allowed', blockedClause: null, accountIds: [ok, bad] }))))
        .toBe('not_an_expense_account');
    }
    const { id } = await as((ctx) => addExpenseCategory(ctx, { name: named('Travel'), credit: 'allowed', blockedClause: null, accountIds: [ok] }));
    expect(await code(as((ctx) => changeExpenseCategory(ctx, { id, accountIds: [wrong[0] ?? ''], reason: 'Test' })))).toBe('not_an_expense_account');
  });

  it('refuses in the database a category pointed at Bank or Debtors, and a blocked one with no clause', async () => {
    const accountIds = [await account('expense')];
    const { id } = await as((ctx) => addExpenseCategory(ctx, { name: named('Travel'), credit: 'allowed', blockedClause: null, accountIds }));
    const raw = (q: ReturnType<typeof sql>) => as((ctx) => rawOf(ctx.tx).execute(q));
    const bank = await as((ctx) => systemAccountId(ctx, 'bank'));
    const debtors = await as((ctx) => systemAccountId(ctx, 'debtors'));
    // As the service would write it (the defaults), the key finds no expense account by that id.
    expect(await code(raw(sql`insert into radcore.expense_category_accounts (category_id, account_id) values (${id}, ${bank})`)))
      .toBe('fk_expense_category_accounts_account');
    // Copying the account's own type and control kind, the CHECK refuses them.
    expect(await code(raw(sql`insert into radcore.expense_category_accounts (category_id, account_id, account_type, account_control_kind)
      values (${id}, ${debtors}, 'asset', 'party')`))).toBe('ck_expense_category_accounts_ordinary');
    expect(await code(raw(sql`insert into radcore.expense_categories (name, credit) values (${named('Gifts')}, 'blocked')`)))
      .toBe('ck_expense_categories_clause');
    expect(await code(raw(sql`insert into radcore.expense_categories (name, credit, blocked_clause) values (${named('Gifts')}, 'allowed', '(h)')`)))
      .toBe('ck_expense_categories_clause');
  });
});
