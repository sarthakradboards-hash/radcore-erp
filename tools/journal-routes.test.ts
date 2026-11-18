// RAD-86's routes (M2-16's screens) on a real PostgreSQL 16, as the app login: the chart of accounts with its control
// flags; the journal a page at a time, newest first, each entry with its total, who posted it and whether it was
// reversed; one entry with its lines; a manual journal posted, and an entry reversed, each with a reason and the
// engine's refusals by name. The journal keys are ordinary catalogue keys; posting and reversing move money, so they
// need the second factor (D-19). Entries are dated in 2028-29, a year no other test file posts in.
import { randomUUID } from 'node:crypto';
import {
  chartOfAccounts, journalEntryById, journalPage, openFinancialYear, postEntry, postManual, reverseJournalEntry,
} from '@radcore/lib-accounts';
import type { Money } from '@radcore/lib-common';
import { AppError, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SECOND_FACTOR_KEYS } from '../packages/lib-platform/src/permissions.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const write = { readOnly: false, isolation: 'read committed' } as const;
const AS: Principal = { kind: 'system', name: 'test', permissions: ['journal:read', 'journal:post', 'journal:reverse'] };
const YEAR = { from: '2028-04-01', to: '2029-03-31' };

it('marks posting and reversing a journal as needing the second factor, and reading it not', () => {
  expect(['journal:read', 'journal:post', 'journal:reverse'].map((k) => SECOND_FACTOR_KEYS.includes(k))).toEqual([false, true, true]);
});

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the journal route tests must run, not skip');
});

describe.skipIf(!url || !superUrl)('the journal routes', { timeout: 30_000 }, () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const admin = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  const run = <R>(fn: (ctx: Ctx) => Promise<R>) => runInTransaction(db, write, AS, randomUUID(), fn);
  const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof AppError ? e.code : String(e)));
  const accountOf = async (system: string) =>
    (await pool.query<{ id: string }>('select id from radcore.accounts where system_key = $1', [system])).rows[0]?.id ?? `no ${system}`;
  const m = (s: string) => s as Money;
  const manual = async (date: string, amount: string, more: { debit?: string; credit?: string } = {}) => {
    const [dr, cr] = [await accountOf(more.debit ?? 'round_off'), await accountOf(more.credit ?? 'bank')];
    return run((ctx) => postManual(ctx, { businessDate: date, reason: 'Bank charges',
      lines: [{ accountId: dr, debit: m(amount) }, { accountId: cr, credit: m(amount) }] }));
  };

  beforeAll(async () => {
    await run((ctx) => openFinancialYear(ctx, YEAR.from));
  });
  afterAll(async () => {
    await pool.end();
    await admin.end();
  });

  // Built-in roles only: other test files copy grants into custom roles of their own.
  it('grants the journal keys to admin, owner and accounts, in each role and its template', async () => {
    for (const table of ['role_grants', 'role_templates']) {
      const { rows } = await admin.query<{ permission: string; roles: string[] }>(`select permission, array_agg(role order by role) roles
        from radcore.${table} where permission like 'journal:%' and role in (select role from radcore.role_templates)
        group by permission order by permission`);
      expect(rows, table).toEqual(['journal:post', 'journal:read', 'journal:reverse'].map((permission) =>
        ({ permission, roles: ['accounts', 'admin', 'owner'] })));
    }
  });

  it('lists the chart of accounts with each account’s type, group and control flag', async () => {
    const { items } = await run((ctx) => chartOfAccounts(ctx));
    expect(items.find((a) => a.systemKey === 'debtors')).toMatchObject({ type: 'asset', controlKind: 'party', control: true, parentId: null });
    expect(items.find((a) => a.systemKey === 'cash')).toMatchObject({ type: 'asset', controlKind: 'none', control: false });
  });

  it('posts a manual journal and shows it, with its total, reason, lines and who posted it', async () => {
    const { id, number } = await manual('2028-05-10', '150.00');
    expect(number).toMatch(/^JV\/28-29\/\d{7}$/);
    const entry = await run((ctx) => journalEntryById(ctx, { id }));
    expect(entry).toMatchObject({ id, number, businessDate: '2028-05-10', kind: 'manual', total: '150.00', reason: 'Bank charges',
      reversesEntryId: null, reversedBy: null, postedBy: { kind: 'system', id: 'test', displayName: null } });
    expect(entry.lines).toEqual([
      { lineNo: 1, account: { id: await accountOf('round_off'), name: expect.any(String) }, debit: '150.00', credit: '0.00',
        partyId: null, itemId: null, locationId: null },
      { lineNo: 2, account: { id: await accountOf('bank'), name: expect.any(String) }, debit: '0.00', credit: '150.00',
        partyId: null, itemId: null, locationId: null },
    ]);
    expect(await code(run((ctx) => journalEntryById(ctx, { id: randomUUID() })))).toBe('not_found');
  });

  it('refuses a manual journal by name: a control account, unbalanced, or a year never opened', async () => {
    const [roundOff, bank] = [await accountOf('round_off'), await accountOf('bank')];
    expect(await code(manual('2028-05-11', '10.00', { debit: 'output_cgst' }))).toBe('control_account');
    expect(await code(run((ctx) => postManual(ctx, { businessDate: '2028-05-11', reason: 'x',
      lines: [{ accountId: roundOff, debit: m('10.00') }, { accountId: bank, credit: m('9.00') }] })))).toBe('unbalanced');
    expect(await code(manual('2031-05-11', '10.00'))).toBe('year_not_open');
    expect(await code(run((ctx) => postManual(ctx, { businessDate: '2028-05-11', reason: 'x',
      lines: [{ accountId: randomUUID(), debit: m('10.00') }, { accountId: bank, credit: m('10.00') }] })))).toBe('unknown_account');
  });

  it('reverses an entry once, with a reason, and shows each side of the pair', async () => {
    const original = await manual('2028-06-01', '40.00');
    const reversal = await run((ctx) => reverseJournalEntry(ctx, { id: original.id, businessDate: '2028-06-02', reason: 'Posted twice' }));
    expect(await run((ctx) => journalEntryById(ctx, { id: original.id }))).toMatchObject({ reversedBy: reversal.id });
    expect(await run((ctx) => journalEntryById(ctx, { id: reversal.id }))).toMatchObject({ reversesEntryId: original.id,
      businessDate: '2028-06-02', reason: 'Posted twice', total: '40.00' });
    expect(await code(run((ctx) => reverseJournalEntry(ctx, { id: original.id, businessDate: '2028-06-02', reason: 'Again' }))))
      .toBe('already_reversed');
    expect(await code(run((ctx) => reverseJournalEntry(ctx, { id: reversal.id, businessDate: '2028-06-02', reason: 'Undo' }))))
      .toBe('reversal_not_reversible');
  });

  it("reverses a manual journal only: a document's entry is reversed by cancelling the document (ADR-006 §3)", async () => {
    const opening = await run((ctx) => postEntry(ctx, { kind: 'opening', businessDate: '2028-06-05', source: { table: 'files', id: randomUUID() },
      lines: [{ account: { system: 'cash' }, debit: m('7.00') }, { account: { system: 'opening_equity' }, credit: m('7.00') }] }));
    expect(await code(run((ctx) => reverseJournalEntry(ctx, { id: opening.id, businessDate: '2028-06-06', reason: 'Wrong' }))))
      .toBe('reverse_through_document');
    expect(await run((ctx) => journalEntryById(ctx, { id: opening.id }))).toMatchObject({ reversedBy: null });
    expect(await code(run((ctx) => reverseJournalEntry(ctx, { id: randomUUID(), businessDate: '2028-06-06', reason: 'Wrong' }))))
      .toBe('not_found');
  });

  it('pages the journal newest first, by business date then number, never skipping or repeating, filtered by kind', async () => {
    const posted = [await manual('2028-09-03', '1.00'), await manual('2028-09-01', '2.00'), await manual('2028-09-03', '3.00')];
    const seen: string[] = [];
    let after: string | undefined;
    do {
      const page = await run((ctx) => journalPage(ctx, { limit: 1, filter: { from: '2028-09-01', to: '2028-09-30', kind: 'manual' },
        ...(after === undefined ? {} : { after }) }));
      seen.push(...page.items.map((e) => e.id));
      after = page.next ?? undefined;
    } while (after !== undefined);
    expect(seen).toEqual([posted[2]?.id, posted[0]?.id, posted[1]?.id]);
    const none = await run((ctx) => journalPage(ctx, { limit: 50, filter: { from: '2028-09-01', to: '2028-09-30', kind: 'opening' } }));
    expect(none.items).toEqual([]);
  });
});
