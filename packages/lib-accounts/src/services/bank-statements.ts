// Bank statements (M5-11, RAD-159; ADR-009 §11; RC-135, RC-136). The person uploads the bank's file as a `statement`,
// then asks for it to be imported into a bank account; the worker reads it outside any transaction (readTable, in its
// isolate), then checks it and stores its lines in one transaction, all or nothing, under the account's import lock
// (its statement_formats row FOR UPDATE), so two files for one account are judged one after the other.
//   POST /bank/statement-imports -> queued -> job: read file (before) -> readStatement -> chainToStored -> imported | refused
// Nothing posts: statement lines aren't ledger rows.
import { accounts, accountsTx, after, bankStatementLines, statementFormats, statementImports } from '@radcore/db/accounts';
import { idString } from '@radcore/lib-common';
import {
  AppError, decodeCursor, encodeCursor, ImportFileError, readTable, readyFile, type BeforeJob, type Ctx, type JobContract, type JobMeta, type Table,
} from '@radcore/lib-platform';
import { and, asc, between, desc, eq, gt, lt } from 'drizzle-orm';
import { z } from 'zod';
import type {
  getStatementFormatContract, getStatementImportContract, importStatementContract, listStatementLinesContract, undoStatementImportContract,
} from '../contract-bank.ts';
import { chainToStored, readStatement, type Refusal, type StatementLine } from '../rules/statement.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;
const refuse = (code: string, message: string): never => { throw new AppError(code, message); };

/** A bank account: Bank itself, or an account under it (ADR-009 §11). Cash, a party's or any other account is refused. */
async function bankAccount(ctx: Ctx, id: string): Promise<void> {
  const tx = accountsTx(ctx);
  const [a] = await tx.select({ key: accounts.systemKey, parentId: accounts.parentId }).from(accounts).where(eq(accounts.id, id)).limit(1);
  const [parent] = a?.parentId == null ? [] : await tx.select({ key: accounts.systemKey }).from(accounts).where(eq(accounts.id, a.parentId)).limit(1);
  if (a === undefined || !(a.key === 'bank' || parent?.key === 'bank')) refuse('not_a_bank_account', 'Pick a bank account under Bank');
}

const formatColumns = {
  dateColumn: statementFormats.dateColumn, narrationColumn: statementFormats.narrationColumn, referenceColumn: statementFormats.referenceColumn,
  withdrawalColumn: statementFormats.withdrawalColumn, depositColumn: statementFormats.depositColumn, balanceColumn: statementFormats.balanceColumn,
  newestFirst: statementFormats.newestFirst,
};

/** GET /bank/accounts/:id/statement-format. */
export async function statementFormatOf(ctx: Ctx, { id }: In<typeof getStatementFormatContract>): Promise<Out<typeof getStatementFormatContract>> {
  await bankAccount(ctx, id);
  const [format] = await accountsTx(ctx).select(formatColumns).from(statementFormats).where(eq(statementFormats.accountId, id)).limit(1);
  return { format: format ?? null };
}

type JobIn = { importId: string; key: string; contentType: string };
/** Queued by an import's request, run as the person who asked, with bank:reconcile checked again. The key and type come
 * from the file's checked row, never from the browser. */
export const statementImportJob: JobContract<JobIn> = {
  name: 'accounts.statement-import',
  principal: { kind: 'user', perm: 'bank:reconcile' },
  input: z.strictObject({ importId: idString(), key: z.string().min(1).max(200), contentType: z.string().min(1).max(100) }),
  retries: 2,
  timeoutSeconds: 120,
};

/** POST /bank/statement-imports: the layout kept (or the one kept used), the import queued for the worker. */
export async function importStatement(ctx: Ctx, r: In<typeof importStatementContract>): Promise<Out<typeof importStatementContract>> {
  await bankAccount(ctx, r.accountId);
  const file = await readyFile(ctx, 'statement', r.fileId, { wrongKind: ['fileId'] });
  const tx = accountsTx(ctx);
  if (r.format !== undefined) {
    await tx.insert(statementFormats).values({ accountId: r.accountId, ...r.format })
      .onConflictDoUpdate({ target: statementFormats.accountId, set: r.format });
  } else {
    const [kept] = await tx.select({ id: statementFormats.accountId }).from(statementFormats).where(eq(statementFormats.accountId, r.accountId)).limit(1);
    if (kept === undefined) refuse('statement_format_required', 'Say which columns hold the date, narration, amounts and balance: this account’s first statement');
  }
  const [row] = await tx.insert(statementImports).values({ accountId: r.accountId, fileId: r.fileId }).returning({ id: statementImports.id });
  if (row === undefined) throw new Error('The import was not saved');
  await ctx.jobs.send(statementImportJob, { importId: row.id, key: file.key, contentType: file.contentType });
  return { id: row.id };
}

type FileRead = { ok: true; table: Table } | { ok: false; refusal: Refusal };

/** Before the job's transaction: the file read in lib-platform's isolate (ADR-003 §7). A file it can't read is the
 * import's answer; any other failure (S3 down) is retried. */
export const readStatementFile: BeforeJob<JobIn, FileRead> = async ({ key, contentType }, { files }) => {
  // shortcut: a PDF is refused until RAD-159's second PR reads each bank's layout in the worker (unpdf).
  if (contentType === 'application/pdf') {
    return { ok: false, refusal: { row: 0, column: '', code: 'statement_layout_unknown',
      message: 'A PDF statement can’t be read yet: upload the bank’s CSV or Excel statement instead' } };
  }
  try {
    return { ok: true, table: await readTable(await files.readFile(key, 'statement')) };
  } catch (e) {
    if (e instanceof ImportFileError) return { ok: false, refusal: { row: 0, column: '', code: 'statement_unreadable', message: e.message } };
    throw e;
  }
};

const lineColumns = {
  rowNo: bankStatementLines.rowNo, valueDate: bankStatementLines.valueDate, narration: bankStatementLines.narration,
  reference: bankStatementLines.reference, direction: bankStatementLines.direction, amount: bankStatementLines.amount, balance: bankStatementLines.balance,
};
const asLine = (l: { rowNo: number; valueDate: string; narration: string; reference: string; direction: string; amount: string; balance: string }):
  StatementLine => ({ ...l, direction: l.direction === 'in' ? 'in' : 'out', amount: l.amount as StatementLine['amount'],
  balance: l.balance as StatementLine['balance'] });

// At most this many refusals are kept: enough to fix a file by, never a second copy of it.
const KEEP_REFUSALS = 200;

/** In the job's transaction: the file's lines checked against the account's stored ones, and stored, or the import
 * refused with every row that refused it. A repeated job finds its import no longer queued and changes nothing. */
export async function storeStatement(ctx: Ctx, { importId }: JobIn, { before }: JobMeta & { before: FileRead }): Promise<void> {
  const tx = accountsTx(ctx);
  const [imp] = await tx.select({ accountId: statementImports.accountId }).from(statementImports)
    .where(and(eq(statementImports.id, importId), eq(statementImports.status, 'queued'))).limit(1).for('update');
  if (imp === undefined) return;
  const [format] = await tx.select(formatColumns).from(statementFormats).where(eq(statementFormats.accountId, imp.accountId)).limit(1).for('update');
  const refused = (refusals: readonly Refusal[]) => tx.update(statementImports)
    .set({ status: 'refused', refusals: refusals.slice(0, KEEP_REFUSALS) }).where(eq(statementImports.id, importId));
  if (format === undefined) throw new Error(`statement import ${importId}: its account has no layout`);
  if (!before.ok) return void await refused([before.refusal]);
  const read = readStatement(before.table, format);
  if (read.refusals.length > 0) return void await refused(read.refusals);
  const first = read.lines[0];
  const last = read.lines.at(-1);
  if (first === undefined || last === undefined) return void await refused([]);
  const of = eq(bankStatementLines.accountId, imp.accountId);
  const [prior] = await tx.select(lineColumns).from(bankStatementLines).where(and(of, lt(bankStatementLines.valueDate, first.valueDate)))
    .orderBy(desc(bankStatementLines.valueDate), desc(bankStatementLines.seq)).limit(1);
  const within = await tx.select(lineColumns).from(bankStatementLines).where(and(of, between(bankStatementLines.valueDate, first.valueDate, last.valueDate)));
  const [next] = await tx.select(lineColumns).from(bankStatementLines).where(and(of, gt(bankStatementLines.valueDate, last.valueDate)))
    .orderBy(asc(bankStatementLines.valueDate), asc(bankStatementLines.seq)).limit(1);
  const chain = chainToStored(read.lines, { within: within.map(asLine), ...(prior === undefined ? {} : { before: asLine(prior) }),
    ...(next === undefined ? {} : { after: asLine(next) }) }, format.balanceColumn);
  if (chain.refusals.length > 0) return void await refused(chain.refusals);
  // In the statement's own order, so seq keeps it; in batches, well under PostgreSQL's 65,535 parameters.
  for (let i = 0; i < chain.fresh.length; i += 1000) {
    await tx.insert(bankStatementLines).values(chain.fresh.slice(i, i + 1000).map((l) => ({ ...l, accountId: imp.accountId, importId })));
  }
  await tx.update(statementImports).set({ status: 'imported', newLines: chain.fresh.length, presentLines: chain.present, refusals: [] })
    .where(eq(statementImports.id, importId));
}

const refusalsOf = z.array(z.object({ row: z.number(), column: z.string(), code: z.string(), message: z.string() }));

/** GET /bank/statement-imports/:id. */
export async function statementImportById(ctx: Ctx, { id }: In<typeof getStatementImportContract>): Promise<Out<typeof getStatementImportContract>> {
  const [r] = await accountsTx(ctx).select().from(statementImports).where(eq(statementImports.id, id)).limit(1);
  if (r === undefined) return refuse('not_found', 'There’s no such import');
  return { id: r.id, accountId: r.accountId, fileId: r.fileId, status: z.enum(['queued', 'imported', 'refused', 'undone']).parse(r.status),
    newLines: r.newLines, presentLines: r.presentLines, refusals: refusalsOf.parse(r.refusals ?? []), createdAt: r.createdAt.toISOString() };
}

/** POST /bank/statement-imports/:id/undo: its lines deleted, each audited with the reason.
 * shortcut: no line can be matched until M5-13, which adds `statement_in_use` here. */
export async function undoStatementImport(ctx: Ctx, { id }: In<typeof undoStatementImportContract>): Promise<Out<typeof undoStatementImportContract>> {
  const tx = accountsTx(ctx);
  const [r] = await tx.select({ status: statementImports.status }).from(statementImports).where(eq(statementImports.id, id)).limit(1).for('update');
  if (r === undefined) return refuse('not_found', 'There’s no such import');
  if (r.status !== 'imported') refuse('not_imported', 'Only an imported statement can be undone');
  await tx.delete(bankStatementLines).where(eq(bankStatementLines.importId, id));
  await tx.update(statementImports).set({ status: 'undone' }).where(eq(statementImports.id, id));
  return {};
}

/** GET /bank/statement-lines: newest first, then the statement's own order backwards, so a page key is unique. */
export async function statementLinesPage(ctx: Ctx, input: In<typeof listStatementLinesContract>): Promise<Out<typeof listStatementLinesContract>> {
  const key = input.after === undefined ? undefined : decodeCursor(z.object({ date: z.iso.date(), seq: z.number().int() }), input.after);
  const rows = await accountsTx(ctx).select({ id: bankStatementLines.id, accountId: bankStatementLines.accountId, importId: bankStatementLines.importId,
    seq: bankStatementLines.seq, ...lineColumns }).from(bankStatementLines)
    .where(and(input.filter.accountId === undefined ? undefined : eq(bankStatementLines.accountId, input.filter.accountId),
      after([bankStatementLines.valueDate, bankStatementLines.seq], key && [key.date, key.seq], 'desc')))
    .orderBy(desc(bankStatementLines.valueDate), desc(bankStatementLines.seq)).limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return { items: page.map((l) => ({ id: l.id, accountId: l.accountId, importId: l.importId, rowNo: l.rowNo, valueDate: l.valueDate,
    narration: l.narration, reference: l.reference, direction: l.direction === 'in' ? 'in' : 'out', amount: l.amount, balance: l.balance })),
    next: rows.length > input.limit && last ? encodeCursor({ date: last.valueDate, seq: last.seq }) : null };
}
