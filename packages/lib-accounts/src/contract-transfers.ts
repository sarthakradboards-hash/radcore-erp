// Transfers between the company's own money accounts (RAD-165's first PR; the architect on RAD-168; F19), re-exported by
// ./contract: cash paid into the bank, one bank to another. Recorded and cancelled under payments:write (it moves money:
// second factor), read under payments:read. Like every contract file it imports only zod and lib-common (D5).
import { dateString, defineContract, idString, listInput, listOf, momentString, moneyString, reason } from '@radcore/lib-common';
import { z } from 'zod';
import { BANK_MATCHED_DB_ERROR } from './contract-bank.ts';

const read = { readOnly: true, isolation: 'read committed' } as const;
const write = { readOnly: false, isolation: 'read committed' } as const;

const transfer = z.object({
  id: idString(), status: z.enum(['posted', 'cancelled']), number: z.string(), businessDate: dateString(),
  from: z.object({ id: idString(), name: z.string() }), to: z.object({ id: idString(), name: z.string() }), amount: moneyString(),
  reference: z.string().nullable(), notes: z.string().nullable(), recordedAt: momentString(),
});

/** GET /transfers (payments:read): newest first, a page at a time. */
export const listTransfersContract = defineContract({
  method: 'GET', path: '/transfers', auth: 'session', perm: 'payments:read', tx: read,
  input: listInput(z.object({ accountId: idString().optional() })),
  output: listOf(transfer),
});

/** GET /transfers/:id (payments:read): with why it was cancelled. */
export const getTransferContract = defineContract({
  method: 'GET', path: '/transfers/:id', auth: 'session', perm: 'payments:read', tx: read,
  input: z.object({ id: idString() }),
  output: transfer.extend({ cancelReason: z.string().nullable() }),
});

/** POST /transfers (payments:write): posted as it's recorded (F19). Both accounts are Cash or Bank and those under it,
 * never the same one. Moving our own money takes no cash limit: it's paid to no one (ADR-007 §8). */
export const recordTransferContract = defineContract({
  method: 'POST', path: '/transfers', auth: 'session', perm: 'payments:write', tx: write,
  input: z.object({
    fromAccountId: idString(), toAccountId: idString(), amount: moneyString(), businessDate: dateString(),
    // What the bank calls it (a deposit slip, a UTR), for matching it to the statement (M5-13).
    reference: z.string().trim().min(1).max(40).optional(), notes: z.string().trim().min(1).max(500).optional(),
  }),
  output: z.object({ id: idString(), number: z.string() }),
  errors: ['amount_not_positive', 'same_account', 'unknown_account', 'not_money_account', 'account_inactive', 'date_in_future', 'period_locked',
    'year_not_open', 'series_full'],
});

/** POST /transfers/:id/cancel (payments:write): mirrors its entry, dated `businessDate`, with the reason. */
export const cancelTransferContract = defineContract({
  method: 'POST', path: '/transfers/:id/cancel', auth: 'session', perm: 'payments:write', tx: write,
  input: z.object({ id: idString(), businessDate: dateString(), reason: reason() }),
  output: z.object({}),
  errors: ['not_posted', 'date_before_source', 'date_in_future', 'period_locked', 'year_not_open', 'already_reversed', 'bank_matched'],
  dbErrors: BANK_MATCHED_DB_ERROR,
});
