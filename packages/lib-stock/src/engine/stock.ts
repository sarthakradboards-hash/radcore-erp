// The stock engine (ADR-006 §1, §4, §4a; M2-05, RAD-93). A document's service calls `postStock` inside its save's one
// transaction for the document's movements: goods in, goods out, and transfers between locations. It keeps:
// - one moving average per item and location, so rejected, job-work and demo stock, each in its own kind of location,
//   never enter the average of the stock that is sold (RC-205);
// - a business date on every movement (RC-025), and costs fixed at posting, in posting order (§4);
// - one lock order (RC-053, §1): the touched positions, created if new and locked `ORDER BY item_id, location_id FOR
//   UPDATE`, then any new batches, created in `(item_id, supplier_id, batch_key)` order, null supplier first. Never
//   the item row, whose lock would block every insert that references the item;
// - batches on every `in` and `out` (D-15, §4a): the person picking names them; the engine never chooses.
// shortcut: negative stock, its revaluation and the database's commit checks (RA007) are RAD-93's second PR, and the
// Stock in Hand lines it hands the journal engine its third. Until then an issue beyond what's on hand is refused.
import {
  batches, stockMovementBatches, stockMovements, stockPositions, stockTx,
} from '@radcore/db/stock';
import { dec, roundMoney, roundRate, type Money, type Quantity, type Rate } from '@radcore/lib-common';
import { AppError, type Ctx } from '@radcore/lib-platform';
import { and, asc, eq, isNull, or, sum } from 'drizzle-orm';

/** A batch named on goods coming in: its number, and how many of the line's units are in it. */
export type BatchIn = { readonly batchNo: string; readonly qty: Quantity };
/** A batch named on goods going out or moving: the batch's id, or null for "batch unknown", and how many units. */
export type BatchOut = { readonly batchId: string | null; readonly qty: Quantity };

/** Goods coming into a location at a rate, split by batch. */
export type StockIn = { readonly itemId: string; readonly locationId: string; readonly sourceLineId?: string | null;
  readonly qty: Quantity; readonly rate: Rate; readonly batches: readonly BatchIn[] };
/** Goods going out of a location, split by the batches picked. */
export type StockOut = { readonly itemId: string; readonly locationId: string; readonly sourceLineId?: string | null;
  readonly qty: Quantity; readonly batches: readonly BatchOut[] };
/** Goods moving from one location to another, split by the batches picked; they arrive in the same batches. */
export type StockTransfer = { readonly itemId: string; readonly from: string; readonly to: string;
  readonly sourceLineId?: string | null; readonly qty: Quantity; readonly batches: readonly BatchOut[] };

/** One document's stock: the document it comes from, its business date, and its lines in the order they post. */
export type StockPosting = {
  readonly sourceTable: string;
  readonly sourceId: string;
  readonly businessDate: string;
  readonly ins?: readonly StockIn[];
  readonly outs?: readonly StockOut[];
  readonly transfers?: readonly StockTransfer[];
};

/** What one movement posted: the journal engine's Stock in Hand line for it comes from its item, location and value. */
export type PostedMovement = { readonly id: string; readonly itemId: string; readonly locationId: string;
  readonly direction: 'in' | 'out'; readonly qty: Quantity; readonly value: Money };

/** A batch number as the database keys it (`batch_key`): upper case, without spaces or hyphens (§4a). */
export const batchKey = (batchNo: string): string => batchNo.toUpperCase().replace(/[\s-]/g, '');

const key = (itemId: string, locationId: string) => `${itemId} ${locationId}`;
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The positions a posting touches, created if new, then locked in `(item_id, location_id)` order (§1). */
async function lockPositions(ctx: Ctx, pairs: readonly (readonly [string, string])[]): Promise<void> {
  const unique = [...new Map(pairs.map(([i, l]) => [key(i, l), [i, l] as const])).values()]
    .toSorted(([ai, al], [bi, bl]) => byText(ai, bi) || byText(al, bl));
  if (unique.length === 0) return;
  const tx = stockTx(ctx);
  await tx.insert(stockPositions).values(unique.map(([itemId, locationId]) => ({ itemId, locationId }))).onConflictDoNothing();
  await tx.select({ itemId: stockPositions.itemId }).from(stockPositions)
    .where(or(...unique.map(([i, l]) => and(eq(stockPositions.itemId, i), eq(stockPositions.locationId, l)))))
    .orderBy(asc(stockPositions.itemId), asc(stockPositions.locationId)).for('update');
}

/** The new batches a posting's goods-in name, created after the position locks in `(item_id, batch_key)` order
 * (§4a; every supplier is null until parties land), and every batch's id, by item and key. */
async function batchIds(ctx: Ctx, ins: readonly StockIn[]): Promise<Map<string, string>> {
  const wanted = [...new Map(ins.flatMap((l) => l.batches.map((b) => {
    const k = batchKey(b.batchNo);
    return [`${l.itemId} ${k}`, { itemId: l.itemId, batchNo: b.batchNo, batchKey: k }] as const;
  }))).values()].toSorted((a, b) => byText(a.itemId, b.itemId) || byText(a.batchKey, b.batchKey));
  const ids = new Map<string, string>();
  const tx = stockTx(ctx);
  // One at a time, in order, so two saves bringing the same new lots wait on their unique keys in the same order.
  for (const w of wanted) {
    await tx.insert(batches).values({ itemId: w.itemId, batchNo: w.batchNo }).onConflictDoNothing();
    const [row] = await tx.select({ id: batches.id }).from(batches)
      .where(and(eq(batches.itemId, w.itemId), isNull(batches.supplierId), eq(batches.batchKey, w.batchKey)));
    if (row === undefined) throw new Error(`batch ${w.batchKey} wasn't found after its insert`);
    ids.set(`${w.itemId} ${w.batchKey}`, row.id);
  }
  return ids;
}

/** An item's quantity and value at a location now: the sums of its movements, in posting order (§4). */
async function position(ctx: Ctx, itemId: string, locationId: string): Promise<{ qty: string; value: string }> {
  const rows = await stockTx(ctx).select({ direction: stockMovements.direction, qty: sum(stockMovements.qty),
    value: sum(stockMovements.value) }).from(stockMovements)
    .where(and(eq(stockMovements.itemId, itemId), eq(stockMovements.locationId, locationId)))
    .groupBy(stockMovements.direction);
  const of = (d: string) => rows.find((r) => r.direction === d);
  return {
    qty: dec(of('in')?.qty ?? '0').minus(dec(of('out')?.qty ?? '0')).toFixed(),
    value: dec(of('in')?.value ?? '0').minus(dec(of('out')?.value ?? '0')).plus(dec(of('revalue')?.value ?? '0')).toFixed(),
  };
}

/** An issue's value (§4): all of it when it empties the location, so an empty location holds no value; otherwise the
 * share round(V × q / Q, 2). Beyond what's on hand it's refused (negative stock comes in RAD-93's second PR). */
async function issueValue(ctx: Ctx, itemId: string, locationId: string, qty: Quantity): Promise<Money> {
  const on = await position(ctx, itemId, locationId);
  const [q, Q] = [dec(qty), dec(on.qty)];
  if (q.gt(Q)) {
    throw new AppError('not_enough_stock', 'There isn’t that much of this item here',
      [{ path: ['qty'], code: 'short', message: `Only ${Q.toFixed()} on hand` }]);
  }
  return q.eq(Q) ? roundMoney(on.value) : roundMoney(dec(on.value).times(q).div(Q));
}

/**
 * Posts a document's stock: its transfers, then its goods out, then its goods in, each in the order given, after
 * locking every position they touch. Answers each `in` and `out` movement it wrote, for the document's journal entry.
 * A line's batches must add up to its quantity, which the database also checks at commit (RAD-93's second PR).
 */
export async function postStock(ctx: Ctx, p: StockPosting): Promise<PostedMovement[]> {
  const ins = p.ins ?? [];
  const outs = p.outs ?? [];
  const transfers = p.transfers ?? [];
  for (const [n, line] of [...ins, ...outs, ...transfers].entries()) {
    if (!dec(line.qty).gt(0) || line.batches.some((b) => !dec(b.qty).gt(0))) {
      throw new AppError('qty_not_positive', 'A quantity must be more than zero',
        [{ path: ['lines', n, 'qty'], code: 'not_positive', message: 'Enter a quantity above zero' }]);
    }
    if ('from' in line && line.from === line.to) {
      throw new AppError('transfer_same_location', 'A transfer must go to another location',
        [{ path: ['lines', n, 'to'], code: 'same_location', message: 'Pick a different location' }]);
    }
    const named = line.batches.reduce((s, b) => s.plus(dec(b.qty)), dec('0'));
    if (!named.eq(dec(line.qty))) {
      throw new AppError('batches_mismatch', 'The batches don’t add up to the quantity',
        [{ path: ['lines', n, 'batches'], code: 'mismatch', message: `The batches hold ${named.toFixed()} of ${line.qty}` }]);
    }
  }
  await lockPositions(ctx, [...ins.map((l) => [l.itemId, l.locationId] as const), ...outs.map((l) => [l.itemId, l.locationId] as const),
    ...transfers.flatMap((t) => [[t.itemId, t.from] as const, [t.itemId, t.to] as const])]);
  const ids = await batchIds(ctx, ins);
  const tx = stockTx(ctx);
  const base = { sourceTable: p.sourceTable, sourceId: p.sourceId, businessDate: p.businessDate };
  const posted: PostedMovement[] = [];
  const write = async (m: { itemId: string; locationId: string; sourceLineId?: string | null | undefined; direction: 'in' | 'out';
    qty: Quantity; value: Money; rate?: Rate }, rows: readonly { batchId: string | null; qty: Quantity }[]) => {
    const [row] = await tx.insert(stockMovements).values({ ...base, itemId: m.itemId, locationId: m.locationId,
      sourceLineId: m.sourceLineId ?? null, direction: m.direction, qty: m.qty, value: m.value, rate: m.rate ?? null })
      .returning({ id: stockMovements.id });
    if (row === undefined) throw new Error('the movement insert returned no row');
    if (rows.length > 0) {
      await tx.insert(stockMovementBatches).values(rows.map((b) => ({ movementId: row.id, itemId: m.itemId, batchId: b.batchId, qty: b.qty })));
    }
    posted.push({ id: row.id, itemId: m.itemId, locationId: m.locationId, direction: m.direction, qty: m.qty, value: m.value });
  };
  for (const t of transfers) {
    const value = await issueValue(ctx, t.itemId, t.from, t.qty);
    await write({ itemId: t.itemId, locationId: t.from, sourceLineId: t.sourceLineId, direction: 'out', qty: t.qty, value }, t.batches);
    await write({ itemId: t.itemId, locationId: t.to, sourceLineId: t.sourceLineId, direction: 'in', qty: t.qty, value }, t.batches);
  }
  for (const o of outs) {
    const value = await issueValue(ctx, o.itemId, o.locationId, o.qty);
    await write({ itemId: o.itemId, locationId: o.locationId, sourceLineId: o.sourceLineId, direction: 'out', qty: o.qty, value }, o.batches);
  }
  for (const i of ins) {
    const rows = i.batches.map((b) => ({ batchId: ids.get(`${i.itemId} ${batchKey(b.batchNo)}`) ?? null, qty: b.qty }));
    await write({ itemId: i.itemId, locationId: i.locationId, sourceLineId: i.sourceLineId, direction: 'in', qty: i.qty,
      value: roundMoney(dec(i.qty).times(dec(i.rate))), rate: roundRate(i.rate) }, rows);
  }
  return posted;
}
