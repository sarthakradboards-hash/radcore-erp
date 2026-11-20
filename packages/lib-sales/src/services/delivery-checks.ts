// A delivery's figures and its checks (M3-08, RAD-112; ADR-007 §9, M3-07's checkSale at 'deliver'). Each line sells at
// its order line's rate after discount, with GST at the rate in force on the delivery's date: what Goods Delivered Not
// Invoiced and the party's credit carry until it's invoiced. Its lines copy their order lines' prices unchanged, so
// only credit is checked here (§9: price where it isn't copied from an approved order line). Over it, posting needs
// an override someone else approved (sales:override), for exactly these figures and issues, as an order's.
import { deliveries, deliveryLines, salesOrderLines, salesTx } from '@radcore/db/sales';
import { dec, roundMoney, type Money } from '@radcore/lib-common';
import { gstRateFor } from '@radcore/lib-gst';
import { AppError, versionHash, type Ctx } from '@radcore/lib-platform';
import { itemLabels } from '@radcore/lib-stock';
import { asc, eq, inArray } from 'drizzle-orm';
import { checkSale, overrideApproval, type OverrideVersion, type SaleCheck } from './checks.ts';
import { deliveredNotInvoiced } from './delivered.ts';
import { lineValues } from './document-rules.ts';
import { ISSUE_WORDS } from './order-checks.ts';

type Delivery = { orderId: string; partyId: string; locationId: string; businessDate: string; createdBy: string };
type Line = { id: string; orderLineId: string; itemId: string; qty: string };

/** A delivery's lines, in their order. */
export const deliveryLinesOf = (ctx: Ctx, deliveryId: string) => salesTx(ctx).select({ id: deliveryLines.id, lineNo: deliveryLines.lineNo,
  orderLineId: deliveryLines.orderLineId, itemId: deliveryLines.itemId, qty: deliveryLines.qty, picks: deliveryLines.picks })
  .from(deliveryLines).where(eq(deliveryLines.deliveryId, deliveryId)).orderBy(asc(deliveryLines.lineNo));

/** What each line sells for: its taxable value and GST, at its order line's rate and discount, on the delivery's date. */
export async function pricedLines(ctx: Ctx, on: string, lines: readonly Line[]): Promise<{ taxable: Money; gst: Money }[]> {
  if (lines.length === 0) return [];
  const rates = new Map((await salesTx(ctx).select({ id: salesOrderLines.id, rate: salesOrderLines.rate, discountPercent: salesOrderLines.discountPercent })
    .from(salesOrderLines).where(inArray(salesOrderLines.id, lines.map((l) => l.orderLineId)))).map((r) => [r.id, r]));
  const hsn = await itemLabels(ctx, lines.map((l) => l.itemId));
  const priced: { taxable: Money; gst: Money }[] = [];
  for (const l of lines) {
    const gstPercent = (await gstRateFor(ctx, hsn.get(l.itemId)?.hsn ?? '', on)).rate;
    const r = rates.get(l.orderLineId);
    priced.push(lineValues({ qty: l.qty, rate: r?.rate ?? '0', discountPercent: r?.discountPercent ?? '0', gstPercent }));
  }
  return priced;
}

/** What an override approves of the delivery: its order, party, place, date and lines, as plain JSON (RAD-38). */
const figuresOf = (d: Delivery, lines: readonly Line[]) => ({ orderId: d.orderId, partyId: d.partyId, locationId: d.locationId,
  businessDate: d.businessDate, lines: lines.map((l) => ({ orderLineId: l.orderLineId, itemId: l.itemId, qty: l.qty })) });

/** What the delivery asks checkSale: what it adds at selling value with GST, beside what the party already has
 * delivered and not invoiced; its lines unpriced, as their prices are the order's. */
async function saleOf(ctx: Ctx, d: Delivery, lines: readonly Line[]): Promise<SaleCheck> {
  const priced = await pricedLines(ctx, d.businessDate, lines);
  return {
    stage: 'deliver', partyId: d.partyId, on: d.businessDate, pricedBy: d.createdBy,
    adds: roundMoney(priced.reduce((s, p) => s.plus(dec(p.taxable)).plus(dec(p.gst)), dec('0'))),
    notInvoiced: await deliveredNotInvoiced(ctx, d.partyId),
    lines: lines.map((l) => ({ itemId: l.itemId, locationId: d.locationId, rate: null, listRate: null })),
  };
}

/** The override's spec, for defineApproval with approvalContracts('sales-delivery-override', 'sales:override'). */
export const deliveryOverride = overrideApproval({
  kind: 'sales-delivery-override',
  table: 'deliveries',
  parts: ['delivery_lines'],
  async read(ctx, id, { forUpdate }) {
    const q = salesTx(ctx).select({ orderId: deliveries.orderId, partyId: deliveries.partyId, locationId: deliveries.locationId,
      businessDate: deliveries.businessDate, status: deliveries.status, createdBy: deliveries.createdBy }).from(deliveries)
      .where(eq(deliveries.id, id));
    const [d] = forUpdate ? await q.for('update') : await q;
    // Its maker asks (deliveries:write) and someone else decides (sales:override); outside both, there's no such delivery.
    if (d === undefined || d.status !== 'draft') return null;
    if (!ctx.can('deliveries:write', { owner: d.createdBy }) && !ctx.can('sales:override', { owner: d.createdBy })) return null;
    const lines = await deliveryLinesOf(ctx, id);
    return { figures: figuresOf(d, lines), sale: await saleOf(ctx, d, lines) };
  },
  // It records what was approved; posting the delivery is its maker's next step.
  async approved(ctx, id) {
    const version = await deliveryOverride.version(ctx, id, { forUpdate: false });
    if (version !== null) await salesTx(ctx).update(deliveries).set({ overrideVersion: versionHash(version) }).where(eq(deliveries.id, id));
  },
  async rejected() {
    // A refused override leaves the delivery a draft, to change or to ask again.
  },
});

/**
 * Runs the delivery's credit check as it posts. With issues it's refused, `needs_override`, naming each, unless an
 * override was approved for exactly this delivery and these issues.
 */
export async function checkDelivery(ctx: Ctx, d: Delivery & { overrideVersion: string | null }, lines: readonly Line[]): Promise<void> {
  const { issues } = await checkSale(ctx, await saleOf(ctx, d, lines));
  if (issues.length === 0) return;
  const version: OverrideVersion = { figures: figuresOf(d, lines), issues };
  if (d.overrideVersion !== null && d.overrideVersion === versionHash(version)) return;
  throw new AppError('needs_override', 'This delivery needs someone else to approve an override before it’s posted',
    issues.map((i) => ({ path: 'line' in i ? ['lines', i.line] : ['partyId'], code: i.code, message: ISSUE_WORDS[i.code] ?? i.code })));
}
