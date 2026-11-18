// RAD-86 (M2-03; ADR-006 §2, §3; ADR-005 §2, §6, §7; RC-004, RC-093, RC-206) on a real PostgreSQL 16, as the app
// login. The books are only posted and reversed; every entry balances, checked at commit; nothing posts in a locked
// period; numbers are gap-free; a manual journal touches ordinary accounts only; and the database refuses each of
// these even when the engine is skipped. Business dates are in 2026-27 unless a test needs another year; the period
// lock test works in 2025-26, so nothing else here is dated where it locks.
import { randomBytes, randomUUID } from 'node:crypto';
import { openFinancialYear, postEntry, postManualJournal, reverseEntry, type JournalLine } from '@radcore/lib-accounts';
import { ENTRY_KINDS, POSTING_RULES, SYSTEM_ACCOUNTS, type Money } from '@radcore/lib-common';
import type { Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const write = { readOnly: false, isolation: 'read committed' } as const;
const staff: Principal = { kind: 'user', userId: randomUUID(), permissions: [] };
const letters = () => [...randomBytes(8)].map((b) => String.fromCharCode(97 + (b % 26))).join('');
const m = (s: string) => s as Money;
const DAY = '2026-11-14';
const dr = (system: string, amount: string, more: Partial<JournalLine> = {}): JournalLine => ({ account: { system }, debit: m(amount), ...more });
const cr = (system: string, amount: string, more: Partial<JournalLine> = {}): JournalLine => ({ account: { system }, credit: m(amount), ...more });

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the journal tests must run, not skip');
});

describe.skipIf(!url || !superUrl)('the journal', { timeout: 30_000 }, () => {
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  const admin = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  const run = <T>(work: Parameters<typeof runInTransaction<T>>[4]) => runInTransaction(db, write, staff, randomUUID(), work);
  // An AppError's code, or the SQLSTATE under Drizzle's wrapper; 'ok' when it succeeds.
  const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) =>
    (e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code ?? String(e));
  // Raw statements as the app login, in one transaction that commits, so a deferred check runs: its SQLSTATE, or 'ok'.
  async function asApp(statements: (ids: { entry: string }) => [string, unknown[]][]): Promise<string> {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query("set local app.principal = 'system:test'");
      for (const [text, values] of statements({ entry: randomUUID() })) await c.query(text, values);
      await c.query('commit');
      return 'ok';
    } catch (e) {
      await c.query('rollback');
      // A foreign key's refusal names the key, so a test can tell which one refused.
      const err = e as { code?: string; constraint?: string };
      return err.code === '23503' ? `23503 ${err.constraint ?? ''}` : err.code ?? 'error';
    } finally {
      c.release();
    }
  }
  async function asAdmin<T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
    const c = await admin.connect();
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
  const accountId = async (system: string) =>
    (await pool.query<{ id: string }>('select id from radcore.accounts where system_key = $1', [system])).rows[0]?.id ?? '';
  const source = () => ({ table: 'files', id: randomUUID() });
  // A raw entry and its lines, as a service skipping the engine would write them.
  const rawEntry = (id: string, kind = 'opening', more: { reverses?: string } = {}): [string, unknown[]] =>
    [`insert into radcore.journal_entries (id, number, kind, business_date, source_table, source_id, reverses_entry_id)
      values ($1, $2, $3, $4, 'files', $5, $6)`, [id, `RAW/${letters()}`, kind, DAY, randomUUID(), more.reverses ?? null]];
  const rawLine = (entry: string, n: number, account: string, control: string, side: { debit?: string; credit?: string },
    kind = 'opening'): [string, unknown[]] =>
    [`insert into radcore.journal_lines (entry_id, line_no, entry_kind, business_date, account_id, account_control_kind, debit, credit)
      values ($1, $2, $3, $4, $5, $6, $7, $8)`, [entry, n, kind, DAY, account, control, side.debit ?? '0', side.credit ?? '0']];

  beforeAll(async () => {
    await run(async (ctx) => {
      await openFinancialYear(ctx, '2025-06-01');
      await openFinancialYear(ctx, DAY);
    });
  });
  afterAll(async () => {
    await pool.end();
    await admin.end();
  });

  it('holds the same posting rules, system accounts and entry kinds as lib-common', async () => {
    const rules = (await pool.query<{ control_kind: string; entry_kind: string }>('select control_kind, entry_kind from radcore.posting_rules')).rows;
    expect(rules.map((r) => `${r.control_kind}:${r.entry_kind}`).toSorted())
      .toEqual(Object.entries(POSTING_RULES).flatMap(([c, kinds]) => kinds.map((k) => `${c}:${k}`)).toSorted());
    const chart = (await pool.query<{ system_key: string; name: string; type: string; control_kind: string }>(
      'select system_key, name, type, control_kind from radcore.accounts where system_key is not null')).rows;
    expect(chart.map((a) => ({ key: a.system_key, name: a.name, type: a.type, control: a.control_kind }))
      .toSorted((a, b) => a.key.localeCompare(b.key)))
      .toEqual([...SYSTEM_ACCOUNTS].toSorted((a, b) => a.key.localeCompare(b.key)));
    const [kinds] = (await pool.query<{ def: string }>(`select pg_get_constraintdef(oid) as def from pg_constraint
      where conname = 'ck_journal_entries_kind'`)).rows;
    expect([...(kinds?.def ?? '').matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).toSorted()).toEqual([...ENTRY_KINDS].toSorted());
  });

  it('posts a balanced entry, numbered from the journal series, with business date and posting time on every row', async () => {
    const posted = await run((ctx) => postEntry(ctx, { kind: 'opening', businessDate: DAY, source: source(),
      lines: [dr('cash', '1000.00'), cr('opening_equity', '1000.00')] }));
    // Seven digits: nearly every document posts an entry (the architect on #171).
    expect(posted.number).toMatch(/^JV\/26-27\/\d{7}$/);
    const lines = (await pool.query<{ line_no: number; debit: string; credit: string; business_date: string; posted_at: Date | null }>(
      `select line_no, debit, credit, to_char(business_date, 'YYYY-MM-DD') as business_date, posted_at
       from radcore.journal_lines where entry_id = $1 order by line_no`, [posted.id])).rows;
    expect(lines.map((l) => [l.line_no, l.debit, l.credit, l.business_date, l.posted_at !== null]))
      .toEqual([[1, '1000.00', '0.00', DAY, true], [2, '0.00', '1000.00', DAY, true]]);
  });

  it('refuses an unbalanced entry in the engine, and in the database at commit when the engine is skipped (RA002)', async () => {
    expect(await code(run((ctx) => postEntry(ctx, { kind: 'opening', businessDate: DAY, source: source(),
      lines: [dr('cash', '100.00'), cr('opening_equity', '99.99')] })))).toBe('unbalanced');
    const cash = await accountId('cash');
    const equity = await accountId('opening_equity');
    expect(await asApp(({ entry }) => [rawEntry(entry), rawLine(entry, 1, cash, 'none', { debit: '100' }),
      rawLine(entry, 2, equity, 'opening', { credit: '99' })])).toBe('RA002');
    // An entry with no lines, or one line, is refused too.
    expect(await asApp(({ entry }) => [rawEntry(entry)])).toBe('RA002');
    expect(await asApp(({ entry }) => [rawEntry(entry), rawLine(entry, 1, cash, 'none', { debit: '100' })])).toBe('RA002');
    // A line with both sides, or neither, never gets that far.
    expect(await asApp(({ entry }) => [rawEntry(entry), rawLine(entry, 1, cash, 'none', { debit: '1', credit: '1' })])).toBe('23514');
  });

  it('never edits or deletes the books: no line is changed, removed, or added to a posted entry (RA001)', async () => {
    const posted = await run((ctx) => postEntry(ctx, { kind: 'opening', businessDate: DAY, source: source(),
      lines: [dr('cash', '50.00'), cr('opening_equity', '50.00')] }));
    // The app login holds no UPDATE or DELETE; the owner, which does, meets the trigger.
    expect(await asApp(() => [['update radcore.journal_lines set debit = 0 where entry_id = $1', [posted.id]]])).toBe('42501');
    expect(await code(asAdmin('update radcore.journal_lines set debit = 0 where entry_id = $1', [posted.id]))).toBe('RA001');
    expect(await code(asAdmin('delete from radcore.journal_entries where id = $1', [posted.id]))).toBe('RA001');
    const cash = await accountId('cash');
    const equity = await accountId('opening_equity');
    expect(await asApp(() => [rawLine(posted.id, 3, cash, 'none', { debit: '5' }), rawLine(posted.id, 4, equity, 'opening', { credit: '5' })]))
      .toBe('RA001');
  });

  it('refuses a business date on or before the period lock, in the engine and in the database (RA003)', async () => {
    await asAdmin("update radcore.period_lock set locked_through = '2025-06-30' where id = 1");
    try {
      const at = (date: string) => code(run((ctx) => postEntry(ctx, { kind: 'opening', businessDate: date, source: source(),
        lines: [dr('cash', '10.00'), cr('opening_equity', '10.00')] })));
      expect(await at('2025-06-30')).toBe('period_locked');
      expect(await at('2025-07-01')).toBe('ok');
      const cash = await accountId('cash');
      const equity = await accountId('opening_equity');
      expect(await asApp(({ entry }) => [
        [`insert into radcore.journal_entries (id, number, kind, business_date, source_table, source_id)
          values ($1, $2, 'opening', '2025-06-15', 'files', $3)`, [entry, `RAW/${letters()}`, randomUUID()]],
        [`insert into radcore.journal_lines (entry_id, line_no, entry_kind, business_date, account_id, account_control_kind, debit)
          values ($1, 1, 'opening', '2025-06-15', $2, 'none', 1), ($1, 2, 'opening', '2025-06-15', $3, 'opening', 0)`, [entry, cash, equity]],
      ])).toBe('RA003');
    } finally {
      await asAdmin('update radcore.period_lock set locked_through = null where id = 1');
    }
  });

  it('refuses a date in a financial year that was never opened, by name, and in the database (RC-111)', async () => {
    expect(await code(run((ctx) => postEntry(ctx, { kind: 'opening', businessDate: '2031-05-01', source: source(),
      lines: [dr('cash', '10.00'), cr('opening_equity', '10.00')] })))).toBe('year_not_open');
    expect(await asApp(({ entry }) => [[`insert into radcore.journal_entries (id, number, kind, business_date, source_table, source_id)
      values ($1, $2, 'opening', '2031-05-01', 'files', $3)`, [entry, `RAW/${letters()}`, randomUUID()]]]))
      .toBe('23503 fk_journal_entries_fy_start');
  });

  it("closes the period lock and an opened year to the app login's own writes (the auditor on #203)", async () => {
    expect(await asApp(() => [["update radcore.period_lock set locked_through = '2030-03-31' where id = 1", []]])).toBe('42501');
    expect(await asApp(() => [['delete from radcore.period_lock', []]])).toBe('42501');
    expect(await asApp(() => [["delete from radcore.financial_years where start = '2026-04-01'", []]])).toBe('42501');
  });

  it('numbers entries without gaps: a save that fails gives its number back (RC-206)', async () => {
    const post = () => run((ctx) => postEntry(ctx, { kind: 'opening', businessDate: DAY, source: source(),
      lines: [dr('cash', '1.00'), cr('opening_equity', '1.00')] }));
    const first = await post();
    await expect(run(async (ctx) => {
      await postEntry(ctx, { kind: 'opening', businessDate: DAY, source: source(), lines: [dr('cash', '2.00'), cr('opening_equity', '2.00')] });
      throw new Error('the document failed after its entry');
    })).rejects.toThrow('the document failed');
    const next = await post();
    const n = (s: string) => Number(s.split('/')[2]);
    expect(n(next.number)).toBe(n(first.number) + 1);
  });

  it('posts a document once per kind: a second entry for it is refused', async () => {
    const doc = source();
    const post = () => run((ctx) => postEntry(ctx, { kind: 'opening', businessDate: DAY, source: doc,
      lines: [dr('cash', '3.00'), cr('opening_equity', '3.00')] }));
    await post();
    expect(await code(post())).toBe('23505');
  });

  it('lets a manual journal touch ordinary accounts only, and says why it was made (RC-093)', async () => {
    // An account people add: ordinary, under no control.
    const c = await pool.connect();
    const rent = await (async () => {
      try {
        await c.query('begin');
        await c.query("set local app.principal = 'system:test'");
        const { rows } = await c.query<{ id: string }>("insert into radcore.accounts (name, type) values ($1, 'expense') returning id",
          [`Rent ${letters()}`]);
        await c.query('commit');
        return rows[0]?.id ?? '';
      } finally {
        c.release();
      }
    })();
    const ok = await run((ctx) => postManualJournal(ctx, { businessDate: DAY, reason: 'November rent, paid in cash',
      lines: [{ account: { id: rent }, debit: m('2500.00') }, cr('cash', '2500.00')] }));
    expect(ok.number).toMatch(/^JV\//);
    for (const control of ['debtors', 'output_cgst', 'tds_payable', 'grni', 'salaries_payable']) {
      expect(await code(run((ctx) => postManualJournal(ctx, { businessDate: DAY, reason: 'moving a balance',
        lines: [dr(control, '1.00', control === 'debtors' ? { partyId: randomUUID() } : {}), cr('cash', '1.00')] })))).toBe('control_account');
    }
  });

  it('refuses a manual line on a control account in the database, however it is written (ADR-006 §2 proof)', async () => {
    const debtors = await accountId('debtors');
    const cash = await accountId('cash');
    const manual = (entry: string): [string, unknown[]] => [`insert into radcore.journal_entries
      (id, number, kind, business_date, source_table, source_id, reason) values ($1, $2, 'manual', $3, 'journal_entries', $1, 'x')`,
      [entry, `RAW/${letters()}`, DAY]];
    const line = (entry: string, control: string | null): [string, unknown[]] => [`insert into radcore.journal_lines
      (entry_id, line_no, entry_kind, business_date, account_id, account_control_kind, debit, party_id)
      values ($1, 1, 'manual', $2, $3, $4, 1, $5)`, [entry, DAY, debtors, control, control === 'party' ? randomUUID() : null]];
    const balance = (entry: string) => rawLine(entry, 2, cash, 'none', { credit: '1' }, 'manual');
    // Left out: NOT NULL. Given as `none`: no such account and kind. Given as `party`: no posting rule for a manual.
    expect(await asApp(({ entry }) => [manual(entry), line(entry, null), balance(entry)])).toBe('23502');
    expect(await asApp(({ entry }) => [manual(entry), line(entry, 'none'), balance(entry)])).toBe('23503 fk_journal_lines_account');
    expect(await asApp(({ entry }) => [manual(entry), line(entry, 'party'), balance(entry)])).toBe('23503 fk_journal_lines_rule');
  });

  it('names the party on every Debtors line, and the item and place on every Stock in Hand line', async () => {
    expect(await code(run((ctx) => postEntry(ctx, { kind: 'opening', businessDate: DAY, source: source(),
      lines: [dr('debtors', '5.00'), cr('opening_equity', '5.00')] })))).toBe('23514');
    expect(await code(run((ctx) => postEntry(ctx, { kind: 'opening', businessDate: DAY, source: source(),
      lines: [dr('debtors', '5.00', { partyId: randomUUID() }), cr('opening_equity', '5.00')] })))).toBe('ok');
    expect(await code(run((ctx) => postEntry(ctx, { kind: 'opening', businessDate: DAY, source: source(),
      lines: [dr('stock', '5.00', { itemId: randomUUID() }), cr('opening_equity', '5.00')] })))).toBe('23514');
    expect(await code(run((ctx) => postEntry(ctx, { kind: 'opening', businessDate: DAY, source: source(),
      lines: [dr('stock', '5.00', { itemId: randomUUID(), locationId: randomUUID() }), cr('opening_equity', '5.00')] })))).toBe('ok');
  });

  it('reverses an entry once, its lines swapped line for line, dated the day of the reversal', async () => {
    const party = randomUUID();
    const original = await run((ctx) => postEntry(ctx, { kind: 'opening', businessDate: DAY, source: source(),
      lines: [dr('debtors', '700.00', { partyId: party }), cr('opening_equity', '700.00')] }));
    const reversal = await run((ctx) => reverseEntry(ctx, { entryId: original.id, businessDate: '2026-11-20' }));
    const lines = (await pool.query<{ line_no: number; debit: string; credit: string; party_id: string | null; d: string }>(
      `select line_no, debit, credit, party_id, to_char(business_date, 'YYYY-MM-DD') as d from radcore.journal_lines
       where entry_id = $1 order by line_no`, [reversal.id])).rows;
    expect(lines).toEqual([{ line_no: 1, debit: '0.00', credit: '700.00', party_id: party, d: '2026-11-20' },
      { line_no: 2, debit: '700.00', credit: '0.00', party_id: null, d: '2026-11-20' }]);
    expect(await code(run((ctx) => reverseEntry(ctx, { entryId: original.id, businessDate: '2026-11-21' })))).toBe('already_reversed');
  });

  it('never reverses a reversal, which would post a cancelled entry again (the auditor on #203)', async () => {
    const original = await run((ctx) => postEntry(ctx, { kind: 'opening', businessDate: DAY, source: source(),
      lines: [dr('cash', '25.00'), cr('opening_equity', '25.00')] }));
    const reversal = await run((ctx) => reverseEntry(ctx, { entryId: original.id, businessDate: DAY }));
    expect(await code(run((ctx) => reverseEntry(ctx, { entryId: reversal.id, businessDate: DAY })))).toBe('reversal_not_reversible');
    // Written raw, the database refuses it at commit: the original's own lines again, reversing the reversal.
    const cash = await accountId('cash');
    const equity = await accountId('opening_equity');
    expect(await asApp(({ entry }) => [rawEntry(entry, 'opening', { reverses: reversal.id }),
      rawLine(entry, 1, cash, 'none', { debit: '25' }), rawLine(entry, 2, equity, 'opening', { credit: '25' })])).toBe('RA002');
  });

  it("refuses, at commit, a reversal that isn't its original's lines swapped (RA002)", async () => {
    const original = await run((ctx) => postEntry(ctx, { kind: 'opening', businessDate: DAY, source: source(),
      lines: [dr('cash', '40.00'), cr('opening_equity', '40.00')] }));
    const cash = await accountId('cash');
    const equity = await accountId('opening_equity');
    // Balanced, but the same way round as the original: not a reversal.
    expect(await asApp(({ entry }) => [rawEntry(entry, 'opening', { reverses: original.id }),
      rawLine(entry, 1, cash, 'none', { debit: '40' }), rawLine(entry, 2, equity, 'opening', { credit: '40' })])).toBe('RA002');
    // A reversal keeps the original's kind.
    expect(await asApp(({ entry }) => [rawEntry(entry, 'transfer', { reverses: original.id }),
      rawLine(entry, 1, cash, 'none', { credit: '40' }, 'transfer'), rawLine(entry, 2, cash, 'none', { debit: '40' }, 'transfer')]))
      .toBe('23503 fk_journal_entries_reverses');
  });

  it('never puts an account group inside itself, however deep (the auditor on #203)', async () => {
    const made: string[] = [];
    const add = async (parent: string | null) => {
      const c = await pool.connect();
      try {
        await c.query('begin');
        await c.query("set local app.principal = 'system:test'");
        const { rows } = await c.query<{ id: string }>("insert into radcore.accounts (name, type, parent_id) values ($1, 'expense', $2) returning id",
          [`Group ${letters()}`, parent]);
        await c.query('commit');
        made.push(rows[0]?.id ?? '');
        return rows[0]?.id ?? '';
      } finally {
        c.release();
      }
    };
    const top = await add(null);
    const middle = await add(top);
    const bottom = await add(middle);
    expect(await asApp(() => [['update radcore.accounts set parent_id = $2 where id = $1', [top, bottom]]])).toBe('23514');
    expect(await asApp(() => [['update radcore.accounts set parent_id = $1 where id = $1', [middle]]])).toBe('23514');
    expect(made).toHaveLength(3);
  });

  it("keeps the system accounts: renamed, never removed, and only they are control accounts", async () => {
    const cash = await accountId('cash');
    expect(await code(asAdmin('delete from radcore.accounts where id = $1', [cash]))).toBe('RA001');
    // The app sets no system key and no control kind: those columns aren't its to write.
    expect(await asApp(() => [["insert into radcore.accounts (name, type, system_key) values ($1, 'asset', 'cash2')", [`X ${letters()}`]]]))
      .toBe('42501');
    expect(await asApp(() => [["insert into radcore.accounts (name, type, control_kind) values ($1, 'asset', 'party')", [`X ${letters()}`]]]))
      .toBe('42501');
    expect(await asApp(() => [['update radcore.accounts set control_kind = $2 where id = $1', [cash, 'gst']]])).toBe('42501');
    const name = `Cash in hand ${letters()}`;
    expect(await asApp(() => [['update radcore.accounts set name = $2 where id = $1', [cash, name]]])).toBe('ok');
    await asAdmin("update radcore.accounts set name = 'Cash' where system_key = 'cash'");
  });
});
