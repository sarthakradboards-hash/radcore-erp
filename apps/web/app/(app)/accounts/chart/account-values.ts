// A new account's form values (RAD-168 on #429's POST /accounts; the architect on RAD-152): a name, the group it sits
// under, and an optional code. The account takes its group's type; it's always an ordinary account, never a control one.
import { createAccount, type listAccounts } from '@radcore/lib-accounts/contract';
import { z } from 'zod';
import { t } from '../../../../lib/i18n/index.ts';

type Account = z.output<typeof listAccounts.output>['items'][number];

/** The groups an account may go under: switched-on ordinary accounts, never a control account such as Debtors. */
export const groups = (accounts: readonly Account[]) => accounts.filter((a) => a.controlKind === 'none' && a.active);

export const accountSchema = z.object({
  name: z.string().trim().min(1, t('books.chart.add.err.name')).max(120, t('books.chart.add.err.nameLong')),
  parentId: z.string().min(1, t('books.chart.add.err.parent')),
  code: z.string().trim().refine((c) => c === '' || createAccount.input.shape.code.safeParse(c).success, t('books.chart.add.err.code')),
}).transform(({ code, ...v }) => ({ ...v, ...(code === '' ? {} : { code }) }));

export const blankAccount: z.input<typeof accountSchema> = { name: '', parentId: '', code: '' };
