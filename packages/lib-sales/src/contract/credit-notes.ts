// Credit notes (M3-10, RAD-114; ADR-007 §6; ADR-006 §6, F9, F25, F26), re-exported by ../contract.ts. A note credits a
// posted invoice, line by line, never past what's left of it: value only, or goods back into a place at the value they
// went out at. Someone else approves every note (credit_notes:approve, with the second factor), and approving posts it:
// Dr Sales and Output GST (GST Borne on Late Credit Notes past section 34's limit), Cr Debtors, the round-off, and for
// goods Dr Stock, Cr COGS; it applies to its invoice, and pays any counter refund drafted with it. Like every contract
// file it imports only zod, lib-common and other libraries' contract entries (D5).
import { cost, dateString, defineContract, idString, listInput, listOf, moneyString, quantityString, reason } from '@radcore/lib-common';
import { approvalContracts } from '@radcore/lib-platform/contract';
import { z } from 'zod';

const read = { readOnly: true, isolation: 'read committed' } as const;
const write = { readOnly: false, isolation: 'read committed' } as const;
const status = z.enum(['draft', 'posted', 'cancelled']);
const kind = z.enum(['value', 'goods']);
const money = () => moneyString();

/** Goods back name a quantity and the batches and serials they come back in; value only, the taxable value credited. */
const lineIn = z.object({
  invoiceLineId: idString(), qty: quantityString().optional(), taxable: money().optional(),
  batches: z.array(z.object({ batchId: idString().nullable(), qty: quantityString() })).max(50).optional(),
  serials: z.array(z.string().trim().min(1).max(60)).max(1000).optional(),
});
/** A counter refund (F26), paid from cash or a bank account as the note posts. */
const refundIn = z.object({ amount: money(), accountId: idString() }).nullable();
const noteIn = z.object({
  invoiceId: idString(), kind, businessDate: dateString(), locationId: idString().nullable(), reason: reason(), refund: refundIn,
  lines: z.array(lineIn).min(1, 'Add at least one line').max(200, 'At most 200 lines'),
}).superRefine((n, c) => {
  if ((n.kind === 'goods') !== (n.locationId !== null)) {
    c.addIssue({ code: 'custom', path: ['locationId'], message: n.kind === 'goods' ? 'Choose where the goods come back to' : 'Only goods back go to a place' });
  }
  for (const [i, l] of n.lines.entries()) {
    const goods = l.qty !== undefined && l.batches !== undefined && l.taxable === undefined;
    const value = l.taxable !== undefined && l.qty === undefined && l.batches === undefined && l.serials === undefined;
    if (n.kind === 'goods' ? !goods : !value) {
      c.addIssue({ code: 'custom', path: ['lines', i], message: n.kind === 'goods' ? 'Goods back name a quantity and batches' : 'A value credit names a taxable value' });
    }
  }
});

const line = z.object({
  id: idString(), lineNo: z.number().int().positive(), invoiceLineId: idString(), itemId: idString(), qty: quantityString().nullable(),
  batches: z.array(z.object({ batchId: idString().nullable(), qty: quantityString() })), serials: z.array(z.string()),
  taxable: money().nullable(), gstRate: z.string().nullable(), gstRateSource: z.string().nullable(), cgst: money().nullable(),
  sgst: money().nullable(), igst: money().nullable(), lineTotal: money().nullable(), cost: cost(money().nullable()),
});
const header = z.object({
  id: idString(), number: z.string().nullable(), kind, invoiceId: idString(), partyId: idString(), partyName: z.string(),
  businessDate: dateString(), status, total: money(),
});
const note = header.extend({
  locationId: idString().nullable(), reason: z.string(), refund: z.object({ amount: money(), accountId: idString() }).nullable(),
  late: z.boolean(), taxable: money(), cgst: money(), sgst: money(), igst: money(), roundOff: z.string(), lines: z.array(line),
});

// The refusals a draft shares: its invoice, its date, its lines and its place.
const DRAFT_ERRORS = ['wrong_status', 'date_in_future', 'date_before_source', 'not_on_source', 'over_quantity', 'quantity_too_precise',
  'exceeds_invoice', 'exceeds_credit', 'unknown_location', 'location_inactive', 'unknown_account', 'not_cash_or_bank'] as const;
/** A refund of the note's credit, refused by the database by name when approval posts it (#269). */
// shortcut: passed to creditNoteApproval as approvalContracts' dbErrors once #269 is on dev.
export const CREDIT_REFUND_DB_ERRORS = {
  'RA006:refund_credit_not_posted': { code: 'credit_not_posted', message: 'Refund a credit note only once it’s posted' },
  'RA006:refund_credit_party_mismatch': { code: 'refund_other_party', message: 'A refund goes back to the credit note’s party' },
  'RA006:refund_credit_before_source': { code: 'date_before_source', message: 'A refund is dated on or after its credit note' },
  'RA006:refund_credit_side_mismatch': { code: 'wrong_credit', message: 'A refund pays a customer back against a credit note' },
  'RA006:refund_exceeds_credit': { code: 'exceeds_credit', message: 'That’s more than is left of the credit note' },
  'RA006:allocatable_document_missing': { code: 'wrong_credit', message: 'There’s no such credit note' },
  '23503:fk_payments_credit_table': { code: 'wrong_credit', message: 'Refunds aren’t made against that kind of document' },
} as const;

/** Credit notes, newest first, a page at a time. */
export const listCreditNotes = defineContract({
  method: 'GET', path: '/sales/credit-notes', auth: 'session', perm: 'sales:read', tx: read,
  input: listInput(z.object({ status: status.optional(), invoiceId: idString().optional() })),
  output: listOf(header),
});
/** One credit note with its lines. */
export const getCreditNote = defineContract({
  method: 'GET', path: '/sales/credit-notes/:id', auth: 'session', perm: 'sales:read', tx: read,
  input: z.object({ id: idString() }), output: note,
});
/** A new draft credit note against a posted invoice. */
export const createCreditNote = defineContract({
  method: 'POST', path: '/sales/credit-notes', auth: 'session', perm: 'credit_notes:write', tx: write,
  input: noteIn, output: z.object({ id: idString() }), errors: [...DRAFT_ERRORS],
});
/** A draft credit note, thrown away: it never had a number. */
export const deleteCreditNote = defineContract({
  method: 'DELETE', path: '/sales/credit-notes/:id', auth: 'session', perm: 'credit_notes:write', tx: write,
  input: z.object({ id: idString() }), output: z.object({}), errors: ['wrong_status'],
});
/** Sends a draft for approval: someone holding credit_notes:approve approves it, which posts it (RAD-38). */
export const requestCreditNoteApproval = defineContract({
  method: 'POST', path: '/sales/credit-notes/:id/approval', auth: 'session', perm: 'credit_notes:write', tx: write,
  input: z.object({ id: idString() }), output: z.object({ id: idString(), versionHash: z.string() }),
  errors: ['wrong_status', 'exceeds_invoice'],
});
/** The credit notes' approval routes (RAD-38): approving posts the note, applies it to its invoice and pays its refund. */
export const creditNoteApproval = approvalContracts('credit-note', 'credit_notes:approve',
  [...DRAFT_ERRORS, 'year_not_open', 'period_locked', 'account_inactive', 'invoice_cancelled', 'batches_mismatch', 'units_mismatch',
    'serial_twice', 'not_serialised', 'credit_not_posted', 'refund_other_party', 'wrong_credit']);
/** Cancels a posted credit note (ADR-007 §6): its entry mirrored on the cancellation's day, goods back out again at the
 * value they came back at (RC-207). Refused while it's applied or refunded: reverse those first. */
export const cancelCreditNote = defineContract({
  method: 'POST', path: '/sales/credit-notes/:id/cancel', auth: 'session', perm: 'credit_notes:cancel', tx: write,
  input: z.object({ id: idString(), businessDate: dateString(), reason: reason() }), output: z.object({}),
  errors: ['wrong_status', 'date_in_future', 'date_before_source', 'period_locked', 'year_not_open', 'account_inactive', 'still_applied',
    'not_enough_stock'],
  dbErrors: { 'RA006:document_still_applied': { code: 'still_applied', message: 'This credit note is still applied or refunded: reverse that first' } },
});
