// What a count's differences and an adjustment post (M4-06, RAD-141; ADR-008 §10; ADR-006 §6, F14, F21): goods out at
// the location's average, goods in at it, or at the item's last `in` rate where the location holds none, else its
// purchase price (`no_estimate` when there's none of these), against the existing `stock_adjustment` account. The entry is netted by account, item and
// location, so a difference between batches alone posts none (F21).
import { stockMovements, stockTx } from '@radcore/db/stock';
import { postEntry, type JournalLine } from '@radcore/lib-accounts';
import { dec, quantityString, roundMoney, type Money, type Rate, type UnitCondition } from '@radcore/lib-common';
import { AppError, type Ctx } from '@radcore/lib-platform';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { postStock, purchasePriceOf, type PostedMovement, type StockIn, type StockOut } from '../engine/stock.ts';
import { averageCost } from './cost.ts';

export type MoveOut = { lineId: string; itemId: string; qty: string; batches: { batchId: string | null; qty: string }[]; serials: string[] };
export type MoveIn = { lineId: string; itemId: string; qty: string; batches: { batchId: string | null; qty: string }[];
  units: { serialNo: string; condition: UnitCondition | null; chassisNo: string | null }[] };

/** The rate a gain comes in at: the location's average, else the item's last `in` rate anywhere (ADR-008 §10), else its
 * purchase price (the architect on RAD-144, as ADR-006 §4's estimate falls back). */
async function gainRate(ctx: Ctx, itemId: string, locationId: string): Promise<Rate> {
  const average = await averageCost(ctx, itemId, locationId);
  if (average !== null) return average;
  const [last] = await stockTx(ctx).select({ rate: stockMovements.rate }).from(stockMovements)
    .where(and(eq(stockMovements.itemId, itemId), eq(stockMovements.direction, 'in'), isNotNull(stockMovements.rate)))
    .orderBy(desc(stockMovements.postedAt), desc(stockMovements.id)).limit(1);
  if (last?.rate != null) return last.rate as Rate;
  const price = await purchasePriceOf(ctx, itemId);
  if (price === undefined) {
    throw new AppError('no_estimate', 'This item has never come in and has no purchase price, so there’s no cost to bring it in at: set one, or receive it');
  }
  return price as Rate;
}

/** Posts the outs and ins at `locationId`, a serialised shortage `scrapped` and a found unit `received` (with `batchNo`
 * as its batch, the document's number), and the netted entry. Answers each line's value, and the entry's id or null. */
export async function postDifferences(ctx: Ctx, p: { sourceTable: string; sourceId: string; businessDate: string; locationId: string;
  kind: 'stock_adjustment'; outs: readonly MoveOut[]; ins: readonly MoveIn[]; batchNo: string }): Promise<{ values: Map<string, Money>; entryId: string | null }> {
  const q = (s: string) => quantityString().parse(s);
  const outs: StockOut[] = p.outs.map((o) => ({ itemId: o.itemId, locationId: p.locationId, sourceLineId: o.lineId, qty: q(o.qty),
    batches: o.batches.map((b) => ({ batchId: b.batchId, qty: q(b.qty) })), units: o.serials.map((serialNo) => ({ serialNo })),
    unitEvent: 'scrapped' as const }));
  // The shortages go out first, so an item whose gains match its shortages (a difference between batches alone, F21)
  // brings them in at exactly the value that went out, and its entry nets to nothing.
  const movedOut = outs.length === 0 ? [] : await postStock(ctx, { sourceTable: p.sourceTable, sourceId: p.sourceId, businessDate: p.businessDate, outs });
  const outOf = (itemId: string) => movedOut.filter((m) => m.itemId === itemId && m.direction === 'out');
  const ins: StockIn[] = [];
  for (const i of p.ins) {
    const sameItem = p.ins.filter((x) => x.itemId === i.itemId);
    const outQty = p.outs.filter((o) => o.itemId === i.itemId).reduce((t, o) => t.plus(dec(o.qty)), dec('0'));
    const inQty = sameItem.reduce((t, x) => t.plus(dec(x.qty)), dec('0'));
    const outValue = outOf(i.itemId).reduce((t, m) => t.plus(dec(m.value)), dec('0'));
    // Between batches alone: each gain takes its share of what went out, the last the remainder, so the sum is exact.
    const share = (): Money => {
      const before = sameItem.slice(0, sameItem.indexOf(i)).reduce((t, x) => t.plus(roundMoney(outValue.times(dec(x.qty)).div(inQty))), dec('0'));
      return sameItem.at(-1) === i ? roundMoney(outValue.minus(before)) : roundMoney(outValue.times(dec(i.qty)).div(inQty));
    };
    const moves = outQty.eq(inQty) && i.units.length === 0;
    ins.push({ itemId: i.itemId, locationId: p.locationId, sourceLineId: i.lineId, qty: q(i.qty), rate: await gainRate(ctx, i.itemId, p.locationId),
      ...(moves ? { value: share() } : {}),
      batches: i.units.length > 0 ? [{ batchNo: p.batchNo, qty: q(i.qty) }] : i.batches.map((b) => ({ batchId: b.batchId, qty: q(b.qty) })),
      units: i.units.map((u) => ({ serialNo: u.serialNo, batchNo: p.batchNo, ...(u.chassisNo === null ? {} : { chassisNo: u.chassisNo }),
        ...(u.condition === null ? {} : { condition: u.condition }) })), unitEvent: 'received' as const });
  }
  const moved = [...movedOut, ...(ins.length === 0 ? [] : await postStock(ctx, { sourceTable: p.sourceTable, sourceId: p.sourceId, businessDate: p.businessDate, ins }))];
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
