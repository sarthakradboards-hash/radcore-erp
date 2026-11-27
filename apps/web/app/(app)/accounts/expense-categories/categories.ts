// What the expense categories screen works out (RAD-168 on RAD-152's routes, ADR-009 §2, §3): the accounts a category may
// pick, and the form's values as the contracts take them. The form keeps a clause while credit is allowed (switching back
// to blocked finds it again); what's sent drops it, and the contract's own checks then run on what's sent.
import { createExpenseCategory, setExpenseCategory, type listAccounts } from '@radcore/lib-accounts/contract';
import { z } from 'zod';

type Account = z.output<typeof listAccounts.output>['items'][number];

/** Section 17(5)'s clauses, as a blocked category names them. */
export const CLAUSES = ['(a)', '(aa)', '(ab)', '(b)', '(b)(i)', '(b)(ii)', '(b)(iii)', '(c)', '(d)', '(e)', '(f)', '(fa)', '(g)', '(h)', '(i)'] as const;

/** The accounts a category may post to: switched-on ordinary expense accounts, never a control account. */
export const expenseAccounts = (accounts: readonly Account[]) =>
  accounts.filter((a) => a.type === 'expense' && a.controlKind === 'none' && a.active);

const fields = z.object({ name: z.string(), credit: z.enum(['allowed', 'blocked']), blockedClause: z.string(), accountIds: z.array(z.string()) });
type Fields = z.output<typeof fields>;
const sent = (v: Fields) => ({ name: v.name, credit: v.credit, blockedClause: v.credit === 'blocked' ? v.blockedClause : null, accountIds: v.accountIds });

/** What's sent, checked by the contract's own input (zod 4's pipe won't type a looser input), its issues on their fields. */
const checkedBy = <T extends z.ZodType>(contract: T) => (v: unknown, ctx: z.RefinementCtx): z.output<T> => {
  const r = contract.safeParse(v);
  if (r.success) return r.data;
  for (const issue of r.error.issues) ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path });
  return z.NEVER;
};

export type CategoryValues = z.input<typeof fields>;
/** A new category starts blocked, as ADR-009 §2's strict default, until someone says its credit is allowed. */
export const blankCategory: CategoryValues = { name: '', credit: 'blocked', blockedClause: '', accountIds: [] };

export const createSchema = fields.transform((v, ctx) => checkedBy(createExpenseCategory.input)(sent(v), ctx));
/** The whole category is sent again with the reason: its name, its credit rule and its account list. */
export const editSchema = (id: string) => fields.extend({ reason: z.string() })
  .transform((v, ctx) => checkedBy(setExpenseCategory.input)({ id, ...sent(v), reason: v.reason }, ctx));
