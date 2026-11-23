// Receipts, payments and refunds as they're read (M3-12, RAD-116; for ui-2's RAD-126), re-exported by ./contract: a
// page of them and one with what it's applied to. Under payments:read, all-only, as receipts:print (payments isn't a
// scoped table). Like every contract file it imports only zod and lib-common (D5).
import { dateString, defineContract, idString, listInput, listOf, momentString, moneyString } from '@radcore/lib-common';
import { z } from 'zod';

const read = { readOnly: true, isolation: 'read committed' } as const;
const kind = z.enum(['receipt', 'payment', 'refund']);
const status = z.enum(['draft', 'posted', 'cancelled']);

/** A payment as a list shows it: its number (a draft waiting for approval has none), party, date, figures, the money
 * account it went through, and the money's own trail (`reference`: an approval code, UTR or cheque number). */
const payment = z.object({
  id: idString(), kind, status, number: z.string().nullable(), partyId: idString(), partyName: z.string(), businessDate: dateString(),
  amount: moneyString(), tds: moneyString(), accountId: idString(), accountName: z.string(), reference: z.string().nullable(),
  /** The receipt a refund pays back, or the credit (a credit note) it pays out. */
  refundOf: idString().nullable(), credit: z.object({ table: z.string(), id: idString() }).nullable(),
  recordedAt: momentString(),
});

/** GET /payments (payments:read): newest first, a page at a time. */
export const listPaymentsContract = defineContract({
  method: 'GET', path: '/payments', auth: 'session', perm: 'payments:read', tx: read,
  input: listInput(z.object({ kind: kind.optional(), status: status.optional(), partyId: idString().optional() })),
  output: listOf(payment),
});

/** GET /payments/:id (payments:read): with its narration, why it was cancelled, what it's applied to (each live
 * allocation: the document, the amount, the date), and what's left of it after those and its posted refunds. */
export const getPaymentContract = defineContract({
  method: 'GET', path: '/payments/:id', auth: 'session', perm: 'payments:read', tx: read,
  input: z.object({ id: idString() }),
  output: payment.extend({
    narration: z.string().nullable(), cancelReason: z.string().nullable(),
    allocations: z.array(z.object({ id: idString(), documentTable: z.string(), documentId: idString(), amount: moneyString(), businessDate: dateString() })),
    allocated: moneyString(), refunded: moneyString(), left: moneyString({ signed: true }),
  }),
});
