// Approving, posting and cancelling a credit note (M3-10, RAD-114; ADR-007 §6; ADR-006 §1, §4, §6, F9, F25, F26). Every
// note is approved by someone else (credit_notes:approve, with the second factor, D-19), and the approval's approved()
// posts it. In ADR-006 §1's order: the note (locked by the approval's read), the period, then its invoice, so two notes
// of one invoice, or a note and the invoice's cancellation, take turns; then the stock engine's, the entry, the number
// last. The entry (F9): Dr Sales, Dr Output GST (or GST Borne on Late Credit Notes past section 34's limit, F25), Cr
// Debtors for the total, the round-off, and for goods back Dr Stock in Hand, Cr COGS at the value they went out at,
// their units `returned` (RC-128). The note then applies to its invoice, as far as the invoice is unpaid, and pays the
// counter refund drafted with it (F26).
import { creditNoteLines, creditNotes, salesTx } from '@radcore/db/sales';
import { applyCredit, holdPeriod, paidOf, postEntry, refundCredit, reverseEntriesOf, type JournalLine } from '@radcore/lib-accounts';
import { dec, quantityString, roundMoney, roundRate, type Money } from '@radcore/lib-common';
import { AppError, defineSeries, defineSetting, nextNumber, principalId, requestApproval, type ApprovalSpec, type Ctx } from '@radcore/lib-platform';
import { checkPlace, postStock, reverseStock, type PostedMovement } from '@radcore/lib-stock';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { cancelCreditNote, requestCreditNoteApproval } from '../contract.ts';
import { isLate, isMonthDay } from './credit-note-rules.ts';
import { draftedLines, invoiceToCredit, noteFigures, noteOf, wrongNoteStatus, type NoteLineIn } from './credit-notes.ts';
import { checkDate } from './document-rules.ts';
import { today } from './document-lines.ts';
import { totalsOf } from './invoice-rules.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;
type Kind = 'value' | 'goods';

/** Credit notes' numbers (ADR-007 §3): CN/26-27/00001, drawn when a note posts. */
export const CREDIT_NOTE_SERIES = defineSeries('sales.credit_note', 'CN', { digits: 5, label: 'Credit notes' });
/** Section 34(2)'s limit (CA-10): a note dated after this month and day following its invoice's financial year can't
 * cut output tax. A setting, so a change in the law needs no release. */
export const CREDIT_NOTE_TAX_DEADLINE = defineSetting('sales.credit_note_tax_deadline',
  z.string().refine(isMonthDay, 'A month and day, as MM-DD'), '11-30', {
    label: 'Credit note tax deadline',
    description: 'A credit note dated after this month and day (MM-DD) following its invoice’s financial year doesn’t reduce output tax.',
    input: { kind: 'text' },
  });

/** What the approver sees and approves: the note as drafted, never figures worked from other notes, which change. */
type NoteVersion = { invoiceId: string; kind: string; businessDate: string; locationId: string | null; reason: string;
  refund: { amount: string; accountId: string } | null;
  lines: { invoiceLineId: string; qty: string | null; taxable: string | null; batches: { batchId: string | null; qty: string }[]; serials: string[] }[] };

/** The entry (ADR-006 §6, F9, F25, F26). Lines of 0 are left out. */
function entryLines(partyId: string, t: ReturnType<typeof totalsOf>, late: boolean, moved: readonly PostedMovement[]): JournalLine[] {
  const tax = roundMoney(dec(t.cgst).plus(dec(t.sgst)).plus(dec(t.igst)));
  const stock: JournalLine[] = moved.filter((m) => m.direction === 'in')
    .map((m) => ({ account: { system: 'stock' }, itemId: m.itemId, locationId: m.locationId, debit: m.value }));
  const cost = roundMoney(stock.reduce((s, l) => s.plus(dec(l.debit ?? '0')), dec('0')));
  const lines: JournalLine[] = [
    { account: { system: 'sales' }, debit: t.taxable },
    ...(late ? [{ account: { system: 'late_cn_gst' }, debit: tax }] : [
      { account: { system: 'output_cgst' }, debit: t.cgst },
      { account: { system: 'output_sgst' }, debit: t.sgst },
      { account: { system: 'output_igst' }, debit: t.igst }]),
    { account: { system: 'debtors' }, partyId, credit: t.total },
    // The round-off takes the total down when it's negative: then the customer is owed less, a credit (F26).
    dec(t.roundOff).isNegative() ? { account: { system: 'round_off' }, credit: roundMoney(dec(t.roundOff).abs()) }
      : { account: { system: 'round_off' }, debit: t.roundOff },
    ...stock,
    { account: { system: 'cogs' }, credit: cost },
  ];
  return lines.filter((l) => dec(l.debit ?? l.credit ?? '0').gt(0));
}

/** Posts an approved draft; the approval's read has locked the note's row. */
async function postNote(ctx: Ctx, id: string): Promise<void> {
  const tx = salesTx(ctx);
  const [dated] = await tx.select({ businessDate: creditNotes.businessDate }).from(creditNotes).where(eq(creditNotes.id, id));
  if (dated === undefined) throw new AppError('not_found', 'There is no such credit note');
  await holdPeriod(ctx, dated.businessDate);
  const [note] = await tx.select().from(creditNotes).where(eq(creditNotes.id, id)).for('update');
  if (note === undefined) throw new AppError('not_found', 'There is no such credit note');
  // The approver's: the approval's read found it within their scope too.
  ctx.see('credit_notes:approve', { owner: note.owner });
  if (note.status !== 'draft') throw wrongNoteStatus(note.status, 'posted');
  // ADR-006 §1's documents step: the invoice, locked, and what's left of it read again under that lock.
  const inv = await invoiceToCredit(ctx, note.invoiceId, 'credit_notes:approve', true);
  checkDate(note.businessDate, today(), { date: inv.businessDate, what: 'invoice' });
  if (note.locationId !== null) await checkPlace(ctx, note.locationId);
  const figures = await noteFigures(ctx, inv, note.kind as Kind, await draftedLines(ctx, id));
  const totals = totalsOf(figures);
  const late = isLate(note.businessDate, inv.businessDate, ctx.settings.get(CREDIT_NOTE_TAX_DEADLINE));
  const lineIds = new Map((await tx.select({ id: creditNoteLines.id, lineNo: creditNoteLines.lineNo }).from(creditNoteLines)
    .where(eq(creditNoteLines.creditNoteId, id)).orderBy(asc(creditNoteLines.lineNo))).map((l) => [l.lineNo, l.id]));
  // Goods come back at the value they went out at, in their batches, each unit `returned`, its sale cleared (RC-128).
  const moved = note.locationId === null ? [] : await postStock(ctx, { sourceTable: 'credit_notes', sourceId: id, businessDate: note.businessDate,
    ins: figures.map((f) => ({ itemId: f.itemId, locationId: note.locationId ?? '', sourceLineId: lineIds.get(f.lineNo) ?? null,
      qty: quantityString().parse(f.line.qty), value: f.cost, rate: roundRate(dec(f.cost).div(dec(f.line.qty ?? '1'))), batches: f.line.batches ?? [],
      units: (f.line.serials ?? []).map((serialNo) => ({ serialNo })), unitEvent: 'returned' as const })) });
  // The lines' figures first: once the note is posted, its lines are fixed (guard_document_line).
  for (const f of figures) {
    await tx.update(creditNoteLines).set({ taxable: f.taxable, gstRate: f.gstRate, gstRateSource: f.gstRateSource, cgst: f.cgst,
      sgst: f.sgst, igst: f.igst, lineTotal: f.lineTotal, cost: f.cost })
      .where(and(eq(creditNoteLines.creditNoteId, id), eq(creditNoteLines.lineNo, f.lineNo)));
  }
  const entry = await postEntry(ctx, { kind: 'credit_note', businessDate: note.businessDate, source: { table: 'credit_notes', id },
    lines: entryLines(note.partyId, totals, late, moved) });
  const number = await nextNumber(ctx, CREDIT_NOTE_SERIES, note.businessDate);
  await tx.update(creditNotes).set({ status: 'posted', number, postedEntryId: entry.id, late, taxable: totals.taxable, cgst: totals.cgst,
    sgst: totals.sgst, igst: totals.igst, roundOff: totals.roundOff, total: totals.total }).where(eq(creditNotes.id, id));
  // It settles its invoice as far as the invoice is unpaid (F9); what's left of it is the customer's, to refund (F26).
  const unpaid = roundMoney(dec(inv.total).minus(dec((await paidOf(ctx, 'invoices', [inv.id])).get(inv.id)?.paid ?? '0')));
  const applied: Money = dec(unpaid).lt(dec(totals.total)) ? unpaid : totals.total;
  if (dec(applied).gt(0)) {
    await applyCredit(ctx, { creditTable: 'credit_notes', creditId: id, documentTable: 'invoices', documentId: inv.id, amount: applied,
      businessDate: note.businessDate });
  }
  if (note.refundAmount !== null && dec(note.refundAmount).gt(dec(totals.total).minus(dec(applied)))) {
    throw new AppError('exceeds_credit', 'The refund is more than is left of the credit note once it settles its invoice',
      [{ path: ['refund', 'amount'], code: 'exceeds_credit', message: `${roundMoney(dec(totals.total).minus(dec(applied)))} is left to refund` }]);
  }
  // A counter refund (F26), part of what was approved, in the same save: the refund's insert locks the note, then the
  // cash limit takes the party (ADR-006 §1). Cash past the day's limit waits for its own approval (payments:approve).
  if (note.refundAmount !== null && note.refundAccountId !== null) {
    await refundCredit(ctx, { creditTable: 'credit_notes', creditId: id, partyId: note.partyId, businessDate: note.businessDate,
      amount: roundMoney(note.refundAmount), accountId: note.refundAccountId, narration: `Refund of credit note ${number}` });
  }
}

/** The credit-note approval (RAD-38): its maker asks (credit_notes:write) and someone else approves (credit_notes:approve);
 * outside both, there's no such note. Approving posts it; posting changes the status, never what was approved. */
export const creditNoteApprovalSpec: ApprovalSpec<NoteVersion> = {
  kind: 'credit-note',
  table: 'credit_notes',
  parts: ['credit_note_lines'],
  async version(ctx, id, { forUpdate }) {
    const sel = salesTx(ctx).select().from(creditNotes).where(eq(creditNotes.id, id));
    const [note] = forUpdate ? await sel.for('update') : await sel;
    if (note === undefined || (!ctx.can('credit_notes:write', { owner: note.owner }) && !ctx.can('credit_notes:approve', { owner: note.owner }))) {
      return null;
    }
    return { invoiceId: note.invoiceId, kind: note.kind, businessDate: note.businessDate, locationId: note.locationId, reason: note.reason,
      refund: note.refundAmount === null || note.refundAccountId === null ? null
        : { amount: roundMoney(note.refundAmount), accountId: note.refundAccountId },
      lines: (await draftedLines(ctx, id)).map((l: NoteLineIn) => ({ invoiceLineId: l.invoiceLineId, qty: l.qty ?? null,
        taxable: l.taxable ?? null, batches: l.batches ?? [], serials: l.serials ?? [] })) };
  },
  async approved(ctx, id) {
    await postNote(ctx, id);
  },
  async rejected() {
    // A refused note stays a draft, for its maker to throw away or send again.
  },
};

/** POST /sales/credit-notes/:id/approval (credit_notes:write): asks someone holding credit_notes:approve to approve it. */
export async function askCreditNoteApproval(ctx: Ctx, { id }: In<typeof requestCreditNoteApproval>): Promise<Out<typeof requestCreditNoteApproval>> {
  const now = await noteOf(ctx, id, 'credit_notes:write', true);
  if (now.status !== 'draft') throw wrongNoteStatus(now.status, 'sent for approval');
  // Still within what's left of its invoice: another note may have posted since it was drafted.
  await noteFigures(ctx, await invoiceToCredit(ctx, now.invoiceId, 'credit_notes:write'), now.kind as Kind, await draftedLines(ctx, id));
  return requestApproval(ctx, creditNoteApprovalSpec, id);
}

/** POST /sales/credit-notes/:id/cancel (credit_notes:cancel). The period, the note, then the stock engine's: goods back
 * go out again at the value they came back at, never as a new sale (RC-207); its entries are mirrored, dated the
 * cancellation's day. Refused while it's applied or refunded (the database's guard_applied_cancel, by name). */
export async function cancelCreditNoteNow(ctx: Ctx, { id, businessDate, reason }: In<typeof cancelCreditNote>): Promise<Out<typeof cancelCreditNote>> {
  await holdPeriod(ctx, businessDate);
  const note = await noteOf(ctx, id, 'credit_notes:cancel', true);
  if (note.status !== 'posted') throw wrongNoteStatus(note.status, 'cancelled');
  checkDate(businessDate, today(), { date: note.businessDate, what: 'credit note' });
  if (note.locationId !== null) await reverseStock(ctx, { sourceTable: 'credit_notes', sourceId: id, businessDate });
  const [own] = await reverseEntriesOf(ctx, { source: { table: 'credit_notes', id }, businessDate, reason });
  if (own === undefined) throw new Error('a posted credit note has an entry to reverse');
  await salesTx(ctx).update(creditNotes).set({ status: 'cancelled', cancelledAt: new Date(), cancelledBy: principalId(ctx.principal),
    cancelReason: reason, cancelEntryId: own.id }).where(eq(creditNotes.id, id));
  return {};
}
