// Bank statements (M5-11, RAD-159; ADR-009 §11; RC-135, RC-136), re-exported by ./contract. The file is uploaded as a
// `statement` (statement_files:write), then imported under bank:reconcile: the worker reads, checks and stores its lines,
// all or nothing. Like every contract file it imports only zod and lib-common (D5).
import { dateString, defineContract, idString, listInput, listOf, momentString, moneyString, reason } from '@radcore/lib-common';
import { z } from 'zod';

const read = { readOnly: true, isolation: 'read committed' } as const;
const write = { readOnly: false, isolation: 'read committed' } as const;
const column = () => z.string().trim().min(1, 'Enter the column’s heading as the bank’s file has it').max(100);

/** An account's statement layout (GL-053): the headings of its columns as the bank's file has them, by which the header
 * row is found below any title lines, and whether the newest line comes first. */
export const statementFormat = z.object({
  dateColumn: column(), narrationColumn: column(), referenceColumn: column().nullable(), withdrawalColumn: column(),
  depositColumn: column(), balanceColumn: column(), newestFirst: z.boolean(),
});

/** GET /bank/accounts/:id/statement-format (bank:read): the layout the account's statements were last read by, or null
 * before its first import. */
export const getStatementFormatContract = defineContract({
  method: 'GET', path: '/bank/accounts/:id/statement-format', auth: 'session', perm: 'bank:read', tx: read,
  input: z.object({ id: idString() }),
  output: z.object({ format: statementFormat.nullable() }),
  errors: ['not_a_bank_account'],
});

/** POST /bank/statement-imports (bank:reconcile): imports an uploaded statement (a ready `statement` file) into a bank
 * account, read by `format` (kept for the account's next upload) or by the one kept. The worker does the rest: GET the
 * import to see what was new, already present or refused. */
export const importStatementContract = defineContract({
  method: 'POST', path: '/bank/statement-imports', auth: 'session', perm: 'bank:reconcile', tx: write,
  input: z.object({ accountId: idString(), fileId: idString(), format: statementFormat.optional() }),
  output: z.object({ id: idString() }),
  errors: ['not_a_bank_account', 'statement_format_required', 'upload_refused', 'not_ready', 'wrong_file_kind'],
});

const refusal = z.object({ row: z.number().int().min(0), column: z.string(), code: z.string(), message: z.string() });
const importOut = z.object({
  id: idString(), accountId: idString(), fileId: idString(), status: z.enum(['queued', 'imported', 'refused', 'undone']),
  newLines: z.number().int().nullable(), presentLines: z.number().int().nullable(), refusals: z.array(refusal), createdAt: momentString(),
});

/** GET /bank/statement-imports (bank:read): an account's imports (or every account's), newest first, each with how many
 * rows refused it and whether it can be undone now (RAD-159, e2e-2): the way back to an import after a reload. */
export const listStatementImportsContract = defineContract({
  method: 'GET', path: '/bank/statement-imports', auth: 'session', perm: 'bank:read', tx: read,
  input: listInput(z.object({ accountId: idString().optional() })),
  output: listOf(importOut.omit({ refusals: true }).extend({ refused: z.number().int().min(0), undoable: z.boolean() })),
});

/** GET /bank/statement-imports/:id (bank:read): where an import stands, and every row that refused it. */
export const getStatementImportContract = defineContract({
  method: 'GET', path: '/bank/statement-imports/:id', auth: 'session', perm: 'bank:read', tx: read,
  input: z.object({ id: idString() }),
  output: importOut,
});

/** POST /bank/statement-imports/:id/undo (bank:reconcile): takes an import's lines out again, with the reason. */
export const undoStatementImportContract = defineContract({
  method: 'POST', path: '/bank/statement-imports/:id/undo', auth: 'session', perm: 'bank:reconcile', tx: write,
  input: z.object({ id: idString(), reason: reason() }),
  output: z.object({}),
  errors: ['not_imported', 'statement_in_use'],
  // The backstop: a matched line's delete meets the match's foreign key.
  // PostgreSQL 16 (CI, production) raises 23503 for this ON DELETE RESTRICT key; 17 and later raise 23001 (auditor-2 on #459).
  dbErrors: {
    '23503:fk_bank_match_statement_lines_line': { code: 'statement_in_use', message: 'A line of this statement is matched: unmatch it first' },
    '23001:fk_bank_match_statement_lines_line': { code: 'statement_in_use', message: 'A line of this statement is matched: unmatch it first' },
  },
});

/** GET /bank/statement-lines (bank:read): an account's statement lines, newest first, a page at a time. */
export const listStatementLinesContract = defineContract({
  method: 'GET', path: '/bank/statement-lines', auth: 'session', perm: 'bank:read', tx: read,
  input: listInput(z.object({ accountId: idString().optional() })),
  output: listOf(z.object({
    id: idString(), accountId: idString(), importId: idString(), rowNo: z.number().int(), valueDate: dateString(), narration: z.string(),
    reference: z.string(), direction: z.enum(['in', 'out']), amount: moneyString(), balance: moneyString({ signed: true }),
    /** The live match it's in (RAD-165), or null. */
    matchId: idString().nullable(),
  })),
});

// Matching (M5-13, RAD-165; ADR-009 §12): what a match can meet, by name, and what the database refuses at commit.
const MATCH_DB_ERRORS = {
  'RA006:match_unbalanced': { code: 'match_unbalanced', message: 'The statement lines and the book lines don’t come to the same amount' },
  'RA006:match_other_account': { code: 'not_this_account', message: 'A match joins lines of one bank account' },
  'RA006:match_entry_reversed': { code: 'entry_reversed', message: 'A book line here belongs to a cancelled or reversing entry' },
  '23505:ux_bank_match_statement_lines_line': { code: 'already_matched', message: 'A line here is already matched: unmatch it first' },
  '23505:ux_bank_match_journal_lines_line': { code: 'already_matched', message: 'A line here is already matched: unmatch it first' },
} as const;
/** For a document's cancel: a matched entry isn't reversed, by name or, as a backstop, by the database. */
export const BANK_MATCHED_DB_ERROR = {
  'RA006:bank_matched': { code: 'bank_matched', message: 'This is matched to the bank statement: unmatch it first' },
} as const;

/** GET /bank/statement-lines/:id/candidates (bank:read): the book lines a statement line may match, best first: the
 * same signed amount on its account, dated within `accounts.bank_match_days`, unmatched and live, ranked by reference, then the
 * party's name in the narration (`whole`, or a `word` of five letters or more), then the nearest date. */
export const listMatchCandidatesContract = defineContract({
  method: 'GET', path: '/bank/statement-lines/:id/candidates', auth: 'session', perm: 'bank:read', tx: read,
  input: z.object({ id: idString() }),
  output: z.object({ candidates: z.array(z.object({
    journalLineId: idString(), entryId: idString(), entryNumber: z.string(), kind: z.string(), businessDate: dateString(),
    source: z.object({ table: z.string(), id: idString() }), reference: z.string().nullable(), party: z.string().nullable(),
    byReference: z.boolean(), byParty: z.enum(['whole', 'word']).nullable(), daysApart: z.number().int().min(0),
  })) }),
});

/** POST /bank/matches (bank:reconcile): one or more statement lines with one or more book lines of one bank account,
 * their signed totals equal (RC-210). */
export const matchLinesContract = defineContract({
  method: 'POST', path: '/bank/matches', auth: 'session', perm: 'bank:reconcile', tx: write,
  input: z.object({ statementLineIds: z.array(idString()).min(1).max(50), journalLineIds: z.array(idString()).min(1).max(50) }),
  output: z.object({ id: idString() }),
  errors: ['already_matched', 'entry_reversed', 'match_unbalanced', 'not_this_account'],
  dbErrors: MATCH_DB_ERRORS,
});

/** POST /bank/matches/:id/unmatch (bank:reconcile): undoes a match, with the reason, at any time. */
export const unmatchContract = defineContract({
  method: 'POST', path: '/bank/matches/:id/unmatch', auth: 'session', perm: 'bank:reconcile', tx: write,
  input: z.object({ id: idString(), reason: reason() }),
  output: z.object({}),
  errors: ['not_matched'],
});

/** GET /bank/accounts/:id/book-lines (bank:read): a bank account's book lines not yet matched, of live entries, newest
 * first, a page at a time, filtered by dates, direction (`in`, money into the account) and amount: the many entries a
 * person picks for one match (RC-210; the architect on RAD-165). */
export const listBookLinesContract = defineContract({
  method: 'GET', path: '/bank/accounts/:id/book-lines', auth: 'session', perm: 'bank:read', tx: read,
  input: listInput(z.object({ from: dateString().optional(), to: dateString().optional(), direction: z.enum(['in', 'out']).optional(),
    amount: moneyString().optional() })).extend({ id: idString() }),
  output: listOf(z.object({
    journalLineId: idString(), entryId: idString(), entryNumber: z.string(), kind: z.string(), businessDate: dateString(),
    direction: z.enum(['in', 'out']), amount: moneyString(), source: z.object({ table: z.string(), id: idString() }),
    reference: z.string().nullable(), party: z.string().nullable(),
  })),
  errors: ['not_a_bank_account'],
});
