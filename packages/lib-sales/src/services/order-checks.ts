// An order's credit and price checks (M3-07's checkSale, at 'confirm'; RC-061, RC-131) and their override (RAD-112).
// Confirming an order with an issue (over its party's limit, a bill overdue, a line below cost or over its discount)
// needs someone else to approve an override first (sales:override, through defineApproval, RAD-38). The approval
// records the version it approved on the order; confirming takes it while the order and its issues still hash to it,
// so a changed line, a payment or a new cost in between makes it stale.
import { salesOrderLines, salesOrders, salesTx } from '@radcore/db/sales';
import { gstRateFor } from '@radcore/lib-gst';
import { AppError, versionHash, type Ctx } from '@radcore/lib-platform';
import { itemLabels } from '@radcore/lib-stock';
import { asc, eq } from 'drizzle-orm';
import { checkSale, overrideApproval, type OverrideVersion, type SaleCheck } from './checks.ts';
import { netRate, totalWithGst } from './document-rules.ts';

type Order = { partyId: string; businessDate: string; createdBy: string };
type Line = { itemId: string; qty: string; rate: string; discountPercent: string };

const linesOf = (ctx: Ctx, orderId: string) => salesTx(ctx).select({ itemId: salesOrderLines.itemId, qty: salesOrderLines.qty,
  rate: salesOrderLines.rate, discountPercent: salesOrderLines.discountPercent }).from(salesOrderLines)
  .where(eq(salesOrderLines.orderId, orderId)).orderBy(asc(salesOrderLines.lineNo));

/** What an override approves of the order: its party, date and lines, as plain JSON (RAD-38). */
const figuresOf = (o: Omit<Order, 'createdBy'>, lines: readonly Line[]) =>
  ({ partyId: o.partyId, businessDate: o.businessDate, lines: lines.map((l) => ({ ...l })) });

/** What the order asks checkSale at confirmation: its total with GST, each line at its rate after discount against its
 * list rate (its own rate before the discount), from the sellable places together, since an order names no place,
 * judged by its maker's discount limit (the architect on RAD-112). */
async function saleOf(ctx: Ctx, o: Order, lines: readonly Line[]): Promise<SaleCheck> {
  const hsn = await itemLabels(ctx, lines.map((l) => l.itemId));
  const gst: string[] = [];
  for (const l of lines) gst.push((await gstRateFor(ctx, hsn.get(l.itemId)?.hsn ?? '', o.businessDate)).rate);
  return {
    stage: 'confirm', partyId: o.partyId, on: o.businessDate, pricedBy: o.createdBy,
    adds: totalWithGst(lines.map((l, i) => ({ ...l, gstPercent: gst[i] ?? '0' }))),
    lines: lines.map((l) => ({ itemId: l.itemId, locationId: null, rate: netRate(l.rate, l.discountPercent), listRate: l.rate })),
  };
}

/** The override's spec, for defineApproval with approvalContracts('sales-order-override', 'sales:override'). */
export const orderOverride = overrideApproval({
  kind: 'sales-order-override',
  table: 'sales_orders',
  parts: ['sales_order_lines'],
  async read(ctx, id, { forUpdate }) {
    const q = salesTx(ctx).select({ partyId: salesOrders.partyId, businessDate: salesOrders.businessDate, status: salesOrders.status,
      createdBy: salesOrders.createdBy })
      .from(salesOrders).where(eq(salesOrders.id, id));
    const [order] = forUpdate ? await q.for('update') : await q;
    // Its maker asks (sales:write) and someone else decides (sales:override); outside both, there's no such order.
    if (order === undefined || order.status !== 'draft') return null;
    if (!ctx.can('sales:write', { owner: order.createdBy }) && !ctx.can('sales:override', { owner: order.createdBy })) return null;
    const lines = await linesOf(ctx, id);
    return { figures: figuresOf(order, lines), sale: await saleOf(ctx, order, lines) };
  },
  // It records what was approved; confirming the order is its maker's next step.
  async approved(ctx, id) {
    const version = await orderOverride.version(ctx, id, { forUpdate: false });
    if (version !== null) await salesTx(ctx).update(salesOrders).set({ overrideVersion: versionHash(version) }).where(eq(salesOrders.id, id));
  },
  async rejected() {
    // A refused override leaves the order a draft, to change or to ask again.
  },
});

const ISSUE_WORDS: Readonly<Record<string, string>> = {
  over_limit: 'This takes the party over its credit limit',
  overdue: 'The party has a bill past its credit days',
  below_cost: 'This line is priced below the item’s cost',
  cost_unknown: 'This item has no cost to check its price against',
  over_discount: 'This line’s discount is more than your limit',
};

/**
 * Runs the order's checks at confirmation. With issues it's refused, `needs_override`, naming each, unless an override
 * was approved for exactly this order and these issues.
 */
export async function checkOrder(ctx: Ctx, orderId: string, o: Order & { overrideVersion: string | null }): Promise<void> {
  const lines = await linesOf(ctx, orderId);
  const { issues } = await checkSale(ctx, await saleOf(ctx, o, lines));
  if (issues.length === 0) return;
  const version: OverrideVersion = { figures: figuresOf(o, lines), issues };
  if (o.overrideVersion !== null && o.overrideVersion === versionHash(version)) return;
  throw new AppError('needs_override', 'This order needs someone else to approve an override before it’s confirmed',
    issues.map((i) => ({ path: 'line' in i ? ['lines', i.line] : ['partyId'], code: i.code, message: ISSUE_WORDS[i.code] ?? i.code })));
}
