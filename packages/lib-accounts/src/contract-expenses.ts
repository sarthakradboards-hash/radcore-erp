// Expense categories (M5-02, RAD-152; ADR-009 §2, §3), re-exported by ./contract: each category's credit rule and the
// accounts it may post to. Set up under accounts:write and read under journal:read, like the chart. Like every contract
// file it imports only zod and lib-common (D5).
import { defineContract, idString, reason } from '@radcore/lib-common';
import { z } from 'zod';

const read = { readOnly: true, isolation: 'read committed' } as const;
const write = { readOnly: false, isolation: 'read committed' } as const;

export const EXPENSE_CREDIT = ['allowed', 'blocked'] as const;
/** A clause of section 17(5) as a blocked category names it: (a) to (i), and (b)'s sub-clauses, as "(b)(i)". */
const clause = () => z.string().regex(/^\((a|aa|ab|b|c|d|e|f|fa|g|h|i)\)(\((i|ii|iii)\))?$/, 'Name the clause of section 17(5), such as (b)(i)');
const name = () => z.string().trim().min(1, 'Name it').max(80);
const accountIds = () => z.array(idString()).min(1, 'Name at least one expense account').max(50)
  .refine((ids) => new Set(ids).size === ids.length, 'Name each account once');
/** A blocked category names its clause, and an allowed one none (ck_expense_categories_clause). */
const clauseFits = (c: { credit?: string | undefined; blockedClause?: string | null | undefined }) =>
  (c.credit === undefined && c.blockedClause === undefined) || (c.credit === 'blocked') === (typeof c.blockedClause === 'string');
const CLAUSE_FITS = { message: 'A blocked category names its clause of section 17(5), and an allowed one none', path: ['blockedClause'] };

const category = z.object({
  id: idString(), name: z.string(), credit: z.enum(EXPENSE_CREDIT), blockedClause: z.string().nullable(), active: z.boolean(),
  accounts: z.array(z.object({ id: idString(), code: z.string().nullable(), name: z.string() })),
});

/** GET /expense-categories (journal:read): every category, by name, with its accounts. Small, so one answer. */
export const listExpenseCategories = defineContract({
  method: 'GET', path: '/expense-categories', auth: 'session', perm: 'journal:read', tx: read,
  input: z.object({}), output: z.object({ items: z.array(category) }),
});

/** POST /expense-categories (accounts:write): a category, its credit rule (a new one starts blocked on the screen, ADR-009 §2),
 * and the switched-on ordinary expense accounts it may post to. */
export const createExpenseCategory = defineContract({
  method: 'POST', path: '/expense-categories', auth: 'session', perm: 'accounts:write', tx: write,
  input: z.object({ name: name(), credit: z.enum(EXPENSE_CREDIT), blockedClause: clause().nullable(),
    accountIds: accountIds() }).refine(clauseFits, CLAUSE_FITS),
  output: z.object({ id: idString() }),
  errors: ['name_taken', 'not_an_expense_account'],
});

/** PATCH /expense-categories/:id (accounts:write): its name, its credit rule (the two together), its accounts (the whole
 * list), or switched off or on, with the reason. */
export const setExpenseCategory = defineContract({
  method: 'PATCH', path: '/expense-categories/:id', auth: 'session', perm: 'accounts:write', tx: write,
  input: z.object({ id: idString(), name: name().optional(), credit: z.enum(EXPENSE_CREDIT).optional(), blockedClause: clause().nullable().optional(),
    accountIds: accountIds().optional(), active: z.boolean().optional(), reason: reason() })
    .refine((c) => c.name !== undefined || c.credit !== undefined || c.blockedClause !== undefined || c.accountIds !== undefined || c.active !== undefined,
      'Change something')
    .refine(clauseFits, CLAUSE_FITS),
  output: z.object({}),
  errors: ['name_taken', 'not_an_expense_account'],
});
