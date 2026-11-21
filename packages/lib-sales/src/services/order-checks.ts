// An order's credit and price checks (M3-07's checkSale, at 'confirm'; RC-061, RC-131) and their override (RAD-112).
// Confirming an order with an issue (over its party's limit, a bill overdue, a line below cost or over its discount)
// needs someone else to approve an override first (sales:override, through defineApproval, RAD-38). The approval
// records the version it approved on the order; confirming takes it while the order and its issues still hash to it,
// so a changed line, a payment or a new cost in between makes it stale.
import { priceListVersions, salesOrderLines, salesOrders, salesTx } from '@radcore/db/sales';
import { AppError, versionHash, type Ctx } from '@radcore/lib-platform';
import { asc, eq } from 'drizzle-orm';
import { checkSale, overrideApproval, type OverrideVersion, type SaleCheck } from './checks.ts';
import { deliveredNotInvoiced } from './delivered.ts';
import { amountsOf, type Amounts } from './document-amounts.ts';
import { listRateBeforeTax, netRate } from './document-rules.ts';
import { heldPaid } from './quick-bill-holds.ts';

type Order = { partyId: string; businessDate: string; createdBy: string };
type Line = { itemId: string; qty: string; rate: string; discountPercent: string; listRate: string | null; listTaxInclusive: boolean | null };

// Each line with its list rate as priced and whether its version includes GST.
const linesOf = (ctx: Ctx, orderId: string) => salesTx(ctx).select({ itemId: salesOrderLines.itemId, qty: salesOrderLines.qty,
  rate: salesOrderLines.rate, discountPercent: salesOrderLines.discountPercent, listRate: salesOrderLines.listRate,
  listTaxInclusive: priceListVersions.taxInclusive }).from(salesOrderLines)
  .leftJoin(priceListVersions, eq(priceListVersions.id, salesOrderLines.listVersionId))
  .where(eq(salesOrderLines.orderId, orderId)).orderBy(asc(salesOrderLines.lineNo));

/** What an override approves of the order: its party, date and lines, as plain JSON (RAD-38). */
const figuresOf = (o: Omit<Order, 'createdBy'>, lines: readonly Line[]) =>
  ({ partyId: o.partyId, businessDate: o.businessDate, lines: lines.map((l) => ({ ...l })) });

/** What the order asks checkSale at confirmation: its total as worked out to be stored (the architect on RAD-112), each
 * line at its rate after discount against its stored list rate before GST at the line's rate (the architect on RAD-113),
 * from the sellable places together, since an order names no place, judged by its maker's discount limit (RAD-112). */
async function saleOf(ctx: Ctx, o: Order, lines: readonly Line[], a: Amounts, paidNow?: string): Promise<SaleCheck> {
  return {
    stage: 'confirm', partyId: o.partyId, on: o.businessDate, pricedBy: o.createdBy, adds: a.totals.total,
    ...(paidNow === undefined ? {} : { paidNow }),
    notInvoiced: await deliveredNotInvoiced(ctx, o.partyId),
    lines: lines.map((l, i) => ({ itemId: l.itemId, locationId: null, rate: netRate(l.rate, l.discountPercent),
      listRate: l.listRate === null ? null : listRateBeforeTax(l.listRate, l.listTaxInclusive === true, a.lines[i]?.gstRate ?? '0') })),
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
    // A held quick bill is judged with its planned payments taken, as completing it takes them first (RAD-115).
    const paid = await heldPaid(ctx, id);
    return { figures: figuresOf(order, lines), sale: await saleOf(ctx, order, lines, await amountsOf(ctx, order.partyId, order.businessDate, lines),
      paid ?? undefined) };
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

/** How each check issue reads to the person, for every document the checks stop. */
export const ISSUE_WORDS: Readonly<Record<string, string>> = {
  over_limit: 'This takes the party over its credit limit',
  overdue: 'The party has a bill past its credit days',
  below_cost: 'This line is priced below the item’s cost',
  cost_unknown: 'This item has no cost to check its price against',
  no_list_rate: 'This item has no price on the party’s price list to check its discount against',
  over_discount: 'This line’s discount is more than your limit',
};

/** The order's check now, as confirming it will run it: what completing a held quick bill lets its delivery and invoice
 * through on (the issue kinds, and what's owed then). Reads only. */
export async function orderCheckNow(ctx: Ctx, orderId: string, o: Order) {
  const lines = await linesOf(ctx, orderId);
  return checkSale(ctx, await saleOf(ctx, o, lines, await amountsOf(ctx, o.partyId, o.businessDate, lines)));
}

/**
 * Runs the order's checks at confirmation, on the amounts it's about to store. With issues it's refused,
 * `needs_override`, naming each, unless an override was approved for exactly this order and these issues. Answers the
 * amounts, for the caller to store.
 */
export async function checkOrder(ctx: Ctx, orderId: string, o: Order & { overrideVersion: string | null }): Promise<Amounts> {
  const lines = await linesOf(ctx, orderId);
  const a = await amountsOf(ctx, o.partyId, o.businessDate, lines);
  const { issues } = await checkSale(ctx, await saleOf(ctx, o, lines, a));
  if (issues.length === 0) return a;
  const version: OverrideVersion = { figures: figuresOf(o, lines), issues };
  if (o.overrideVersion !== null && o.overrideVersion === versionHash(version)) return a;
  throw new AppError('needs_override', 'This order needs someone else to approve an override before it’s confirmed',
    issues.map((i) => ({ path: 'line' in i ? ['lines', i.line] : ['partyId'], code: i.code, message: ISSUE_WORDS[i.code] ?? i.code })));
}
