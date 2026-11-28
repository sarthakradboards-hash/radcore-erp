// Expenses (M5-02, RAD-152; ADR-009 §2, §3), re-exported by ./contract: the categories, each one's credit rule and the
// accounts it may post to, set up under accounts:write; and the expenses themselves, under expenses:read and
// expenses:write, with an owner's override for cash past the day's limit (ADR-007 §8). Like every contract file it
// imports only zod, lib-common and lib-platform's contracts (D5).
import { dateString, dec, defineContract, idString, listInput, listOf, momentString, moneyString, percentString, reason } from '@radcore/lib-common';
import { approvalContracts } from '@radcore/lib-platform/contract';
import { z } from 'zod';
import { BANK_MATCHED_DB_ERROR } from './contract-bank.ts';

const read = { readOnly: true, isolation: 'read committed' } as const;
const write = { readOnly: false, isolation: 'read committed' } as const;

export const EXPENSE_CREDIT = ['allowed', 'blocked'] as const;
/** A clause of section 17(5) as a blocked category names it: (a) to (i), and (b)'s sub-clauses, as "(b)(i)". */
const clause = () => z.string().regex(/^\((a|aa|ab|c|d|e|f|fa|g|h|i)\)$|^\(b\)(\((i|ii|iii)\))?$/, 'Name the clause of section 17(5), such as (b)(i)');
const name = () => z.string().trim().min(1, 'Name it').max(80);
/** A service's SAC (or a good's HSN), 4, 6 or 8 digits, as a bill's charge line holds it. */
const sac = () => z.string().regex(/^[0-9]{4}([0-9]{2}){0,2}$/, 'A SAC is 4, 6 or 8 digits');
const accountIds = () => z.array(idString()).min(1, 'Name at least one expense account').max(50)
  .refine((ids) => new Set(ids).size === ids.length, 'Name each account once');
/** A blocked category names its clause, and an allowed one none (ck_expense_categories_clause). */
const clauseFits = (c: { credit?: string | undefined; blockedClause?: string | null | undefined }) =>
  (c.credit === undefined && c.blockedClause === undefined) || (c.credit === 'blocked') === (typeof c.blockedClause === 'string');
const CLAUSE_FITS = { message: 'A blocked category names its clause of section 17(5), and an allowed one none', path: ['blockedClause'] };

/** An expense line or a bill's charge line naming a category's pair holds it, under either code. */
const inUse = (state: '23503' | '23001') => ({
  [`${state}:fk_expense_lines_category_account`]: { code: 'account_in_use', message: 'An expense already posts to that account under this category' },
  [`${state}:fk_purchase_bill_lines_expense_category`]: { code: 'account_in_use', message: 'A bill’s charge already posts to that account under this category' },
}) as const;
/** An expense line or a category naming no such TDS section (the auditor on #452). */
const LINE_SECTION = { '23503:expense_lines_tds_section_id_tds_sections_id_fk': { code: 'unknown_section', message: 'There is no such TDS section' } } as const;
const CATEGORY_SECTION = {
  '23503:expense_categories_default_tds_section_id_tds_sections_id_fk': { code: 'unknown_section', message: 'There is no such TDS section' },
} as const;

const category = z.object({
  id: idString(), name: z.string(), credit: z.enum(EXPENSE_CREDIT), blockedClause: z.string().nullable(), active: z.boolean(),
  /** The TDS section its lines take when their supplier names none (ADR-009 §4). */
  defaultTdsSectionId: idString().nullable(),
  /** The SAC its lines take when they name none, for reverse charge (ADR-010 §4). */
  defaultSac: z.string().nullable(),
  accounts: z.array(z.object({ id: idString(), code: z.string().nullable(), name: z.string() })),
});

/** GET /expense-categories (expenses:read): every category, by name, with its accounts, for whoever enters expenses (the
 * auditor on #425). Small, so one answer. */
export const listExpenseCategories = defineContract({
  method: 'GET', path: '/expense-categories', auth: 'session', perm: 'expenses:read', tx: read,
  input: z.object({}), output: z.object({ items: z.array(category) }),
});

/** POST /expense-categories (accounts:write): a category, its credit rule (a new one starts blocked on the screen, ADR-009 §2),
 * and the switched-on ordinary expense accounts it may post to. */
export const createExpenseCategory = defineContract({
  method: 'POST', path: '/expense-categories', auth: 'session', perm: 'accounts:write', tx: write,
  input: z.object({ name: name(), credit: z.enum(EXPENSE_CREDIT), blockedClause: clause().nullable(),
    accountIds: accountIds(), defaultTdsSectionId: idString().nullable().optional(), defaultSac: sac().nullable().optional() }).refine(clauseFits, CLAUSE_FITS),
  output: z.object({ id: idString() }),
  errors: ['name_taken', 'not_an_expense_account', 'unknown_section'],
  dbErrors: CATEGORY_SECTION,
});

/** PATCH /expense-categories/:id (accounts:write): its name, its credit rule (the two together), its accounts (the whole
 * list), or switched off or on, with the reason. */
export const setExpenseCategory = defineContract({
  method: 'PATCH', path: '/expense-categories/:id', auth: 'session', perm: 'accounts:write', tx: write,
  input: z.object({ id: idString(), name: name().optional(), credit: z.enum(EXPENSE_CREDIT).optional(), blockedClause: clause().nullable().optional(),
    accountIds: accountIds().optional(), active: z.boolean().optional(), defaultTdsSectionId: idString().nullable().optional(),
    defaultSac: sac().nullable().optional(), reason: reason() })
    .refine((c) => c.name !== undefined || c.credit !== undefined || c.blockedClause !== undefined || c.accountIds !== undefined || c.active !== undefined
      || c.defaultTdsSectionId !== undefined || c.defaultSac !== undefined,
      'Change something')
    .refine(clauseFits, CLAUSE_FITS),
  output: z.object({}),
  // account_in_use: an account taken off the list that an expense line already names (the auditor on #425).
  errors: ['name_taken', 'not_an_expense_account', 'account_in_use', 'unknown_section'],
  // An expense line or a bill's charge line naming the pair (#436; e2e-playwright on RAD-152) holds it.
  dbErrors: {
    ...CATEGORY_SECTION,
    // PostgreSQL 16 raises an ON DELETE RESTRICT refusal as 23503, and 17 on as 23001 (restrict_violation): both, so
    // every environment (16 in CI and production) and a newer local server answer the same (the auditor on #453).
    ...inUse('23503'), ...inUse('23001'),
  },
});

// Expenses themselves (ADR-009 §3).
const status = z.enum(['draft', 'posted', 'cancelled']);
const gstin = () => z.string().regex(/^[0-9]{2}[A-Z0-9]{13}$/, 'A GSTIN is 15 characters');
const line = z.object({
  categoryId: idString(), accountId: idString(), description: z.string().trim().min(1).max(100).nullable(),
  taxable: moneyString(), gstRate: percentString(), cgst: moneyString(), sgst: moneyString(), igst: moneyString(),
  /** Its TDS section (ADR-009 §4): left out, the supplier's default, else its category's; null for none. */
  tdsSectionId: idString().nullable().optional(),
  /** Its SAC (ADR-010 §4): left out, its category's default; null for none. A line a reverse-charge rule covers shows no
   * tax as printed (rcm_bill_has_tax): it's ours to pay, worked out at posting. */
  sac: sac().nullable().optional(),
});
/** CGST and SGST are equal halves, and IGST stands alone (ck_expense_lines_heads; the auditor on #435). */
const headsFit = (l: z.output<typeof line>) => dec(l.cgst).eq(dec(l.sgst)) && (dec(l.igst).isZero() || dec(l.cgst).isZero());
const HEADS_FIT = { message: 'CGST and SGST are equal, and IGST is charged alone', path: ['cgst'] };
/** What a draft holds: the supplier (none for a one-off expense paid at once that claims no credit), the bill as printed,
 * how it's paid (`payFromAccountId`: Cash or a bank account, or null on credit to the supplier), the stated total, the
 * file, and its lines, each with its tax by head as printed. */
const expenseIn = z.object({
  businessDate: dateString(), supplierId: idString().nullable(), supplierInvoiceNumber: z.string().trim().min(1).max(40),
  supplierInvoiceDate: dateString(), supplierGstin: gstin().nullable(), payFromAccountId: idString().nullable(), statedTotal: moneyString(),
  fileId: idString().nullable(), notes: z.string().trim().max(500).nullable(), lines: z.array(line.refine(headsFit, HEADS_FIT)).min(1).max(100),
});
const credit = z.object({ cgst: moneyString(), sgst: moneyString(), igst: moneyString(), reason: z.enum(['supplier_kind', 'blocked', 'state']).nullable() });
const header = z.object({
  id: idString(), number: z.string().nullable(), status, businessDate: dateString(), supplierId: idString().nullable(),
  supplierInvoiceNumber: z.string(), statedTotal: moneyString(), onCredit: z.boolean(), awaitingApproval: z.boolean(),
  /** The TDS held back at posting (0 for a draft). */
  tds: moneyString(), createdAt: momentString(),
});
const expense = header.extend({
  supplierInvoiceDate: dateString(), supplierGstin: z.string().nullable(), payFromAccountId: idString().nullable(), fileId: idString().nullable(),
  notes: z.string().nullable(), cancelReason: z.string().nullable(),
  lines: z.array(line.extend({ id: idString(), lineNo: z.number().int(), credit: credit.nullable(),
    /** Once posted, a reverse-charge line's tax by head: ours to pay (RCM Payable), not the supplier's. */
    reverseCharge: z.object({ cgst: moneyString(), sgst: moneyString(), igst: moneyString() }).nullable() })),
});
/** What a draft's save can refuse, and what its posting can refuse beyond that (ADR-009 §2, §3). */
const DRAFT_ERRORS = ['date_in_future', 'supplier_date_after_bill', 'needs_supplier', 'not_a_supplier', 'gstin_mismatch', 'not_money_account',
  'account_inactive', 'unknown_account', 'category_inactive', 'not_in_category', 'wrong_file_kind', 'upload_refused', 'not_ready', 'unknown_section'] as const;
const POST_ERRORS = [...DRAFT_ERRORS, 'wrong_status', 'bill_file_required', 'tax_mismatch', 'total_mismatch', 'period_locked', 'year_not_open',
  'company_profile_incomplete', 'series_full', 'tds_needs_party', 'tds_overseas', 'no_tds_rate', 'tds_payee_mismatch', 'rcm_bill_has_tax',
  'no_gst_rate', 'sac_required'] as const;

/** GET /expenses (expenses:read): newest business date first, a page at a time; by status. */
export const listExpenses = defineContract({
  method: 'GET', path: '/expenses', auth: 'session', perm: 'expenses:read', tx: read,
  input: listInput(z.object({ status: status.optional() })), output: listOf(header),
});
/** GET /expenses/:id (expenses:read): one expense, its lines, and each posted line's credit claimed and why not. */
export const getExpense = defineContract({
  method: 'GET', path: '/expenses/:id', auth: 'session', perm: 'expenses:read', tx: read,
  input: z.object({ id: idString() }), output: expense,
});
/** POST /expenses (expenses:write): a new draft. */
export const createExpense = defineContract({
  method: 'POST', path: '/expenses', auth: 'session', perm: 'expenses:write', tx: write,
  input: expenseIn, output: z.object({ id: idString() }), errors: [...DRAFT_ERRORS], dbErrors: LINE_SECTION,
});
/** PUT /expenses/:id (expenses:write): a draft replaced whole, lines and all. */
export const replaceExpense = defineContract({
  method: 'PUT', path: '/expenses/:id', auth: 'session', perm: 'expenses:write', tx: write,
  input: expenseIn.extend({ id: idString() }), output: z.object({}), errors: [...DRAFT_ERRORS, 'wrong_status'], dbErrors: LINE_SECTION,
});
/** DELETE /expenses/:id (expenses:write): a draft dropped, and its cash override withdrawn if it waits for one. */
export const dropExpense = defineContract({
  method: 'DELETE', path: '/expenses/:id', auth: 'session', perm: 'expenses:write', tx: write,
  input: z.object({ id: idString() }), output: z.object({}), errors: ['wrong_status'],
});
/** POST /expenses/:id/post (expenses:write): posts it, or, paid in cash past the day's limit (ADR-007 §8), asks for an
 * owner's override, whose approval posts it. */
export const postExpense = defineContract({
  method: 'POST', path: '/expenses/:id/post', auth: 'session', perm: 'expenses:write', tx: write,
  input: z.object({ id: idString() }),
  output: z.object({ status: z.enum(['posted', 'pending_approval']), number: z.string().nullable() }), errors: [...POST_ERRORS],
});
/** POST /expenses/:id/cancel (expenses:write): a mirror entry dated the cancel's day, only while nothing is applied to it. */
export const cancelExpense = defineContract({
  method: 'POST', path: '/expenses/:id/cancel', auth: 'session', perm: 'expenses:write', tx: write,
  input: z.object({ id: idString(), businessDate: dateString(), reason: z.string().trim().min(1).max(500) }), output: z.object({}),
  errors: ['wrong_status', 'date_in_future', 'date_before_source', 'period_locked', 'year_not_open', 'has_allocations', 'series_full', 'bank_matched'],
  dbErrors: { 'RA006:document_still_applied': { code: 'has_allocations', message: 'Reverse what’s applied to this expense first' },
    ...BANK_MATCHED_DB_ERROR },
});
/** An owner's override for an expense paid in cash past the day's limit (ADR-007 §8): its approval posts the expense. */
export const expenseCashApproval = approvalContracts('expense-cash', 'payments:approve', [...POST_ERRORS]);
