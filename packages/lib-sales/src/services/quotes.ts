// Quotes (M3-08, RAD-112; ADR-007 §1, §3, §4): what we offered a party, at what rates. A quote posts nothing. It's
// edited as a draft, sent (its number drawn, last), then accepted (which makes a draft order from it), declined or
// expired. A draft is thrown away freely: it never had a number.
import { after, salesOrderLines, salesOrders, salesQuoteLines, salesQuotes, salesTx } from '@radcore/db/sales';
import { holdPeriod } from '@radcore/lib-accounts';
import type { SalesQuoteStatus } from '@radcore/lib-common';
import { AppError, decodeCursor, defineSeries, encodeCursor, listScope, nextNumber, type Ctx } from '@radcore/lib-platform';
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type {
  acceptQuote, closeQuote, createQuote, deleteQuote, getQuote, listQuotes, sendQuote, updateQuote,
} from '../contract.ts';
import { checkDate, mayEdit, mayMove } from './document-rules.ts';
import { checkedLines, sellingTo, today } from './document-lines.ts';
import { partyNames } from './party-names.ts';
import { listRatesOf, priceListOf } from './party-price-lists.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;

/** Quotes' numbers (§3): QT/26-27/00001, drawn when a quote is sent. */
export const QUOTE_SERIES = defineSeries('sales.quote', 'QT', { digits: 5 });

const notFound = () => new AppError('not_found', 'There is no such quote');
const header = { id: salesQuotes.id, number: salesQuotes.number, partyId: salesQuotes.partyId, businessDate: salesQuotes.businessDate,
  validUntil: salesQuotes.validUntil, status: salesQuotes.status, notes: salesQuotes.notes };
const PAGE_KEY = z.object({ date: z.iso.date(), id: z.uuid() });

/** The quote, locked when it's to be written, within the principal's scope for `permission` (else not_found). */
async function quoteOf(ctx: Ctx, id: string, permission: string, forUpdate = false) {
  const q = salesTx(ctx).select({ ...header, owner: salesQuotes.createdBy }).from(salesQuotes).where(eq(salesQuotes.id, id));
  const [row] = forUpdate ? await q.for('update') : await q;
  if (row === undefined) throw notFound();
  const { owner, ...quote } = row;
  ctx.see(permission, { owner });
  return quote;
}

/** GET /sales/quotes (sales:read): newest first, a page at a time, the principal's own when that's their scope. */
export async function listQuotesPage(ctx: Ctx, input: In<typeof listQuotes>): Promise<Out<typeof listQuotes>> {
  const key = input.after === undefined ? undefined : decodeCursor(PAGE_KEY, input.after);
  const rows = await salesTx(ctx).select(header).from(salesQuotes).where(and(
    input.filter.status === undefined ? undefined : eq(salesQuotes.status, input.filter.status),
    input.filter.partyId === undefined ? undefined : eq(salesQuotes.partyId, input.filter.partyId),
    listScope(ctx, 'sales:read', salesQuotes.createdBy),
    after([salesQuotes.businessDate, salesQuotes.id], key && [key.date, key.id], 'desc'),
  )).orderBy(desc(salesQuotes.businessDate), desc(salesQuotes.id)).limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const names = await partyNames(ctx, page.map((r) => r.partyId));
  const last = page.at(-1);
  return {
    items: page.map((r) => ({ ...r, status: r.status as SalesQuoteStatus, partyName: names.get(r.partyId) ?? '' })),
    next: rows.length > input.limit && last ? encodeCursor({ date: last.businessDate, id: last.id }) : null,
  };
}

/** GET /sales/quotes/:id (sales:read). */
export async function getQuoteById(ctx: Ctx, { id }: In<typeof getQuote>): Promise<Out<typeof getQuote>> {
  const row = await quoteOf(ctx, id, 'sales:read');
  const lines = await salesTx(ctx).select({ id: salesQuoteLines.id, lineNo: salesQuoteLines.lineNo, itemId: salesQuoteLines.itemId,
    qty: salesQuoteLines.qty, rate: salesQuoteLines.rate, discountPercent: salesQuoteLines.discountPercent }).from(salesQuoteLines)
    .where(eq(salesQuoteLines.quoteId, id)).orderBy(asc(salesQuoteLines.lineNo));
  const names = await partyNames(ctx, [row.partyId]);
  return { ...row, status: row.status as SalesQuoteStatus, partyName: names.get(row.partyId) ?? '', lines };
}

/** POST /sales/quotes (sales:write): a draft. */
export async function addQuote(ctx: Ctx, input: In<typeof createQuote>): Promise<Out<typeof createQuote>> {
  checkDate(input.businessDate, today());
  await sellingTo(ctx, input.partyId);
  const lines = await checkedLines(ctx, input.lines);
  const tx = salesTx(ctx);
  const [row] = await tx.insert(salesQuotes).values({ partyId: input.partyId, businessDate: input.businessDate,
    validUntil: input.validUntil, notes: input.notes }).returning({ id: salesQuotes.id });
  if (row === undefined) throw new Error('the insert returned no row');
  await tx.insert(salesQuoteLines).values(lines.map((l) => ({ ...l, quoteId: row.id })));
  return row;
}

/** PUT /sales/quotes/:id (sales:write): a draft, rewritten whole. */
export async function changeQuote(ctx: Ctx, { id, ...input }: In<typeof updateQuote>): Promise<Out<typeof updateQuote>> {
  const now = await quoteOf(ctx, id, 'sales:write', true);
  mayEdit('quote', now.status);
  checkDate(input.businessDate, today());
  await sellingTo(ctx, input.partyId);
  const lines = await checkedLines(ctx, input.lines);
  const tx = salesTx(ctx);
  await tx.update(salesQuotes).set({ partyId: input.partyId, businessDate: input.businessDate, validUntil: input.validUntil,
    notes: input.notes }).where(eq(salesQuotes.id, id));
  await tx.delete(salesQuoteLines).where(eq(salesQuoteLines.quoteId, id));
  await tx.insert(salesQuoteLines).values(lines.map((l) => ({ ...l, quoteId: id })));
  return {};
}

/** DELETE /sales/quotes/:id (sales:write): a draft only. */
export async function dropQuote(ctx: Ctx, { id }: In<typeof deleteQuote>): Promise<Out<typeof deleteQuote>> {
  const now = await quoteOf(ctx, id, 'sales:write', true);
  mayEdit('quote', now.status);
  await salesTx(ctx).delete(salesQuotes).where(eq(salesQuotes.id, id));
  return {};
}

/** POST /sales/quotes/:id/send (sales:write): its number is drawn as the last step (§3). */
export async function sendQuoteNow(ctx: Ctx, { id }: In<typeof sendQuote>): Promise<Out<typeof sendQuote>> {
  const now = await quoteOf(ctx, id, 'sales:write', true);
  mayMove('quote', now.status, 'sent');
  checkDate(now.businessDate, today());
  await holdPeriod(ctx, now.businessDate);
  const number = await nextNumber(ctx, QUOTE_SERIES, now.businessDate);
  await salesTx(ctx).update(salesQuotes).set({ status: 'sent', number }).where(eq(salesQuotes.id, id));
  return { number };
}

/** POST /sales/quotes/:id/accept (sales:write): a draft order with the quote's lines, not dated before it (§4). */
export async function acceptQuoteNow(ctx: Ctx, { id, businessDate }: In<typeof acceptQuote>): Promise<Out<typeof acceptQuote>> {
  const now = await quoteOf(ctx, id, 'sales:write', true);
  mayMove('quote', now.status, 'accepted');
  checkDate(businessDate, today(), { date: now.businessDate, what: 'quote' });
  const tx = salesTx(ctx);
  const lines = await tx.select({ lineNo: salesQuoteLines.lineNo, itemId: salesQuoteLines.itemId, qty: salesQuoteLines.qty,
    rate: salesQuoteLines.rate, discountPercent: salesQuoteLines.discountPercent }).from(salesQuoteLines)
    .where(eq(salesQuoteLines.quoteId, id)).orderBy(asc(salesQuoteLines.lineNo));
  await tx.update(salesQuotes).set({ status: 'accepted' }).where(eq(salesQuotes.id, id));
  // The order is priced as one made directly (auditor-2 on #254): its party's list, and each line's rate in it on the
  // order's date, filled here, never from the quote (the architect on RAD-113).
  const priceListId = await priceListOf(ctx, now.partyId);
  const rates = await listRatesOf(ctx, priceListId, businessDate, lines.map((l) => l.itemId));
  const [order] = await tx.insert(salesOrders).values({ partyId: now.partyId, quoteId: id, businessDate, notes: now.notes, priceListId })
    .returning({ id: salesOrders.id });
  if (order === undefined) throw new Error('the insert returned no row');
  await tx.insert(salesOrderLines).values(lines.map((l, i) => ({ ...l, orderId: order.id, listRate: rates[i]?.listRate ?? null,
    listVersionId: rates[i]?.listVersionId ?? null })));
  return { orderId: order.id };
}

/** POST /sales/quotes/:id/close (sales:write): declined, or expired. */
export async function closeQuoteNow(ctx: Ctx, { id, outcome }: In<typeof closeQuote>): Promise<Out<typeof closeQuote>> {
  const now = await quoteOf(ctx, id, 'sales:write', true);
  mayMove('quote', now.status, outcome);
  await salesTx(ctx).update(salesQuotes).set({ status: outcome }).where(eq(salesQuotes.id, id));
  return {};
}

