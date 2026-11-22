// Quotes', orders' and delivery returns' count cards (RAD-125, ADR-001 §6's lists: a list has no total, RC-176, so a screen that shows
// counts asks for them here). Each status's count, within the principal's scope exactly as its list is (E7), every
// status present, 0 where none.
import { deliveryReturns, salesOrders, salesQuotes, salesTx } from '@radcore/db/sales';
import { SALES_ORDER_STATUSES, SALES_QUOTE_STATUSES } from '@radcore/lib-common';
import { listScope, type Ctx } from '@radcore/lib-platform';
import { and, count, eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { countDeliveryReturns, countOrders, countQuotes } from '../contract.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;

/** Every status, with its count or 0. */
const byStatus = <S extends string>(statuses: readonly S[], rows: readonly { status: string; n: number }[]) =>
  Object.fromEntries(statuses.map((s) => [s, rows.find((r) => r.status === s)?.n ?? 0])) as Record<S, number>;

/** GET /sales/quote-counts (sales:read). */
export async function quoteCounts(ctx: Ctx, { partyId }: In<typeof countQuotes>): Promise<Out<typeof countQuotes>> {
  const rows = await salesTx(ctx).select({ status: salesQuotes.status, n: count() }).from(salesQuotes).where(and(
    partyId === undefined ? undefined : eq(salesQuotes.partyId, partyId),
    listScope(ctx, 'sales:read', salesQuotes.createdBy),
  )).groupBy(salesQuotes.status);
  return { byStatus: byStatus(SALES_QUOTE_STATUSES, rows) };
}

/** GET /sales/order-counts (sales:read). */
export async function orderCounts(ctx: Ctx, { partyId }: In<typeof countOrders>): Promise<Out<typeof countOrders>> {
  const rows = await salesTx(ctx).select({ status: salesOrders.status, n: count() }).from(salesOrders).where(and(
    partyId === undefined ? undefined : eq(salesOrders.partyId, partyId),
    listScope(ctx, 'sales:read', salesOrders.createdBy),
  )).groupBy(salesOrders.status);
  return { byStatus: byStatus(SALES_ORDER_STATUSES, rows) };
}

/** GET /sales/delivery-return-counts (sales:read): a delivery's, with `deliveryId` (auditor-3 on #288). */
export async function deliveryReturnCounts(ctx: Ctx, { deliveryId }: In<typeof countDeliveryReturns>): Promise<Out<typeof countDeliveryReturns>> {
  const rows = await salesTx(ctx).select({ status: deliveryReturns.status, n: count() }).from(deliveryReturns).where(and(
    deliveryId === undefined ? undefined : eq(deliveryReturns.deliveryId, deliveryId),
    listScope(ctx, 'sales:read', deliveryReturns.owner),
  )).groupBy(deliveryReturns.status);
  return { byStatus: byStatus(['draft', 'posted', 'cancelled'] as const, rows) };
}
