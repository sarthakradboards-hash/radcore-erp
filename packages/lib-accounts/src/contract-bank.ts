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
  errors: ['not_imported'],
});

/** GET /bank/statement-lines (bank:read): an account's statement lines, newest first, a page at a time. */
export const listStatementLinesContract = defineContract({
  method: 'GET', path: '/bank/statement-lines', auth: 'session', perm: 'bank:read', tx: read,
  input: listInput(z.object({ accountId: idString().optional() })),
  output: listOf(z.object({
    id: idString(), accountId: idString(), importId: idString(), rowNo: z.number().int(), valueDate: dateString(), narration: z.string(),
    reference: z.string(), direction: z.enum(['in', 'out']), amount: moneyString(), balance: moneyString({ signed: true }),
  })),
});
