// A transfer's form values (RAD-168 on RAD-165's #432, F19): from and to the company's own money accounts, never the same
// one, an amount above nothing, the day, and the bank's reference. Empty optional boxes aren't sent. Whether the accounts
// are money accounts, the day is open and the books allow it is the server's to judge; the screen words what comes back.
import { dateString, dec, indiaDate, moneyString } from '@radcore/lib-common';
import type { recordTransferContract } from '@radcore/lib-accounts/contract';
import { z } from 'zod';
import { t } from '../../../../lib/i18n/index.ts';

const CODES = ['amount_not_positive', 'same_account', 'unknown_account', 'not_money_account', 'account_inactive', 'date_in_future',
  'period_locked', 'year_not_open', 'series_full', 'not_posted', 'date_before_source', 'already_reversed'] as const;
/** The transfer contracts' refusals in the screen's words, for Form's `messages`. */
export const TRANSFER_MESSAGES: Partial<Record<string, string>> = Object.fromEntries(CODES.map((c) => [c, t(`books.transfers.err.${c}`)]));

const positive = (a: string) => moneyString().safeParse(a).success && dec(a).gt(0);
const picked = () => z.string().min(1, t('books.transfers.err.pick'));

export const transferSchema = z.object({
  fromAccountId: picked(), toAccountId: picked(),
  amount: z.string().trim().refine(positive, t('books.transfers.err.amount')),
  businessDate: dateString(),
  reference: z.string().trim().max(40), notes: z.string().trim().max(500),
}).refine((v) => v.fromAccountId !== v.toAccountId, { path: ['toAccountId'], message: t('books.transfers.err.same_account') })
  // Typed as the contract's input, so a change to its fields fails the typecheck here.
  .transform(({ reference, notes, ...v }): z.input<typeof recordTransferContract.input> => ({
    ...v, ...(reference === '' ? {} : { reference }), ...(notes === '' ? {} : { notes }),
  }));

export type TransferInput = z.input<typeof transferSchema>;
export const newTransfer = (): TransferInput => ({ fromAccountId: '', toAccountId: '', amount: '', businessDate: indiaDate(new Date()), reference: '', notes: '' });
