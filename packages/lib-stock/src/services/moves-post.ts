// What a count's differences and an adjustment post (M4-06, RAD-141; ADR-008 §10; ADR-006 §6, F14, F21): goods out at
// the location's average, goods in at it, or at the item's last `in` rate where the location holds none (`no_estimate`
// when there's neither), against the existing `stock_adjustment` account. The entry is netted by account, item and
// location, so a difference between batches alone posts none (F21).
import { stockMovements, stockTx } from '@radcore/db/stock';
import { postEntry, type JournalLine } from '@radcore/lib-accounts';
import { dec, quantityString, roundMoney, type Money, type Rate, type UnitCondition } from '@radcore/lib-common';
import { AppError, type Ctx } from '@radcore/lib-platform';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { postStock, type PostedMovement, type StockIn, type StockOut } from '../engine/stock.ts';
import { averageCost } from './cost.ts';

export type MoveOut = { lineId: string; itemId: string; qty: string; batches: { batchId: string | null; qty: string }[]; serials: string[] };
export type MoveIn = { lineId: string; itemId: string; qty: string; batches: { batchId: string | null; qty: string }[];
  units: { serialNo: string; condition: UnitCondition | null; chassisNo: string | null }[] };

/** The rate a gain comes in at: the location's average, else the item's last `in` rate anywhere (ADR-008 §10). */
async function gainRate(ctx: Ctx, itemId: string, locationId: string): Promise<Rate> {
  const average = await averageCost(ctx, itemId, locationId);
  if (average !== null) return average;
  const [last] = await stockTx(ctx).select({ rate: stockMovements.rate }).from(stockMovements)
    .where(and(eq(stockMovements.itemId, itemId), eq(stockMovements.direction, 'in'), isNotNull(stockMovements.rate)))
    .orderBy(desc(stockMovements.postedAt), desc(stockMovements.id)).limit(1);
  if (last?.rate == null) {
    throw new AppError('no_estimate', 'This item has never come in anywhere, so there’s no cost to bring it in at: receive it instead');
  }
  return last.rate as Rate;
}

/** Posts the outs and ins at `locationId`, a serialised shortage `scrapped` and a found unit `received` (with `batchNo`
 * as its batch, the document's number), and the netted entry. Answers each line's value, and the entry's id or null. */
export async function postDifferences(ctx: Ctx, p: { sourceTable: string; sourceId: string; businessDate: string; locationId: string;
  kind: 'stock_adjustment'; outs: readonly MoveOut[]; ins: readonly MoveIn[]; batchNo: string }): Promise<{ values: Map<string, Money>; entryId: string | null }> {
  const q = (s: string) => quantityString().parse(s);
  const outs: StockOut[] = p.outs.map((o) => ({ itemId: o.itemId, locationId: p.locationId, sourceLineId: o.lineId, qty: q(o.qty),
    batches: o.batches.map((b) => ({ batchId: b.batchId, qty: q(b.qty) })), units: o.serials.map((serialNo) => ({ serialNo })),
    unitEvent: 'scrapped' as const }));
  const ins: StockIn[] = [];
  for (const i of p.ins) {
    ins.push({ itemId: i.itemId, locationId: p.locationId, sourceLineId: i.lineId, qty: q(i.qty), rate: await gainRate(ctx, i.itemId, p.locationId),
      batches: i.units.length > 0 ? [{ batchNo: p.batchNo, qty: q(i.qty) }] : i.batches.map((b) => ({ batchId: b.batchId, qty: q(b.qty) })),
      units: i.units.map((u) => ({ serialNo: u.serialNo, batchNo: p.batchNo, ...(u.chassisNo === null ? {} : { chassisNo: u.chassisNo }),
        ...(u.condition === null ? {} : { condition: u.condition }) })), unitEvent: 'received' as const });
  }
  const moved = await postStock(ctx, { sourceTable: p.sourceTable, sourceId: p.sourceId, businessDate: p.businessDate, outs, ins });
  // The engine posts the outs, then the ins, each in the order given.
  const lineIds = [...p.outs.map((o) => o.lineId), ...p.ins.map((i) => i.lineId)];
  const values = new Map<string, Money>();
  for (const [n, m] of moved.filter((x) => x.direction !== 'revalue').entries()) {
    const id = lineIds[n];
    if (id !== undefined) values.set(id, roundMoney(dec(values.get(id) ?? '0').plus(dec(m.value))));
  }
  return { values, entryId: await entryOf(ctx, p, moved) };
}

/** Dr Stock in Hand and Cr Stock Adjustment for a gain, the other way for a shortage, netted by item and location. */
async function entryOf(ctx: Ctx, p: { sourceTable: string; sourceId: string; businessDate: string; kind: 'stock_adjustment' },
  moved: readonly PostedMovement[]): Promise<string | null> {
  const net = new Map<string, { itemId: string; locationId: string; value: ReturnType<typeof dec> }>();
  for (const m of moved) {
    const k = `${m.itemId} ${m.locationId}`;
    const signed = m.direction === 'out' ? dec(m.value).neg() : dec(m.value);
    net.set(k, { itemId: m.itemId, locationId: m.locationId, value: (net.get(k)?.value ?? dec('0')).plus(signed) });
  }
  const lines: JournalLine[] = [];
  for (const n of net.values()) {
    if (n.value.isZero()) continue;
    const amount = roundMoney(n.value.abs());
    const stock = { account: { system: 'stock' }, itemId: n.itemId, locationId: n.locationId };
    const adjustment = { account: { system: 'stock_adjustment' } };
    lines.push(n.value.isPositive() ? { ...stock, debit: amount } : { ...stock, credit: amount },
      n.value.isPositive() ? { ...adjustment, credit: amount } : { ...adjustment, debit: amount });
  }
  if (lines.length === 0) return null;
  return (await postEntry(ctx, { kind: p.kind, businessDate: p.businessDate, source: { table: p.sourceTable, id: p.sourceId }, lines })).id;
}
