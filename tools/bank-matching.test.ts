// RAD-165 (M5-13; ADR-009 §12; RC-145, RC-210) on PostgreSQL 16, as the app login: a statement line's candidates are
// the unmatched live book lines of its amount on its account, ranked by reference, then the party's name, then the date;
// a match joins lines whose signed totals agree, one entry over two bank lines or two entries over one, checked at
// commit; a matched document's cancel and a matched import's undo are refused until it's unmatched; a match waits for a
// cancel holding the document. Each test has its own bank account and its own statement lines, written as rows.
import { randomBytes, randomUUID } from 'node:crypto';
import {
  AUTO_MATCH_BATCH, autoMatch, autoMatchBatch, bookCharge, bookLinesPage, cancelPayment, matchCandidates, matchLines, openFinancialYear,
  reconciliation, recordPayment, statementImportsPage, statementLinesPage, undoStatementImport,
  unmatch,
} from '@radcore/lib-accounts';
import { moneyString } from '@radcore/lib-common';
import type { Ctx, Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
const clerk: Principal = { kind: 'user', userId: randomUUID(), permissions: ['bank:read', 'bank:reconcile', 'payments:write'] };
// A fixed past day, so no test reads the run date (RC-156).
const DAY = '2026-11-10';
const m = (s: string) => moneyString().parse(s);
const tag = () => randomBytes(3).toString('hex');

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the bank matching tests must run, not skip');
});

describe.skipIf(!url || !superUrl)('bank matching', { timeout: 60_000 }, () => {
  const APP = `bank-matching-${randomUUID().slice(0, 8)}`;
  const pool = new pg.Pool({ connectionString: url, max: 4, application_name: APP });
  const su = new pg.Pool({ connectionString: superUrl, max: 2 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
    await su.end();
  });
  const run = <R>(fn: (ctx: Ctx) => Promise<R>) => runInTransaction(db, WRITE, clerk, randomUUID(), fn);
  const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e as { code?: string }).code ?? String(e));
  const q = async (text: string, values: unknown[] = []) => (await su.query<{ id: string }>(
    `with p as (select set_config('app.principal', 'system:test', true)) ${text}`, values)).rows[0]?.id ?? '';
  beforeAll(async () => {
    await run((ctx) => openFinancialYear(ctx, DAY));
  });

  /** A bank account of its own, with an imported statement holding `lines` ([direction, amount, narration, reference]). */
  async function statement(lines: readonly ([string, string, string, string] | [string, string, string, string, string])[]) {
    const bank = await q(`insert into radcore.accounts (name, type, parent_id) select $1, 'asset', a.id from radcore.accounts a, p
      where a.system_key = 'bank' returning id`, [`Bank ${tag()}`]);
    const file = await q(`insert into radcore.files (kind, store_key, filename, content_type, size, status)
      select 'statement', $1, 'statement.csv', 'text/csv', 10, 'ready' from p returning id`, [`statement/${randomUUID()}`]);
    const imported = await q(`insert into radcore.statement_imports (account_id, file_id, status, new_lines, present_lines, refusals)
      select $1, $2, 'imported', $3, 0, '[]'::jsonb from p returning id`, [bank, file, lines.length]);
    const ids: string[] = [];
    let balance = 0;
    for (const [i, [direction, amount, narration, reference, valueDate = DAY]] of lines.entries()) {
      balance += direction === 'in' ? Number(amount) : -Number(amount);
      ids.push(await q(`insert into radcore.bank_statement_lines (account_id, import_id, row_no, value_date, narration, reference, direction,
        amount, balance) select $1, $2, $3, $4, $5, $6, $7, $8, $9 from p returning id`,
      [bank, imported, i + 2, valueDate, narration, reference, direction, amount, balance.toFixed(2)]));
    }
    return { bank, imported, lines: ids };
  }
  const party = (name: string) => q('insert into radcore.parties (name, customer, supplier, state_code) select $1, true, true, \'27\' from p returning id',
    [name]);
  /** A posted receipt into the bank account, and its book line there. */
  async function receipt(bank: string, partyId: string, amount: string, reference?: string, businessDate = DAY) {
    const paid = await run((ctx) => recordPayment(ctx, { kind: 'receipt', partyId, businessDate, amount: m(amount), accountId: bank,
      ...(reference === undefined ? {} : { reference }) }));
    const line = (await su.query<{ id: string }>(`select l.id from radcore.journal_lines l join radcore.payments p on p.posted_entry_id = l.entry_id
      where p.id = $1 and l.account_id = $2`, [paid.id, bank])).rows[0]?.id ?? '';
    return { id: paid.id, line };
  }

  it('ranks a line’s candidates by reference, then the party’s whole name, then a word of it, never amount and date alone', async () => {
    const s = await statement([['in', '5000.00', `NEFT/UTR 77123/ASHA MOTORS PUNE ${tag()}`, 'UTR77123']]);
    const asha = await party('Asha Motors');
    const ravi = await party('Ravindra Traders');
    const other = await party(`Other ${tag()}`);
    const byRef = await receipt(s.bank, other, '5000.00', 'UTR77123');
    const byName = await receipt(s.bank, asha, '5000.00');
    const byDate = await receipt(s.bank, ravi, '5000.00', undefined, '2026-11-12');
    const { candidates } = await run((ctx) => matchCandidates(ctx, { id: s.lines[0] ?? '' }));
    expect(candidates.map((c) => [c.journalLineId, c.byReference, c.byParty])).toEqual([
      [byRef.line, true, null], [byName.line, false, 'whole'], [byDate.line, false, null]]);
    // A word of the name, five letters or more, only ranks a line higher.
    const t = await statement([['in', '700.00', 'IMPS RAVINDRA', '']]);
    const word = await receipt(t.bank, ravi, '700.00');
    expect((await run((ctx) => matchCandidates(ctx, { id: t.lines[0] ?? '' }))).candidates.map((c) => [c.journalLineId, c.byParty]))
      .toEqual([[word.line, 'word']]);
  });

  it('matches one entry over two bank lines, and two entries over one, the totals checked', async () => {
    const who = await party(`Split ${tag()}`);
    const s = await statement([['in', '600.00', 'PART 1', ''], ['in', '400.00', 'PART 2', ''], ['in', '300.00', 'TWO RECEIPTS', '']]);
    const one = await receipt(s.bank, who, '1000.00');
    const [a, b] = [await receipt(s.bank, who, '100.00'), await receipt(s.bank, who, '200.00')];
    expect(await code(run((ctx) => matchLines(ctx, { statementLineIds: [s.lines[0] ?? ''], journalLineIds: [one.line] })))).toBe('match_unbalanced');
    await run((ctx) => matchLines(ctx, { statementLineIds: [s.lines[0] ?? '', s.lines[1] ?? ''], journalLineIds: [one.line] }));
    await run((ctx) => matchLines(ctx, { statementLineIds: [s.lines[2] ?? ''], journalLineIds: [a.line, b.line] }));
    expect((await run((ctx) => statementLinesPage(ctx, { filter: { accountId: s.bank }, limit: 10 }))).items.every((l) => l.matchId !== null)).toBe(true);
    // A matched line is matched once.
    expect(await code(run((ctx) => matchLines(ctx, { statementLineIds: [s.lines[2] ?? ''], journalLineIds: [one.line] })))).toBe('already_matched');
  });

  it('refuses a matched receipt’s cancel and a matched import’s undo until it’s unmatched; a cancelled receipt offers only its new one', async () => {
    const who = await party(`Cancel ${tag()}`);
    const s = await statement([['in', '250.00', 'RECEIPT', '']]);
    const first = await receipt(s.bank, who, '250.00');
    const { id: matchId } = await run((ctx) => matchLines(ctx, { statementLineIds: s.lines, journalLineIds: [first.line] }));
    expect(await code(run((ctx) => cancelPayment(ctx, { id: first.id, businessDate: DAY, reason: 'Wrong party' })))).toBe('bank_matched');
    expect(await code(run((ctx) => undoStatementImport(ctx, { id: s.imported, reason: 'Wrong account' })))).toBe('statement_in_use');
    expect((await run((ctx) => statementImportsPage(ctx, { filter: { accountId: s.bank }, limit: 5 }))).items.map((i) => i.undoable)).toEqual([false]);
    await run((ctx) => unmatch(ctx, { id: matchId, reason: 'Wrong party' }));
    expect(await code(run((ctx) => unmatch(ctx, { id: matchId, reason: 'Again' })))).toBe('not_matched');
    await run((ctx) => cancelPayment(ctx, { id: first.id, businessDate: DAY, reason: 'Wrong party' }));
    const again = await receipt(s.bank, who, '250.00');
    expect((await run((ctx) => matchCandidates(ctx, { id: s.lines[0] ?? '' }))).candidates.map((c) => c.journalLineId)).toEqual([again.line]);
    expect(await code(run((ctx) => matchLines(ctx, { statementLineIds: s.lines, journalLineIds: [first.line] })))).toBe('entry_reversed');
  });

  it('books a bank charge or interest from its line, matched, and unmatching reverses it (ADR-009 §12, RC-210)', async () => {
    const s = await statement([['out', '59.00', 'SMS ALERT CHARGES', ''], ['in', '12.50', 'INT CREDIT', '']]);
    const charges = await q("insert into radcore.accounts (name, type) select $1, 'expense' from p returning id", [`Bank charges ${tag()}`]);
    const interest = await q("insert into radcore.accounts (name, type) select $1, 'income' from p returning id", [`Interest ${tag()}`]);
    const linesOf = async (matchId: string) => (await su.query<{ account: string; debit: string; credit: string; reversal: boolean }>(
      `select l.account_id account, l.debit::text, l.credit::text, e.reverses_entry_id is not null reversal from radcore.journal_entries e
       join radcore.journal_lines l on l.entry_id = e.id where e.source_table = 'bank_matches' and e.source_id = $1 and e.kind = 'bank_charge'
       order by reversal, l.line_no`, [matchId])).rows;
    // A charge out goes to an expense account, interest in to an income account: not the other way, nor to the bank.
    expect(await code(run((ctx) => bookCharge(ctx, { id: s.lines[0] ?? '', accountId: interest })))).toBe('not_a_charge_account');
    expect(await code(run((ctx) => bookCharge(ctx, { id: s.lines[0] ?? '', accountId: s.bank })))).toBe('not_a_charge_account');
    const charge = await run((ctx) => bookCharge(ctx, { id: s.lines[0] ?? '', accountId: charges }));
    expect(await linesOf(charge.matchId)).toEqual([{ account: charges, debit: '59.00', credit: '0.00', reversal: false },
      { account: s.bank, debit: '0.00', credit: '59.00', reversal: false }]);
    const credit = await run((ctx) => bookCharge(ctx, { id: s.lines[1] ?? '', accountId: interest }));
    expect((await linesOf(credit.matchId)).map((l) => [l.account, l.debit, l.credit])).toEqual([[s.bank, '12.50', '0.00'], [interest, '0.00', '12.50']]);
    expect((await run((ctx) => statementLinesPage(ctx, { filter: { accountId: s.bank }, limit: 5 }))).items.map((l) => l.matchId).toSorted())
      .toEqual([charge.matchId, credit.matchId].toSorted());
    expect(await code(run((ctx) => bookCharge(ctx, { id: s.lines[0] ?? '', accountId: charges })))).toBe('already_matched');
    // Unmatched (the bank's tax invoice came, say): the charge is reversed, so it's booked once, and the line is free.
    await run((ctx) => unmatch(ctx, { id: charge.matchId, reason: 'Tax invoice came' }));
    const after = await linesOf(charge.matchId);
    expect(after.filter((l) => l.reversal).map((l) => [l.account, l.debit, l.credit])).toEqual([[charges, '0.00', '59.00'], [s.bank, '59.00', '0.00']]);
    expect((await run((ctx) => statementLinesPage(ctx, { filter: { accountId: s.bank }, limit: 5 }))).items.find((l) => l.id === s.lines[0])?.matchId)
      .toBeNull();
  });

  it('lists an account’s unmatched live book lines for a many-to-many match, newest first, filtered (the architect on RAD-165)', async () => {
    const who = await party(`Book ${tag()}`);
    const s = await statement([['in', '10.00', 'MATCHED', '']]);
    const matched = await receipt(s.bank, who, '10.00');
    await run((ctx) => matchLines(ctx, { statementLineIds: s.lines, journalLineIds: [matched.line] }));
    const cancelled = await receipt(s.bank, who, '20.00');
    await run((ctx) => cancelPayment(ctx, { id: cancelled.id, businessDate: DAY, reason: 'Twice' }));
    const [early, late] = [await receipt(s.bank, who, '30.00', undefined, '2026-11-08'), await receipt(s.bank, who, '40.00')];
    const paidOut = await run((ctx) => recordPayment(ctx, { kind: 'payment', partyId: who, businessDate: DAY, amount: m('50.00'), accountId: s.bank }));
    const page = (filter: Parameters<typeof bookLinesPage>[1]['filter'], limit = 10, after?: string) =>
      run((ctx) => bookLinesPage(ctx, { id: s.bank, filter, limit, ...(after === undefined ? {} : { after }) }));
    // Neither the matched receipt nor the cancelled one, nor its reversal: only the live, unmatched lines.
    expect((await page({})).items.map((l) => [l.direction, l.amount]).toSorted()).toEqual([['in', '30.00'], ['in', '40.00'], ['out', '50.00']]);
    expect((await page({ direction: 'in', amount: m('40.00') })).items.map((l) => l.journalLineId)).toEqual([late.line]);
    expect((await page({ to: '2026-11-09' })).items.map((l) => l.journalLineId)).toEqual([early.line]);
    expect((await page({ direction: 'out' })).items.map((l) => l.source.id)).toEqual([paidOut.id]);
    const first = await page({}, 2);
    const rest = await page({}, 2, first.next ?? '');
    expect([first.items.length, rest.items.length, rest.next]).toEqual([2, 1, null]);
    const cash = (await su.query<{ id: string }>("select id from radcore.accounts where system_key = 'cash'")).rows[0]?.id ?? '';
    expect(await code(run((ctx) => bookLinesPage(ctx, { id: cash, filter: {}, limit: 5 })))).toBe('not_a_bank_account');
  });

  it('waits for a match holding a statement line before it judges an undo (auditor-2 on #454)', async () => {
    const s = await statement([['in', '40.00', 'HELD', '']]);
    const paid = await receipt(s.bank, await party(`Held ${tag()}`), '40.00');
    const holder = await su.connect();
    try {
      // A match in flight: its statement line held FOR UPDATE, its rows written, not yet committed.
      await holder.query('begin');
      await holder.query("set local app.principal = 'system:test'");
      await holder.query('select id from radcore.bank_statement_lines where id = $1 for update', [s.lines[0]]);
      const { rows: [match] } = await holder.query<{ id: string }>("insert into radcore.bank_matches (account_id, kind) values ($1, 'manual') returning id", [s.bank]);
      await holder.query('insert into radcore.bank_match_statement_lines (match_id, statement_line_id) values ($1, $2)', [match?.id, s.lines[0]]);
      await holder.query('insert into radcore.bank_match_journal_lines (match_id, journal_line_id) values ($1, $2)', [match?.id, paid.line]);
      const undoing = code(run((ctx) => undoStatementImport(ctx, { id: s.imported, reason: 'Wrong account' })));
      await vi.waitFor(async () => expect((await su.query<{ n: number }>(`select count(*)::int n from pg_stat_activity
        where application_name = $1 and cardinality(pg_blocking_pids(pid)) > 0`, [APP])).rows[0]?.n).toBe(1), { timeout: 10_000, interval: 20 });
      await holder.query('commit');
      // Seen by name once the match commits, never the foreign key's raw refusal.
      expect(await undoing).toBe('statement_in_use');
    } finally {
      await holder.query('rollback').catch(() => undefined);
      holder.release();
    }
  });

  it('auto-matches only a line with one agreeing reference, or one candidate with the party’s whole name, in batches (RC-087)', async () => {
    const name = `Ashwini Cycles ${tag()}`;
    const asha = await party(name);
    const other = await party(`Other ${tag()}`);
    const s = await statement([['in', '310.00', 'NEFT UTR555', 'UTR555'], ['in', '320.00', `IMPS ${name.toUpperCase()}`, ''],
      ['in', '330.00', 'NO CLUE', '']]);
    // Line 1: one receipt with its reference, beside another of the same amount: matched to the reference.
    const byRef = await receipt(s.bank, other, '310.00', 'UTR555');
    await receipt(s.bank, other, '310.00');
    // Line 2: the only candidate, its party named in full in the narration.
    const byName = await receipt(s.bank, asha, '320.00');
    // Line 3: two receipts of its amount and nothing else to tell them apart: left for the person.
    await receipt(s.bank, other, '330.00');
    await receipt(s.bank, other, '330.00');
    const sorted = [...s.lines].toSorted();
    // One line a batch: each call answers where it got to, and null once the import's lines are done.
    const steps: (string | null)[] = [];
    let after: string | null = null;
    for (let i = 0; i < 4 && (i === 0 || after !== null); i++) {
      const from: string | null = after;
      after = await run((ctx) => autoMatchBatch(ctx, s.imported, from, 1));
      steps.push(after);
    }
    expect(steps).toEqual([sorted[0], sorted[1], sorted[2], null]);
    const matched = (await su.query<{ line: string; journal: string; kind: string }>(`select x.statement_line_id line, j.journal_line_id journal, m.kind
      from radcore.bank_match_statement_lines x join radcore.bank_matches m on m.id = x.match_id
      join radcore.bank_match_journal_lines j on j.match_id = m.id where x.statement_line_id = any($1)`, [s.lines])).rows;
    expect(matched.map((r) => [r.line, r.journal, r.kind]).toSorted()).toEqual([[s.lines[0], byRef.line, 'auto'], [s.lines[1], byName.line, 'auto']].toSorted());
  });

  it('skips a line whose candidate a person matches mid-batch, and keeps the batch’s other matches (auditor-2 on #462)', async () => {
    const other = await party(`Other ${tag()}`);
    const s = await statement([['in', '310.00', 'NEFT UTR777', 'UTR777'], ['in', '310.00', 'BY HAND', ''], ['in', '320.00', 'NEFT UTR888', 'UTR888']]);
    const taken = await receipt(s.bank, other, '310.00', 'UTR777');
    const kept = await receipt(s.bank, other, '320.00', 'UTR888');
    // A person matches line 2 to the receipt line 1 would pick, and holds the save open while the batch runs.
    const held = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<void>();
    const manual = run(async (ctx) => {
      await matchLines(ctx, { statementLineIds: [s.lines[1] ?? ''], journalLineIds: [taken.line] });
      held.resolve();
      await gate.promise;
    });
    await held.promise;
    const batch = run((ctx) => autoMatchBatch(ctx, s.imported, null));
    // The batch's link to that receipt waits on the person's unique index entry, then meets their committed match.
    await vi.waitFor(async () => expect((await su.query<{ n: number }>(`select count(*)::int n from pg_stat_activity
      where application_name = $1 and cardinality(pg_blocking_pids(pid)) > 0`, [APP])).rows[0]?.n).toBe(1), { timeout: 10_000, interval: 20 });
    gate.resolve();
    await manual;
    expect(await batch).toBeNull();
    const matched = (await su.query<{ line: string; journal: string; kind: string }>(`select x.statement_line_id line, j.journal_line_id journal, m.kind
      from radcore.bank_match_statement_lines x join radcore.bank_matches m on m.id = x.match_id
      join radcore.bank_match_journal_lines j on j.match_id = m.id where x.statement_line_id = any($1)`, [s.lines])).rows;
    expect(matched.map((r) => [r.line, r.journal, r.kind]).toSorted())
      .toEqual([[s.lines[1], taken.line, 'manual'], [s.lines[2], kept.line, 'auto']].toSorted());
  });

  it('queues the next auto-match batch while an import’s lines remain, and none after the last', async () => {
    const s = await statement([['in', '1.00', 'FIRST', '']]);
    // 500 more lines on the same import, in one insert, so the import holds one more than a batch.
    await q(`insert into radcore.bank_statement_lines (account_id, import_id, row_no, value_date, narration, reference, direction, amount, balance)
      select $1, $2, n + 2, $3, 'BULK', '', 'in', 1, 1 + n from p, generate_series(1, 500) n`, [s.bank, s.imported, DAY]);
    const sent: { importId: string; after: string | null }[] = [];
    const runWith = <R>(fn: (ctx: Ctx) => Promise<R>) => runInTransaction(db, WRITE, clerk, randomUUID(),
      (ctx) => fn({ ...ctx, jobs: { send: async (_job: unknown, input: unknown) => { sent.push(input as { importId: string; after: string | null }); } } }));
    expect(AUTO_MATCH_BATCH).toBe(500);
    await runWith((ctx) => autoMatch(ctx, { importId: s.imported, after: null }));
    expect(sent.map((x) => [x.importId, x.after !== null])).toEqual([[s.imported, true]]);
    await runWith((ctx) => autoMatch(ctx, { importId: s.imported, after: sent[0]?.after ?? null }));
    expect(sent).toHaveLength(1);
  });

  it('reconciles as at a date: book balance, statement balance, and each side’s outstanding lines (GL-132)', async () => {
    const who = await party(`Recon ${tag()}`);
    // The bank: a receipt of 100.00 and interest of 50.00 on the day; next day, 20.00 more.
    const s = await statement([['in', '100.00', 'RECEIPT', ''], ['in', '50.00', 'INTEREST', ''], ['in', '20.00', 'LATE', '', '2026-11-11']]);
    // The books: the 100.00 (matched), 30.00 the bank hasn't shown, 70.00 cancelled the same day, and 20.00 the bank shows
    // the next day.
    const matched = await receipt(s.bank, who, '100.00');
    await run((ctx) => matchLines(ctx, { statementLineIds: [s.lines[0] ?? ''], journalLineIds: [matched.line] }));
    const notInBank = await receipt(s.bank, who, '30.00');
    const cancelled = await receipt(s.bank, who, '70.00');
    await run((ctx) => cancelPayment(ctx, { id: cancelled.id, businessDate: DAY, reason: 'Twice' }));
    const late = await receipt(s.bank, who, '20.00');
    await run((ctx) => matchLines(ctx, { statementLineIds: [s.lines[2] ?? ''], journalLineIds: [late.line] }));
    const r = await run((ctx) => reconciliation(ctx, { id: s.bank, asAt: DAY }));
    expect([r.bookBalance, r.statementBalance, r.unexplained]).toEqual(['150.00', '150.00', '0.00']);
    // As at the day, the 20.00 is matched only to a bank line of the next day: still outstanding then.
    expect([r.notInBank.count, r.notInBank.total, r.notInBank.lines.map((l) => l.journalLineId).toSorted()])
      .toEqual([2, '50.00', [notInBank.line, late.line].toSorted()]);
    expect([r.notInBooks.count, r.notInBooks.total, r.notInBooks.lines.map((l) => l.statementLineId)])
      .toEqual([1, '50.00', [s.lines[1]]]);
    // A day later the 20.00 has cleared.
    const next = await run((ctx) => reconciliation(ctx, { id: s.bank, asAt: '2026-11-11' }));
    expect([next.notInBank.lines.map((l) => l.journalLineId), next.statementBalance, next.unexplained]).toEqual([[notInBank.line], '170.00', '0.00']);
    // Before the first statement line there's no statement balance to reconcile to.
    expect((await run((ctx) => reconciliation(ctx, { id: s.bank, asAt: '2026-11-01' }))).statementBalance).toBeNull();
  });

  it('clears a split match only once every line of it on both sides is dated by then (auditor-2 on #464)', async () => {
    const who = await party(`Split ${tag()}`);
    // A receipt of 100.00 the bank shows as 60.00 on the day and 40.00 the next, matched as one.
    const s = await statement([['in', '60.00', 'PART 1', ''], ['in', '40.00', 'PART 2', '', '2026-11-11']]);
    const book = await receipt(s.bank, who, '100.00');
    await run((ctx) => matchLines(ctx, { statementLineIds: [s.lines[0] ?? '', s.lines[1] ?? ''], journalLineIds: [book.line] }));
    // As at the day: the 100.00 in the books and the 60.00 in the bank are both still outstanding.
    const r = await run((ctx) => reconciliation(ctx, { id: s.bank, asAt: DAY }));
    expect([r.bookBalance, r.statementBalance, r.unexplained]).toEqual(['100.00', '60.00', '0.00']);
    expect([r.notInBank.count, r.notInBank.total, r.notInBank.lines.map((l) => l.journalLineId)]).toEqual([1, '100.00', [book.line]]);
    expect([r.notInBooks.count, r.notInBooks.total, r.notInBooks.lines.map((l) => l.statementLineId)]).toEqual([1, '60.00', [s.lines[0]]]);
    // A day later it has cleared on both sides.
    const next = await run((ctx) => reconciliation(ctx, { id: s.bank, asAt: '2026-11-11' }));
    expect([next.notInBank.count, next.notInBooks.count, next.statementBalance, next.unexplained]).toEqual([0, 0, '100.00', '0.00']);
  });

  it('waits for a cancel holding the receipt before it matches it (ADR-009 §12’s lock order)', async () => {
    const who = await party(`Race ${tag()}`);
    const s = await statement([['in', '90.00', 'RACE', '']]);
    const paid = await receipt(s.bank, who, '90.00');
    const holder = await su.connect();
    try {
      await holder.query('begin');
      await holder.query('select id from radcore.payments where id = $1 for update', [paid.id]);
      const matching = code(run((ctx) => matchLines(ctx, { statementLineIds: s.lines, journalLineIds: [paid.line] })));
      await vi.waitFor(async () => expect((await su.query<{ n: number }>(`select count(*)::int n from pg_stat_activity
        where application_name = $1 and cardinality(pg_blocking_pids(pid)) > 0`, [APP])).rows[0]?.n).toBe(1), { timeout: 10_000, interval: 20 });
      await holder.query('rollback');
      expect(await matching).toBe('ok');
    } finally {
      await holder.query('rollback').catch(() => undefined);
      holder.release();
    }
  });
});
