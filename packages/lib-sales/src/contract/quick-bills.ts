// The quick bill (M3-11, RAD-115; ADR-006 §6; ADR-007 §7, §8, §9; the architect's rulings), re-exported by
// ../contract.ts: the counter sale in one save. Its payments come first, as receipts, then the order, its delivery from
// one place and its invoice, each through its own service; then every receipt is applied to the invoice. Whatever isn't
// paid stays on the party's credit, which each stage's credit check judges (an advance already lowers what's owed).
// Like every contract file it imports only zod, lib-common and other libraries' contract entries (D5).
import { dateString, defineContract, idString, moneyString } from '@radcore/lib-common';
import { allocatePaymentContract, recordPaymentContract } from '@radcore/lib-accounts/contract';
import { z } from 'zod';
import { createDelivery, picks, postDelivery } from './deliveries.ts';
import { confirmOrder, createOrder, lineIn } from './documents.ts';
import { createInvoice, postInvoice } from './invoices.ts';

const write = { readOnly: false, isolation: 'read committed' } as const;
const reference = () => z.string().trim().min(1).max(40);

/** How a payment is made: cash; a card, by the machine's approval code alone (never card digits: Sarthak); or into a
 * bank account, with its own reference (a UPI UTR, a cheque number). The code is checked by the service, by name. */
const payment = z.discriminatedUnion('method', [
  z.object({ method: z.literal('cash'), amount: moneyString() }),
  z.object({ method: z.literal('card'), amount: moneyString(), approvalCode: reference().optional() }),
  z.object({ method: z.literal('bank'), amount: moneyString(), accountId: idString(), reference: reference().optional() }),
]);

/** What a stage's own service can refuse, said here as it says it; and the quick bill's own. */
const STAGES = [createOrder, confirmOrder, createDelivery, postDelivery, createInvoice, postInvoice, recordPaymentContract, allocatePaymentContract];
const ERRORS = [...new Set([...STAGES.flatMap((c) => c.errors), 'cash_over_limit', 'approval_code_required', 'looks_like_card_number',
  'overpaid', 'no_payment_amount'])];

/**
 * A counter sale in one save: the party (the Counter customer when none is named, below sales.b2c_details_limit), the
 * place its goods leave from, its lines with their batches and serials, and its payments, split as the customer pays.
 * The invoice's ship-to is the shop, so the tax is the counter's (CA-08's default). It needs sales:write,
 * deliveries:write and invoices:write, all named when any is missing; the receipts go through lib-accounts under
 * them. A check that needs someone else's approval refuses it (`needs_override`, with its issues), and so does cash
 * past the day's limit (`cash_over_limit`, s.269ST), each with nothing saved. Paying more than the bill is `overpaid`.
 */
export const createQuickBill = defineContract({
  method: 'POST', path: '/sales/quick-bills', auth: 'session', perm: 'invoices:write', tx: write,
  input: z.object({
    partyId: idString().optional(), businessDate: dateString(), locationId: idString(), notes: z.string().trim().max(500).nullable(),
    lines: z.array(lineIn.extend(picks)).min(1, 'Add at least one line').max(200, 'At most 200 lines'),
    payments: z.array(payment).max(10),
  }),
  output: z.object({
    order: z.object({ id: idString(), number: z.string() }), delivery: z.object({ id: idString(), number: z.string() }),
    invoice: z.object({ id: idString(), number: z.string() }), receipts: z.array(z.object({ id: idString(), number: z.string() })),
    total: moneyString(), paid: moneyString(), left: moneyString(),
  }),
  errors: ERRORS,
  dbErrors: Object.assign({}, ...STAGES.map((c) => c.dbErrors)) as Record<string, { code: (typeof ERRORS)[number]; message: string }>,
});
