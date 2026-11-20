// Orders (M3-08, RAD-112; ADR-007 §1, §3, §4): what a party will take. An order posts nothing; deliveries post against
// its lines. It's edited as a draft, confirmed (its number drawn, last, after the credit and price checks of M3-07),
// then closed (every line delivered, or short with a reason, RC-125) or cancelled (nothing delivered, with a reason).
// A confirmed order's lines still change, only through here, and the checks run again (§1).
import { after, salesOrderLines, salesOrders, salesQuotes, salesTx } from '@radcore/db/sales';
import { holdParty, holdPeriod } from '@radcore/lib-accounts';
import type { SalesOrderStatus } from '@radcore/lib-common';
import {
  AppError, decodeCursor, defineSeries, encodeCursor, listScope, nextNumber, requestApproval, type Ctx,
} from '@radcore/lib-platform';
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type {
  cancelOrder, closeOrder, confirmOrder, createOrder, deleteOrder, getOrder, listOrders, requestOrderOverride, updateOrder,
} from '../contract.ts';
import { checkDate, mayEdit, mayMove } from './document-rules.ts';
import { checkedLines, sellingTo, today } from './document-lines.ts';
import { hasDeliveries, orderDelivered } from './delivered.ts';
import { checkOrder, orderOverride } from './order-checks.ts';
import { listRatesOf, priceListOf } from './party-price-lists.ts';
import { partyNames } from './party-names.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;

/** Orders' numbers (§3): SO/26-27/00001, drawn when an order is confirmed. */
export const ORDER_SERIES = defineSeries('sales.order', 'SO', { digits: 5, label: 'Sales orders' });

const notFound = () => new AppError('not_found', 'There is no such order');
const header = { id: salesOrders.id, number: salesOrders.number, partyId: salesOrders.partyId, quoteId: salesOrders.quoteId,
  businessDate: salesOrders.businessDate, status: salesOrders.status, notes: salesOrders.notes, closeReason: salesOrders.closeReason };
const PAGE_KEY = z.object({ date: z.iso.date(), id: z.uuid() });

/** The order, locked when it's to be written, within the principal's scope for `permission` (else not_found), with
 * its quote's date: an order isn't dated before its quote (§4). The quote is read apart, so only the order is locked. */
async function orderOf(ctx: Ctx, id: string, permission: string, forUpdate = false) {
  const q = salesTx(ctx).select({ ...header, owner: salesOrders.createdBy, overrideVersion: salesOrders.overrideVersion })
    .from(salesOrders).where(eq(salesOrders.id, id));
  const [row] = forUpdate ? await q.for('update') : await q;
  if (row === undefined) throw notFound();
  const { owner, ...order } = row;
  ctx.see(permission, { owner });
  const [quote] = order.quoteId === null ? [] : await salesTx(ctx).select({ date: salesQuotes.businessDate }).from(salesQuotes)
    .where(eq(salesQuotes.id, order.quoteId));
  return { ...order, status: order.status as SalesOrderStatus, quoteDate: quote?.date ?? null, createdBy: owner };
}

// The bound an order's date keeps from its quote (§4), if it came from one.
const fromQuote = (o: { quoteDate: string | null }) => (o.quoteDate === null ? undefined : { date: o.quoteDate, what: 'quote' });

/** The order's list (its party's, else the default) and each line with that list's rate for its item on the order's
 * date, filled here and never from input (the architect on RAD-113). */
async function priced(ctx: Ctx, partyId: string, on: string, lines: Awaited<ReturnType<typeof checkedLines>>) {
  const priceListId = await priceListOf(ctx, partyId);
  const rates = await listRatesOf(ctx, priceListId, on, lines.map((l) => l.itemId));
  return { priceListId, lines: lines.map((l, i) => ({ ...l, listRate: rates[i]?.listRate ?? null, listVersionId: rates[i]?.listVersionId ?? null })) };
}

/** GET /sales/orders (sales:read): newest first, a page at a time, the principal's own when that's their scope. */
export async function listOrdersPage(ctx: Ctx, input: In<typeof listOrders>): Promise<Out<typeof listOrders>> {
  const key = input.after === undefined ? undefined : decodeCursor(PAGE_KEY, input.after);
  const rows = await salesTx(ctx).select(header).from(salesOrders).where(and(
    input.filter.status === undefined ? undefined : eq(salesOrders.status, input.filter.status),
    input.filter.partyId === undefined ? undefined : eq(salesOrders.partyId, input.filter.partyId),
    listScope(ctx, 'sales:read', salesOrders.createdBy),
    after([salesOrders.businessDate, salesOrders.id], key && [key.date, key.id], 'desc'),
  )).orderBy(desc(salesOrders.businessDate), desc(salesOrders.id)).limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const names = await partyNames(ctx, page.map((r) => r.partyId));
  const last = page.at(-1);
  return {
    items: page.map((r) => ({ ...r, status: r.status as SalesOrderStatus, partyName: names.get(r.partyId) ?? '' })),
    next: rows.length > input.limit && last ? encodeCursor({ date: last.businessDate, id: last.id }) : null,
  };
}

/** GET /sales/orders/:id (sales:read). */
export async function getOrderById(ctx: Ctx, { id }: In<typeof getOrder>): Promise<Out<typeof getOrder>> {
  const row = await orderOf(ctx, id, 'sales:read');
  const lines = await salesTx(ctx).select({ id: salesOrderLines.id, lineNo: salesOrderLines.lineNo, itemId: salesOrderLines.itemId,
    qty: salesOrderLines.qty, rate: salesOrderLines.rate, discountPercent: salesOrderLines.discountPercent }).from(salesOrderLines)
    .where(eq(salesOrderLines.orderId, id)).orderBy(asc(salesOrderLines.lineNo));
  const names = await partyNames(ctx, [row.partyId]);
  return { ...row, partyName: names.get(row.partyId) ?? '', lines };
}

/** POST /sales/orders (sales:write): a draft. */
export async function addOrder(ctx: Ctx, input: In<typeof createOrder>): Promise<Out<typeof createOrder>> {
  checkDate(input.businessDate, today());
  await sellingTo(ctx, input.partyId);
  const { priceListId, lines } = await priced(ctx, input.partyId, input.businessDate, await checkedLines(ctx, input.lines));
  const tx = salesTx(ctx);
  const [row] = await tx.insert(salesOrders).values({ partyId: input.partyId, businessDate: input.businessDate, notes: input.notes,
    priceListId }).returning({ id: salesOrders.id });
  if (row === undefined) throw new Error('the insert returned no row');
  await tx.insert(salesOrderLines).values(lines.map((l) => ({ ...l, orderId: row.id })));
  return row;
}

/** PUT /sales/orders/:id (sales:write): a draft, or a confirmed order's lines through the checks again (§1). A
 * confirmed order whose new lines the checks would stop is refused (needs_override): an override is approved for a
 * draft's confirmation, so such a change is a new order. */
export async function changeOrder(ctx: Ctx, { id, ...input }: In<typeof updateOrder>): Promise<Out<typeof updateOrder>> {
  const now = await orderOf(ctx, id, 'sales:write', true);
  mayEdit('order', now.status, true);
  if (now.status === 'confirmed' && (input.partyId !== now.partyId || input.businessDate !== now.businessDate)) {
    throw new AppError('wrong_status', 'A confirmed order keeps its party and date; only its lines change');
  }
  checkDate(input.businessDate, today(), fromQuote(now));
  // A delivery, even a draft, names the order's lines, so they're fixed once one exists: close the order short instead.
  if (await hasDeliveries(ctx, id)) throw new AppError('order_delivered', 'This order has deliveries, so its lines are fixed');
  await sellingTo(ctx, input.partyId);
  const { priceListId, lines } = await priced(ctx, input.partyId, input.businessDate, await checkedLines(ctx, input.lines));
  const tx = salesTx(ctx);
  await tx.update(salesOrders).set({ partyId: input.partyId, businessDate: input.businessDate, notes: input.notes, priceListId })
    .where(eq(salesOrders.id, id));
  await tx.delete(salesOrderLines).where(eq(salesOrderLines.orderId, id));
  await tx.insert(salesOrderLines).values(lines.map((l) => ({ ...l, orderId: id })));
  // A draft's lines changing makes any override approved for the old ones stale; it's asked for again.
  await tx.update(salesOrders).set({ overrideVersion: null }).where(eq(salesOrders.id, id));
  if (now.status === 'confirmed') {
    await holdParty(ctx, now.partyId); // ADR-006 §1's step 3, after the order and before the check
    await checkOrder(ctx, id, { ...input, overrideVersion: null, createdBy: now.createdBy });
  }
  return {};
}

/** DELETE /sales/orders/:id (sales:write): a draft only. Its quote stays accepted. */
export async function dropOrder(ctx: Ctx, { id }: In<typeof deleteOrder>): Promise<Out<typeof deleteOrder>> {
  const now = await orderOf(ctx, id, 'sales:write', true);
  mayEdit('order', now.status);
  await salesTx(ctx).delete(salesOrders).where(eq(salesOrders.id, id));
  return {};
}

/** POST /sales/orders/:id/confirm (sales:write): the credit and price checks (M3-07) first, refused with their issues
 * unless an override was approved for them (sales:override); then its number, drawn as the last step (§3). */
export async function confirmOrderNow(ctx: Ctx, { id }: In<typeof confirmOrder>): Promise<Out<typeof confirmOrder>> {
  // ADR-006 §1: the period lock first, by the order's date read unlocked; then the order, locked, still on that date, as
  // a delivery's posting does, so a confirmation and a delivery never wait on each other in opposite orders (auditor-2
  // on #247).
  const held = (await orderOf(ctx, id, 'sales:write')).businessDate;
  await holdPeriod(ctx, held);
  const now = await orderOf(ctx, id, 'sales:write', true);
  if (now.businessDate !== held) throw new AppError('version_changed', 'This order changed while it was being confirmed: confirm it again');
  mayMove('order', now.status, 'confirmed');
  checkDate(now.businessDate, today(), fromQuote(now));
  await sellingTo(ctx, now.partyId);
  // ADR-006 §1's step 3: the party, after the order, so two sales to it take turns at the credit check (ADR-007 §9).
  await holdParty(ctx, now.partyId);
  await checkOrder(ctx, id, now);
  const number = await nextNumber(ctx, ORDER_SERIES, now.businessDate);
  await salesTx(ctx).update(salesOrders).set({ status: 'confirmed', number }).where(eq(salesOrders.id, id));
  return { number };
}

/** POST /sales/orders/:id/close (sales:write): closed when every line is delivered; closed short otherwise, which
 * releases what's undelivered and needs a reason (RC-125). */
export async function closeOrderNow(ctx: Ctx, { id, reason }: In<typeof closeOrder>): Promise<Out<typeof closeOrder>> {
  const now = await orderOf(ctx, id, 'sales:write', true);
  mayMove('order', now.status, 'closed');
  const short = !(await orderDelivered(ctx, id)).all;
  if (short && reason === undefined) {
    throw new AppError('reason_required', 'Lines are still undelivered: say why the order closes short',
      [{ path: ['reason'], code: 'required', message: 'Say why, in your own words' }]);
  }
  await salesTx(ctx).update(salesOrders).set({ status: 'closed', closeReason: short ? reason ?? null : null }).where(eq(salesOrders.id, id));
  return { short };
}

/** POST /sales/orders/:id/cancel (sales:write): only while nothing on it has been delivered, with a reason. */
export async function cancelOrderNow(ctx: Ctx, { id, reason }: In<typeof cancelOrder>): Promise<Out<typeof cancelOrder>> {
  const now = await orderOf(ctx, id, 'sales:write', true);
  mayMove('order', now.status, 'cancelled');
  if ((await orderDelivered(ctx, id)).any) {
    throw new AppError('order_delivered', 'Goods have gone on this order: close it short instead');
  }
  await salesTx(ctx).update(salesOrders).set({ status: 'cancelled', closeReason: reason }).where(eq(salesOrders.id, id));
  return {};
}

/** POST /sales/orders/:id/override (sales:write): asks someone holding sales:override to approve the draft's issues. */
export async function askOrderOverride(ctx: Ctx, { id }: In<typeof requestOrderOverride>): Promise<Out<typeof requestOrderOverride>> {
  const now = await orderOf(ctx, id, 'sales:write', true);
  mayEdit('order', now.status);
  return requestApproval(ctx, orderOverride, id);
}
