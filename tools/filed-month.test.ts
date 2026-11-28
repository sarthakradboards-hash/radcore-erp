// RAD-156 (M5-08; ADR-009 §5, §7; RC-012) on PostgreSQL 16: a month's return is marked filed only once it has ended,
// in order from gst.filing_start, with the ARN and a snapshot of its GST lines; then every entry kind the return reports
// is refused dated in it (month_filed), by the engine and by the database's trigger behind it, while a payment posts; an
// invoice of a GSTR-1-filed month isn't cancelled, and an expense's cancel posts in the open month; marking waits for a
// posting in flight and its snapshot holds it. In a database of its own: the filed lock is one row, and these tests
// commit moves of it that every other file's postings would meet.
import { randomUUID } from 'node:crypto';
import { filingsPage, markFiling, openFinancialYear, postEntry, reverseEntry, type JournalLine } from '@radcore/lib-accounts';
import { listGstFilings, markGstFiling } from '@radcore/lib-accounts/contract';
import { indiaDate, period, type EntryKind, type Money } from '@radcore/lib-common';
import type { Ctx, Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { freshDatabase } from './test-database.ts';

const adminUrl = process.env['TEST_DATABASE_ADMIN_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
const APP = `filed-month-${randomUUID().slice(0, 8)}`;
const m = (s: string) => s as Money;
const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) =>
  (e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code ?? String(e));

it.runIf(process.env['CI'] && !adminUrl)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_ADMIN_URL is not set: in CI the filed-month tests must run, not skip');
});

describe.skipIf(!adminUrl)('the filed-month lock', { timeout: 60_000 }, () => {
  const own: { pool?: pg.Pool; su?: pg.Pool; db?: ReturnType<typeof createDatabase>; drop?: () => Promise<void> } = {};
  const made = <T>(x: T | undefined): T => {
    if (x === undefined) throw new Error('The database is made in beforeAll');
    return x;
  };
  const su = () => made(own.su);
  const clerk: Principal = { kind: 'user', userId: randomUUID(), permissions: ['gst:file', 'gst:returns', 'journal:post'] };
  const run = <R>(fn: (ctx: Ctx) => Promise<R>) => runInTransaction(made(own.db), WRITE, clerk, randomUUID(), fn);
  const mark = (ret: 'gstr1' | 'gstr3b', month: string, filedOn = `${month.slice(0, 4)}-12-20`, arn = `AA${month.replace('-', '')}0000001`) =>
    run((ctx) => markFiling(ctx, markGstFiling.input.parse({ return: ret, month, arn, filedOn })));
  const fees = async () => ({ id: (await su().query<{ id: string }>("select id from radcore.accounts where name = 'Professional Fees'")).rows[0]?.id ?? '' });
  /** An entry of `kind` on ordinary accounts (a return keys on the entry, not its GST lines: a 0% invoice has none). */
  const entry = async (kind: Exclude<EntryKind, 'manual'>, businessDate: string, lines?: JournalLine[]) => run(async (ctx) =>
    postEntry(ctx, { kind, businessDate, source: { table: 'journal_entries', id: randomUUID() },
      lines: lines ?? [{ account: await fees(), debit: m('100.00') }, { account: { system: 'cash' }, credit: m('100.00') }] }));

  beforeAll(async () => {
    const fresh = await freshDatabase(adminUrl ?? '');
    own.pool = new pg.Pool({ connectionString: fresh.appUrl, max: 6, application_name: APP });
    own.su = new pg.Pool({ connectionString: fresh.superUrl, max: 3 });
    for (const p of [own.pool, own.su]) p.on('error', (e: Error & { code?: string }) => { if (e.code !== '57P01') throw e; });
    own.db = createDatabase(own.pool);
    own.drop = fresh.drop;
    await su().query(`with p as (select set_config('app.principal', 'system:test', true))
      insert into radcore.accounts (name, type) select 'Professional Fees', 'expense' from p`);
    for (const d of ['2025-04-01', '2026-04-01']) await run((ctx) => openFinancialYear(ctx, d));
  }, 120_000);
  afterAll(async () => {
    await own.pool?.end();
    await own.su?.end();
    await own.drop?.();
  }, 120_000);

  it('marks in order once a month ends, then refuses every door of a filed month, and waits for a posting in flight', async () => {
    // Posted before anything is filed: an April invoice and an April expense, cancelled later.
    const aprilInvoice = await entry('invoice', '2025-04-10');
    const aprilExpense = await entry('expense', '2025-04-12');

    expect(await code(mark('gstr3b', '2025-04'))).toBe('filing_start_not_set');
    await su().query(`with p as (select set_config('app.principal', 'system:test', true))
      insert into radcore.settings (key, value) select 'gst.filing_start', '"2025-04"' from p`);
    expect(await code(mark('gstr3b', '2025-05'))).toBe('filing_gap');
    expect(await code(mark('gstr3b', '2025-03'))).toBe('filing_gap');
    expect(await code(mark('gstr3b', '2025-04', '2025-04-30'))).toBe('filed_before_month_end');
    expect(await code(mark('gstr3b', '2025-04', '2099-01-01'))).toBe('date_in_future');
    const current = period(indiaDate(new Date())).label;
    expect(await code(mark('gstr3b', current, indiaDate(new Date())))).toBe('month_not_ended');
    expect(await code(mark('gstr3b', '2025-04', '2025-05-20'))).toBe('ok');
    expect(await code(mark('gstr3b', '2025-04', '2025-05-20'))).toBe('already_filed');

    // Every kind 3B reports is refused in April; a payment posts, and so does an expense in May.
    for (const kind of ['invoice', 'credit_note', 'purchase_bill', 'supplier_return', 'expense'] as const) {
      expect([kind, await code(entry(kind, '2025-04-15'))]).toEqual([kind, 'month_filed']);
    }
    expect(await code(entry('payment_out', '2025-04-15'))).toBe('ok');
    expect(await code(entry('expense', '2025-05-02'))).toBe('ok');
    // The database refuses it too, behind the engine (RA010).
    expect(await code(su().query(`with p as (select set_config('app.principal', 'system:test', true))
      insert into radcore.journal_entries (number, kind, business_date, source_table, source_id)
      select 'JV/TEST/1', 'purchase_bill', '2025-04-15', 'journal_entries', gen_random_uuid() from p`))).toBe('RA010');

    // GSTR-1 filed for April: April's invoice isn't cancelled (a credit note corrects it); April's expense is, in May.
    expect(await code(mark('gstr1', '2025-04', '2025-05-11'))).toBe('ok');
    expect(await code(run((ctx) => reverseEntry(ctx, { entryId: aprilInvoice.id, businessDate: '2025-05-05' })))).toBe('month_filed');
    expect(await code(run((ctx) => reverseEntry(ctx, { entryId: aprilExpense.id, businessDate: '2025-05-05' })))).toBe('ok');

    // Marking May's 3B waits for an expense in flight dated in May, then holds its GST line in the snapshot.
    const gate = Promise.withResolvers<void>();
    const posted = Promise.withResolvers<void>();
    const inFlight = run(async (ctx) => {
      const p = await postEntry(ctx, { kind: 'expense', businessDate: '2025-05-20', source: { table: 'journal_entries', id: randomUUID() },
        lines: [{ account: await fees(), debit: m('100.00') }, { account: { system: 'input_cgst' }, debit: m('9.00') },
          { account: { system: 'input_sgst' }, debit: m('9.00') }, { account: { system: 'cash' }, credit: m('118.00') }] });
      posted.resolve();
      await gate.promise;
      return p;
    });
    await posted.promise;
    const marked = mark('gstr3b', '2025-05', '2025-06-20');
    await vi.waitFor(async () => expect((await su().query<{ n: number }>(`select count(*)::int n from pg_stat_activity
      where application_name = $1 and cardinality(pg_blocking_pids(pid)) > 0`, [APP])).rows[0]?.n).toBe(1), { timeout: 10_000, interval: 20 });
    gate.resolve();
    const { id: source } = await inFlight;
    const { id } = await marked;
    const [row] = (await su().query<{ snapshot: { lines: { kind: string; debit: string }[] }; sha: string }>(
      'select snapshot, snapshot_sha256 sha from radcore.gst_filings where id = $1', [id])).rows;
    expect(row?.snapshot.lines.filter((l) => l.kind === 'expense').map((l) => l.debit)).toEqual(['9.00', '9.00']);
    expect(row?.sha).toMatch(/^[0-9a-f]{64}$/);
    expect(source).toMatch(/^[0-9a-f-]{36}$/);
    expect(await code(entry('expense', '2025-05-25'))).toBe('month_filed');

    // The list, through its contract's own output: newest month first.
    const page = listGstFilings.output.parse(await run((ctx) => filingsPage(ctx, listGstFilings.input.parse({ filter: {}, limit: 10 }))));
    const rows = page.items.map((f) => `${f.month} ${f.return} ${String(f.undone)}`);
    expect([rows[0], rows.slice(1).toSorted()]).toEqual(['2025-05 gstr3b false', ['2025-04 gstr1 false', '2025-04 gstr3b false']]);
  });
});
