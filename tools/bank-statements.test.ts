// RAD-159 (M5-11; ADR-009 §11; RC-135, RC-136; GL-052) on PostgreSQL 16, as the app login: a bank statement imported into
// a bank account, all or nothing, its lines present once however often it's imported, an earlier month filled in after
// a later one, a hole refused, and an import undone. The worker's two steps run here directly (the file read through
// lib-platform's readTable, then storeStatement), so no job is queued: each test has its own bank account and file.
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  importStatement, readStatementFile, statementFormatOf, statementImportById, statementLinesPage, storeStatement, undoStatementImport,
} from '@radcore/lib-accounts';
import { readTable, type Ctx, type FileStore, type Principal, type Table } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import pg from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';
import writeXlsxFile from 'write-excel-file/node';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
const clerk: Principal = { kind: 'user', userId: randomUUID(), permissions: ['bank:read', 'bank:reconcile', 'statement_files:write'] };
const FORMAT = { dateColumn: 'Date', narrationColumn: 'Narration', referenceColumn: 'Ref', withdrawalColumn: 'Withdrawal',
  depositColumn: 'Deposit', balanceColumn: 'Balance', newestFirst: false };
const HEADER = ['Date', 'Narration', 'Ref', 'Withdrawal', 'Deposit', 'Balance'];
// Each cell quoted, as a bank's export quotes "1,000.00".
const csv = (rows: string[][], sep = ',') => [HEADER, ...rows].map((r) => r.map((c) => `"${c}"`).join(sep)).join('\n');

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the bank statement tests must run, not skip');
});

describe.skipIf(!url || !superUrl)('bank statements', { timeout: 60_000 }, () => {
  // Its own name, so a lock test counts only this file's waiters.
  const APP = `bank-statements-${randomUUID().slice(0, 8)}`;
  const pool = new pg.Pool({ connectionString: url, max: 3, application_name: APP });
  const su = new pg.Pool({ connectionString: superUrl, max: 2 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
    await su.end();
  });
  // No job is queued: the import's two worker steps run below, as the worker would run them.
  const run = <R>(fn: (ctx: Ctx) => Promise<R>) => runInTransaction(db, WRITE, clerk, randomUUID(),
    (ctx) => fn({ ...ctx, jobs: { send: async () => undefined } }));
  const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e as { code?: string }).code ?? String(e));
  const asSystem = async (text: string, values: unknown[]) => (await su.query<{ id: string }>(
    `with p as (select set_config('app.principal', 'system:test', true)) ${text}`, values)).rows[0]?.id ?? '';

  /** A bank account of its own, under Bank. */
  const bankAccount = () => asSystem(`insert into radcore.accounts (name, type, parent_id) select $1, 'asset', id from radcore.accounts, p
    where system_key = 'bank' returning id`, [`Bank ${randomBytes(4).toString('hex')}`]);
  /** A ready statement file whose bytes are `bytes`, and the store that serves them. */
  const file = async (bytes: Uint8Array, contentType = 'text/csv') => {
    const key = `statement/${randomUUID()}`;
    const id = await asSystem(`insert into radcore.files (kind, store_key, filename, content_type, size, status)
      select 'statement', $1, 'statement.csv', $2, $3, 'ready' from p returning id`, [key, contentType, bytes.length]);
    const files = { readFile: async (k: string) => (k === key ? bytes : new Uint8Array()) } as unknown as FileStore;
    return { id, key, contentType, files };
  };
  /** The whole import as the api and the worker do it: the request, the file read, then the job's transaction. */
  async function importFile(accountId: string, bytes: Uint8Array, o: { contentType?: string; format?: typeof FORMAT | null } = {}) {
    const f = await file(bytes, o.contentType);
    const { id } = await run((ctx) => importStatement(ctx, { accountId, fileId: f.id, ...(o.format === null ? {} : { format: o.format ?? FORMAT }) }));
    const before = await readStatementFile({ importId: id, key: f.key, contentType: f.contentType }, { files: f.files });
    await run((ctx) => storeStatement(ctx, { importId: id, key: f.key, contentType: f.contentType }, { jobId: randomUUID(), alert: async () => undefined, before }));
    return run((ctx) => statementImportById(ctx, { id }));
  }
  const text = (s: string) => new TextEncoder().encode(s);
  const lines = async (accountId: string) => (await run((ctx) => statementLinesPage(ctx, { filter: { accountId }, limit: 100 })))
    .items.map((l) => [l.valueDate, l.direction, l.amount, l.balance]);

  const april = [['01-04-2026', 'NEFT ASHA', 'N1', '', '1,000.00', '11,000.00'], ['01-04-2026', 'CHQ 104', 'C104', '1,000.00', '', '10,000.00'],
    ['02-04-2026', 'UPI', '', '250.50', '', '9,749.50']];
  const may = [['01-05-2026', 'NEFT RAVI', 'N2', '', '500.00', '10,249.50']];

  it('imports a statement once, its in and out of one amount on one day both kept, and adds nothing the second time', async () => {
    const account = await bankAccount();
    const first = await importFile(account, text(csv(april)));
    expect([first.status, first.newLines, first.presentLines]).toEqual(['imported', 3, 0]);
    expect(await lines(account)).toEqual([['2026-04-02', 'out', '250.50', '9749.50'], ['2026-04-01', 'out', '1000.00', '10000.00'],
      ['2026-04-01', 'in', '1000.00', '11000.00']]);
    // The layout is kept for the next upload.
    expect((await run((ctx) => statementFormatOf(ctx, { id: account }))).format).toEqual(FORMAT);
    const again = await importFile(account, text(csv([...april, ...may])), { format: null });
    expect([again.status, again.newLines, again.presentLines]).toEqual(['imported', 1, 3]);
  });

  it('fills in an earlier month after a later one, and refuses a hole, naming the row and storing nothing', async () => {
    const account = await bankAccount();
    expect((await importFile(account, text(csv(may)))).status).toBe('imported');
    expect((await importFile(account, text(csv(april)))).newLines).toBe(3);
    const june = await importFile(account, text(csv([['01-06-2026', 'NEFT', 'N3', '', '10.00', '20,000.00']])));
    expect([june.status, june.refusals.map((r) => [r.row, r.code])]).toEqual(['refused', [[2, 'balance_gap']]]);
    // One refused row stores nothing, the good rows around it included.
    const bad = await importFile(account, text(csv([['02-06-2026', 'A', '', '', '10.00', '10,259.50'], ['03-06-2026', 'B', '', '', '10.00', '1.00']])));
    expect([bad.status, bad.refusals.map((r) => [r.row, r.code])]).toEqual(['refused', [[3, 'balance_chain_broken']]]);
    expect(await lines(account)).toHaveLength(4);
  });

  it('refuses a cash account, a first upload with no layout, and a PDF it can’t read yet', async () => {
    const cash = (await su.query<{ id: string }>("select id from radcore.accounts where system_key = 'cash'")).rows[0]?.id ?? '';
    const f = await file(text(csv(april)));
    expect(await code(run((ctx) => importStatement(ctx, { accountId: cash, fileId: f.id, format: FORMAT })))).toBe('not_a_bank_account');
    const account = await bankAccount();
    expect(await code(run((ctx) => importStatement(ctx, { accountId: account, fileId: f.id })))).toBe('statement_format_required');
    const pdf = await importFile(account, text('%PDF-1.7'), { contentType: 'application/pdf' });
    expect([pdf.status, pdf.refusals.map((r) => r.code)]).toEqual(['refused', ['statement_layout_unknown']]);
  });

  it('undoes an import only under the account’s import lock, so it takes turns with an import’s chain check', async () => {
    const account = await bankAccount();
    const done = await importFile(account, text(csv(april)));
    const holder = await su.connect();
    try {
      // An import job of the same account, holding its lock (statement_formats FOR UPDATE).
      await holder.query('begin');
      await holder.query('select account_id from radcore.statement_formats where account_id = $1 for update', [account]);
      const undo = code(run((ctx) => undoStatementImport(ctx, { id: done.id, reason: 'Wrong account' })));
      await vi.waitFor(async () => expect((await su.query<{ n: number }>(`select count(*)::int n from pg_stat_activity
        where application_name = $1 and cardinality(pg_blocking_pids(pid)) > 0`, [APP])).rows[0]?.n).toBe(1), { timeout: 10_000, interval: 20 });
      await holder.query('rollback');
      expect(await undo).toBe('ok');
    } finally {
      await holder.query('rollback').catch(() => undefined);
      holder.release();
    }
  });

  it('undoes an import, once, and the same file then imports again', async () => {
    const account = await bankAccount();
    const done = await importFile(account, text(csv(april)));
    await run((ctx) => undoStatementImport(ctx, { id: done.id, reason: 'Wrong account' }));
    expect(await lines(account)).toEqual([]);
    expect(await code(run((ctx) => undoStatementImport(ctx, { id: done.id, reason: 'Again' })))).toBe('not_imported');
    expect((await importFile(account, text(csv(april)), { format: null })).newLines).toBe(3);
  });

  it('reads an .xlsx, a tab-separated CSV, a Windows-1252 file and a 5 MB file (GL-052)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'radcore-statement-'));
    try {
      const path = join(dir, 'statement.xlsx');
      await writeXlsxFile([HEADER, ...april].map((r) => r.map((value) => ({ value })))).toFile(path);
      const read = (t: Table) => t.rows.length;
      expect(read(await readTable(readFileSync(path)))).toBe(3);
      expect(read(await readTable(text(csv(april, '\t'))))).toBe(3);
      // "Café" in Windows-1252: é is one byte, 0xE9.
      const cafe = Uint8Array.from([...text(`${HEADER.join(',')}\n01-04-2026,Caf`), 0xe9, ...text(',,,10.00,10.00\n')]);
      expect((await readTable(cafe)).rows[0]?.[1]).toBe('Café');
      const big = [...april, ...Array.from({ length: 45_000 }, () => ['', 'x'.repeat(115), '', '', '', ''])];
      const bytes = text(csv(big));
      expect(bytes.length).toBeGreaterThan(5 * 1024 * 1024);
      const account = await bankAccount();
      expect((await importFile(account, bytes)).newLines).toBe(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
