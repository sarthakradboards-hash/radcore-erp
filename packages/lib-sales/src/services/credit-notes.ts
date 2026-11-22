// Credit notes' drafts (M3-10, RAD-114; ADR-007 §6): a note against one posted invoice, value only or goods back into
// a place, line by line against what's left of the invoice (`exceeds_invoice`). Its figures are worked out here, for
// the draft's check and again at posting under the invoice's lock (credit-note-post.ts). Whose a note is: its invoice's
// owner (ADR-007 §7), whoever drafts it.
import { after, creditNoteLines, creditNotes, deliveryLines, invoiceLines, invoices, salesTx } from '@radcore/db/sales';
import { creditApplicationsOf, moneyAccountRefusal, paidOf } from '@radcore/lib-accounts';
import { dec, roundMoney, type Money } from '@radcore/lib-common';
import { AppError, decodeCursor, encodeCursor, listScope, momentKey, type Ctx } from '@radcore/lib-platform';
import { checkPlace, checkQuantity, serialKey } from '@radcore/lib-stock';
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { createCreditNote, getCreditNote, listCreditNotes } from '../contract.ts';
import { creditLine, refundRoom, type CreditFigures } from './credit-note-rules.ts';
import { creditedOf, pickedBatchKey, picksOf, returnedOf, type Picks } from './delivered.ts';
import { checkDate } from './document-rules.ts';
import { labelled, today } from './document-lines.ts';
import { partyNames } from './party-names.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;
type Status = 'draft' | 'posted' | 'cancelled';
type Kind = 'value' | 'goods';
/** A drafted line, as the contract takes it and the draft stores it. */
export type NoteLineIn = { invoiceLineId: string; qty?: string | undefined; taxable?: string | undefined;
  batches?: Picks['batches'] | undefined; serials?: string[] | undefined };

const header = { id: creditNotes.id, number: creditNotes.number, kind: creditNotes.kind, invoiceId: creditNotes.invoiceId,
  partyId: creditNotes.partyId, businessDate: creditNotes.businessDate, status: creditNotes.status, total: creditNotes.total };
// Newest first: by date, then the moment each was made, then id (e2e-2: same-day ones were in id order, so random).
const PAGE_KEY = z.object({ date: z.iso.date(), at: momentKey(), id: z.uuid() });
export const wrongNoteStatus = (status: string, what = 'changed') =>
  new AppError('wrong_status', `This credit note is ${status}, so it can’t be ${what}`);
const notOnSource = (path: (string | number)[], message: string) =>
  new AppError('not_on_source', 'That isn’t on this invoice', [{ path, code: 'not_on_source', message }]);

/** The note, locked when it's to be written, within the principal's scope for `permission` (else not_found). */
export async function noteOf(ctx: Ctx, id: string, permission: string, forUpdate = false) {
  const sel = salesTx(ctx).select().from(creditNotes).where(eq(creditNotes.id, id));
  const [row] = forUpdate ? await sel.for('update') : await sel;
  if (row === undefined) throw new AppError('not_found', 'There is no such credit note');
  ctx.see(permission, { owner: row.owner });
  return row;
}

/** The invoice a note credits, posted, within the principal's scope for `permission` (a note is its invoice's owner's);
 * locked as a note posts, so two notes of one invoice, or a note and the invoice's cancellation, take turns over what's
 * left of it (ADR-006 §1's documents step). */
export async function invoiceToCredit(ctx: Ctx, invoiceId: string, permission: string, forUpdate = false) {
  const sel = salesTx(ctx).select().from(invoices).where(eq(invoices.id, invoiceId));
  const [inv] = forUpdate ? await sel.for('update') : await sel;
  if (inv === undefined) {
    throw new AppError('not_found', 'There is no such invoice', [{ path: ['invoiceId'], code: 'unknown', message: 'Choose an invoice' }]);
  }
  ctx.see(permission, { owner: inv.owner });
  if (inv.status !== 'posted') {
    throw new AppError('invoice_cancelled', `This invoice is ${inv.status}: only a posted invoice is credited`,
      [{ path: ['invoiceId'], code: 'wrong_status', message: 'Choose a posted invoice' }]);
  }
  return inv;
}
type Invoice = Awaited<ReturnType<typeof invoiceToCredit>>;

/** What's still unpaid of the invoice: its total less what's been paid or credited against it. */
export async function unpaidOf(ctx: Ctx, inv: Invoice): Promise<Money> {
  return roundMoney(dec(inv.total).minus(dec((await paidOf(ctx, 'invoices', [inv.id])).get(inv.id)?.paid ?? '0')));
}

/** Goods back come in batches and serials the invoice line's delivery took, that haven't come back yet. */
async function checkPicks(ctx: Ctx, deliveryLineId: string, l: NoteLineIn, n: number): Promise<void> {
  const [line] = await salesTx(ctx).select({ id: deliveryLines.id, picks: deliveryLines.picks }).from(deliveryLines)
    .where(eq(deliveryLines.id, deliveryLineId));
  if (line === undefined) throw new Error(`delivery line ${deliveryLineId} is missing`);
  const was = (await returnedOf(ctx, [line])).get(line.id);
  const picked = picksOf(line.picks);
  for (const [b, batch] of (l.batches ?? []).entries()) {
    const left = picked.batches.filter((p) => p.batchId === batch.batchId).reduce((s, p) => s.plus(dec(p.qty)), dec('0'))
      .minus(dec(was?.batches.get(pickedBatchKey(batch.batchId)) ?? '0'));
    if (dec(batch.qty).gt(left)) {
      throw new AppError('over_quantity', 'That’s more of a batch than went out in it and hasn’t come back',
        [{ path: ['lines', n, 'batches', b, 'qty'], code: 'over_quantity', message: `${left.toFixed()} of this batch still out` }]);
    }
  }
  const took = new Set(picked.serials.map(serialKey));
  for (const [s, serial] of (l.serials ?? []).entries()) {
    if (!took.has(serialKey(serial)) || was?.serials.get(serialKey(serial)) === true) {
      throw notOnSource(['lines', n, 'serials', s], `${serial} isn’t out on this line`);
    }
  }
}

/**
 * A note's lines against its invoice, with every figure posting writes: each names one of the invoice's lines, once;
 * goods back in a quantity its item's unit allows, from batches and serials still out; and each credit within what
 * standing notes have left of the line (credit-note-rules.ts). Reads only.
 */
export async function noteFigures(ctx: Ctx, inv: Invoice, kind: Kind, lines: readonly NoteLineIn[]) {
  const billed = new Map((await salesTx(ctx).select().from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id))).map((l) => [l.id, l]));
  const credited = await creditedOf(ctx, [...billed.keys()]);
  const intraState = inv.placeOfSupply === inv.issuerStateCode;
  const seen = new Set<string>();
  const out: (CreditFigures & { lineNo: number; line: NoteLineIn; itemId: string; gstRate: string; gstRateSource: string })[] = [];
  for (const [n, l] of lines.entries()) {
    const il = billed.get(l.invoiceLineId);
    if (il === undefined || seen.has(il.id)) {
      throw notOnSource(['lines', n, 'invoiceLineId'], il === undefined ? 'Choose one of the invoice’s lines' : 'Name each line once');
    }
    seen.add(il.id);
    const was = credited.get(il.id);
    const m = (x: string | null) => dec(x ?? '0');
    const left = { qty: dec(il.qty).minus(dec(was?.qty ?? '0')), taxable: m(il.taxable).minus(m(was?.taxable ?? null)),
      cgst: m(il.cgst).minus(m(was?.cgst ?? null)), sgst: m(il.sgst).minus(m(was?.sgst ?? null)),
      igst: m(il.igst).minus(m(was?.igst ?? null)), cost: m(il.cost).minus(m(was?.cost ?? null)) };
    // The cap first (exceeds_invoice), then where goods back come from.
    const back = kind === 'goods' ? { qty: l.qty ?? '0' } : { taxable: l.taxable ?? '0' };
    const figures = creditLine(left, back, il.gstRate ?? '0', intraState, n);
    if (kind === 'goods') {
      await checkQuantity(ctx, il.itemId, l.qty ?? '0').catch((e: unknown) => {
        throw e instanceof AppError ? new AppError(e.code, e.message, [{ path: ['lines', n, 'qty'], code: e.code, message: e.message }]) : e;
      });
      await checkPicks(ctx, il.deliveryLineId, l, n);
    }
    out.push({ ...figures, lineNo: n + 1, line: l, itemId: il.itemId, gstRate: il.gstRate ?? '0', gstRateSource: il.gstRateSource ?? '' });
  }
  return out;
}

/** GET /sales/credit-notes (sales:read): newest first, a page at a time, the principal's own when that's their scope. */
export async function listCreditNotesPage(ctx: Ctx, input: In<typeof listCreditNotes>): Promise<Out<typeof listCreditNotes>> {
  const key = input.after === undefined ? undefined : decodeCursor(PAGE_KEY, input.after);
  const rows = await salesTx(ctx).select({ ...header, createdAt: creditNotes.createdAt }).from(creditNotes).where(and(
    input.filter.status === undefined ? undefined : eq(creditNotes.status, input.filter.status),
    input.filter.invoiceId === undefined ? undefined : eq(creditNotes.invoiceId, input.filter.invoiceId),
    listScope(ctx, 'sales:read', creditNotes.owner),
    after([creditNotes.businessDate, creditNotes.createdAt, creditNotes.id], key && [key.date, key.at, key.id], 'desc'),
  )).orderBy(desc(creditNotes.businessDate), desc(creditNotes.createdAt), desc(creditNotes.id)).limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const names = await partyNames(ctx, page.map((r) => r.partyId));
  const last = page.at(-1);
  return {
    items: page.map((r) => ({ ...r, kind: r.kind as Kind, status: r.status as Status, partyName: names.get(r.partyId) ?? '' })),
    next: rows.length > input.limit && last ? encodeCursor({ date: last.businessDate, at: last.createdAt, id: last.id }) : null,
  };
}

/** GET /sales/credit-notes/:id (sales:read), but for where its approval stands (credit-note-post.ts's getCreditNoteById). */
export async function creditNoteShown(ctx: Ctx, { id }: In<typeof getCreditNote>): Promise<Omit<Out<typeof getCreditNote>, 'approval'>> {
  const c = await noteOf(ctx, id, 'sales:read');
  const lines = await salesTx(ctx).select().from(creditNoteLines).where(eq(creditNoteLines.creditNoteId, id)).orderBy(asc(creditNoteLines.lineNo));
  const names = await partyNames(ctx, [c.partyId]);
  // A note applies only to its own invoice (F9), so each document's number is that invoice's.
  const applied = await creditApplicationsOf(ctx, 'credit_notes', id);
  const [inv] = applied.length === 0 ? [] : await salesTx(ctx).select({ number: invoices.number, owner: invoices.owner }).from(invoices)
    .where(eq(invoices.id, c.invoiceId));
  // The note is its invoice's owner's (ADR-007 §7), so a reader who saw the note sees its invoice.
  if (inv !== undefined) ctx.see('sales:read', { owner: inv.owner });
  const applications = applied.map((a) => ({ ...a, documentNumber: a.documentTable === 'invoices' && a.documentId === c.invoiceId ? inv?.number ?? null : null }));
  return { applications, id: c.id, number: c.number, kind: c.kind as Kind, invoiceId: c.invoiceId, partyId: c.partyId, partyName: names.get(c.partyId) ?? '',
    businessDate: c.businessDate, status: c.status as Status, total: c.total, locationId: c.locationId, reason: c.reason,
    refund: c.refundAmount === null || c.refundAccountId === null ? null : { amount: roundMoney(c.refundAmount), accountId: c.refundAccountId },
    late: c.late, taxable: c.taxable, cgst: c.cgst, sgst: c.sgst, igst: c.igst, roundOff: c.roundOff, amountsNote: null,
    lines: (await labelled(ctx, lines)).map((l) => ({ id: l.id, lineNo: l.lineNo, invoiceLineId: l.invoiceLineId, itemId: l.itemId,
      sku: l.sku, name: l.name, qty: l.qty, taxable: l.taxable,
      gstRate: l.gstRate, gstRateSource: l.gstRateSource, cgst: l.cgst, sgst: l.sgst, igst: l.igst, lineTotal: l.lineTotal, cost: l.cost,
      ...(l.picks === null ? { batches: [], serials: [] } : picksOf(l.picks)) })) };
}

/** POST /sales/credit-notes (credit_notes:write): a draft against a posted invoice the principal may see. */
export async function addCreditNote(ctx: Ctx, input: In<typeof createCreditNote>): Promise<Out<typeof createCreditNote>> {
  const inv = await invoiceToCredit(ctx, input.invoiceId, 'credit_notes:write');
  checkDate(input.businessDate, today(), { date: inv.businessDate, what: 'invoice' });
  if (input.locationId !== null) await checkPlace(ctx, input.locationId);
  const figures = await noteFigures(ctx, inv, input.kind, input.lines);
  const total = roundMoney(figures.reduce((s, f) => s.plus(dec(f.lineTotal)), dec('0')).toDecimalPlaces(0));
  // A counter refund only of what's left once the note settles its invoice, said to the maker now (the RAD-114 note);
  // posting checks it again under the invoice's lock.
  if (input.refund !== null) {
    refundRoom(total, await unpaidOf(ctx, inv), input.refund.amount);
    // Paid from Cash or a bank account (lib-accounts' rule, which the refund's posting applies too).
    const refused = await moneyAccountRefusal(ctx, input.refund.accountId);
    if (refused !== null) throw new AppError('not_money_account', refused, [{ path: ['refund', 'accountId'], code: 'not_money_account', message: refused }]);
  }
  const tx = salesTx(ctx);
  const [row] = await tx.insert(creditNotes).values({ kind: input.kind, invoiceId: inv.id, partyId: inv.partyId, owner: inv.owner,
    businessDate: input.businessDate, locationId: input.locationId, reason: input.reason, refundAmount: input.refund?.amount ?? null,
    refundAccountId: input.refund?.accountId ?? null }).returning({ id: creditNotes.id });
  if (row === undefined) throw new Error('the insert returned no row');
  await tx.insert(creditNoteLines).values(figures.map((f) => ({ creditNoteId: row.id, lineNo: f.lineNo, invoiceLineId: f.line.invoiceLineId,
    itemId: f.itemId, qty: f.line.qty ?? null, taxable: input.kind === 'value' ? f.taxable : null,
    picks: input.kind === 'goods' ? { batches: f.line.batches ?? [], serials: f.line.serials ?? [] } : null })));
  return row;
}


/** The drafted lines, as approval shows them and posting reads them. */
export async function draftedLines(ctx: Ctx, id: string): Promise<NoteLineIn[]> {
  const rows = await salesTx(ctx).select().from(creditNoteLines).where(eq(creditNoteLines.creditNoteId, id)).orderBy(asc(creditNoteLines.lineNo));
  return rows.map((r) => r.picks === null ? { invoiceLineId: r.invoiceLineId, taxable: roundMoney(r.taxable ?? '0') }
    : { invoiceLineId: r.invoiceLineId, qty: r.qty ?? '0', ...picksOf(r.picks) });
}
