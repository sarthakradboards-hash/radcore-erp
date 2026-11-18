// The stock engine (ADR-006 §1, §4, §4a; M2-05, RAD-93). A document's service calls `postStock` inside its save's one
// transaction for the document's movements: goods in, goods out, and transfers between locations. It keeps:
// - one moving average per item and location, so rejected, job-work and demo stock, each in its own kind of location,
//   never enter the average of the stock that is sold (RC-205);
// - a business date on every movement (RC-025), and costs fixed at posting, in posting order (§4);
// - one lock order (RC-053, §1): the touched positions, created if new and locked `ORDER BY item_id, location_id FOR
//   UPDATE`, then any new batches, created in `(item_id, supplier_id, batch_key)` order, null supplier first. Never
//   the item row, whose lock would block every insert that references the item;
// - batches on every `in` and `out` (D-15, §4a): the person picking names them; the engine never chooses;
// - negative stock (RC-062) when the company allows it: only a delivery may go below zero, the part beyond what's on
//   hand at an estimate, and the receipt that follows revalues, so no value is left without units (F15).
// The database checks the batches and positions again at commit (RA007, `stock_commit_check`), whatever path wrote.
// shortcut: the Stock in Hand lines it hands the journal engine are RAD-93's third PR, after RAD-86 part 1.
import {
  batches, stockMovementBatches, stockMovements, stockPositions, stockTx,
} from '@radcore/db/stock';
import { dec, roundMoney, roundQty, roundRate, type Money, type Quantity, type Rate } from '@radcore/lib-common';
import { AppError, defineSetting, type Ctx } from '@radcore/lib-platform';
import { and, asc, desc, eq, isNull, or, sum } from 'drizzle-orm';
import { z } from 'zod';

/** Whether a delivery may take a location below zero (RC-062, ADR-006 §4). The database's commit check reads the same
 * key, so the two can't disagree. */
export const NEGATIVE_STOCK = defineSetting('stock.negative_stock', z.boolean(), false);

/** A batch named on goods coming in: its number, or null for "batch unknown" (a count bringing it back towards zero),
 * and how many of the line's units are in it. */
export type BatchIn = { readonly batchNo: string | null; readonly qty: Quantity };
/** A batch named on goods going out or moving: the batch's id, or null for "batch unknown", and how many units. */
export type BatchOut = { readonly batchId: string | null; readonly qty: Quantity };

/** Goods coming into a location at a rate, split by batch. */
export type StockIn = { readonly itemId: string; readonly locationId: string; readonly sourceLineId?: string | null;
  readonly qty: Quantity; readonly rate: Rate; readonly batches: readonly BatchIn[] };
/** Goods going out of a location, split by the batches picked. Only a delivery may go below zero, in negative-stock
 * mode, naming the part beyond what's on hand as "batch unknown". */
export type StockOut = { readonly itemId: string; readonly locationId: string; readonly sourceLineId?: string | null;
  readonly qty: Quantity; readonly batches: readonly BatchOut[]; readonly delivery?: boolean };
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

/** What one movement posted: the journal engine's Stock in Hand line for it comes from its item, location and value.
 * A `revalue` (a receipt into negative stock) carries a signed value and no quantity. */
export type PostedMovement = { readonly id: string; readonly itemId: string; readonly locationId: string;
  readonly direction: 'in' | 'out' | 'revalue'; readonly qty: Quantity; readonly value: Money };

/** A batch number as the database keys it (`batch_key`): upper case, without spaces or hyphens (§4a). */
export const batchKey = (batchNo: string): string => batchNo.toUpperCase().replace(/[\s-]/g, '');

const key = (itemId: string, locationId: string) => `${itemId} ${locationId}`;
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const NO_UNITS = roundQty('0', 0); // a revalue moves no units

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
  const wanted = [...new Map(ins.flatMap((l) => l.batches.flatMap((b) => {
    if (b.batchNo === null) return [];
    const k = batchKey(b.batchNo);
    return [[`${l.itemId} ${k}`, { itemId: l.itemId, batchNo: b.batchNo, batchKey: k }] as const];
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

/** An item's movements at a location, summed by business date and direction, oldest first. */
async function byDate(ctx: Ctx, itemId: string, locationId: string) {
  return stockTx(ctx).select({ date: stockMovements.businessDate, direction: stockMovements.direction,
    qty: sum(stockMovements.qty), value: sum(stockMovements.value) }).from(stockMovements)
    .where(and(eq(stockMovements.itemId, itemId), eq(stockMovements.locationId, locationId)))
    .groupBy(stockMovements.businessDate, stockMovements.direction).orderBy(asc(stockMovements.businessDate));
}
type DateRow = Awaited<ReturnType<typeof byDate>>[number];
const signedQty = (r: DateRow) => (r.direction === 'in' ? dec(r.qty ?? '0') : r.direction === 'out' ? dec(r.qty ?? '0').neg() : dec('0'));
const signedValue = (r: DateRow) => (r.direction === 'out' ? dec(r.value ?? '0').neg() : dec(r.value ?? '0'));

/** The position now: quantity and value, the sums of every movement, in posting order (§4). */
function position(rows: readonly DateRow[]) {
  return {
    qty: rows.reduce((s, r) => s.plus(signedQty(r)), dec('0')),
    value: rows.reduce((s, r) => s.plus(signedValue(r)), dec('0')),
  };
}

/** The lowest running quantity from `from` onward, in business-date order (§4): a back-dated issue may take no more,
 * so it can't make a later day negative. */
function lowestFrom(rows: readonly DateRow[], from: string) {
  const nets = new Map<string, ReturnType<typeof dec>>();
  for (const r of rows) nets.set(r.date, (nets.get(r.date) ?? dec('0')).plus(signedQty(r)));
  let run = dec('0');
  let low: ReturnType<typeof dec> | undefined;
  for (const [date, net] of nets) {
    if (date > from && low === undefined) low = run; // the level on `from` itself, with nothing dated that day
    run = run.plus(net);
    if (date >= from) low = low === undefined || run.lt(low) ? run : low;
  }
  return low ?? run;
}

/** The location's last `in` rate for the item: negative stock's estimate (§4). A transfer in carries no rate, so its
 * value over its quantity stands for one, and a location stocked only by transfers still has an estimate.
 * shortcut: the item's purchase price is the fallback once items carry one (purchasing, M4); until then, none. */
async function estimate(ctx: Ctx, itemId: string, locationId: string): Promise<string | undefined> {
  const [row] = await stockTx(ctx).select({ rate: stockMovements.rate, qty: stockMovements.qty, value: stockMovements.value })
    .from(stockMovements)
    .where(and(eq(stockMovements.itemId, itemId), eq(stockMovements.locationId, locationId), eq(stockMovements.direction, 'in')))
    .orderBy(desc(stockMovements.postedAt), desc(stockMovements.id)).limit(1);
  if (row === undefined) return undefined;
  return row.rate ?? dec(row.value).div(dec(row.qty)).toFixed();
}

/** An issue's value (§4): all of what's on hand when it empties the location, else round(V × q / Q, 2). A delivery in
 * negative-stock mode may go further: what's there at its value, the rest at the estimate. Any other issue is held to
 * the lowest running quantity from its date onward, so a back-dated one can't make a later day negative. */
async function issueValue(ctx: Ctx, itemId: string, locationId: string, qty: Quantity, date: string, negative: boolean): Promise<Money> {
  const rows = await byDate(ctx, itemId, locationId);
  const on = position(rows);
  const q = dec(qty);
  if (negative && q.gt(on.qty)) {
    const rate = await estimate(ctx, itemId, locationId);
    if (rate === undefined) {
      throw new AppError('no_estimate', 'There’s no rate to estimate the stock not yet received',
        [{ path: ['qty'], code: 'no_estimate', message: `Only ${on.qty.toFixed()} on hand, and no earlier receipt here` }]);
    }
    const held = on.qty.gt(0) ? on.qty : dec('0');
    return roundMoney((on.qty.gt(0) ? on.value : dec('0')).plus(q.minus(held).times(dec(rate))));
  }
  const low = negative ? on.qty : lowestFrom(rows, date); // a delivery that may go below zero needs no later day's cover
  if (q.gt(low)) {
    throw new AppError('not_enough_stock', 'There isn’t that much of this item here',
      [{ path: ['qty'], code: 'short', message: `Only ${low.toFixed()} on hand from ${date} on` }]);
  }
  return q.eq(on.qty) ? roundMoney(on.value) : roundMoney(on.value.times(q).div(on.qty));
}

/** A receipt into negative stock (§4, F15): the revaluation that leaves the units still missing at their estimate, or
 * the units now on hand at the receipt's rate. Zero when the location wasn't below zero. */
function revaluation(before: ReturnType<typeof position>, qty: Quantity, rate: Rate, value: Money): Money {
  if (!before.qty.lt(0)) return roundMoney('0');
  const after = before.qty.plus(dec(qty));
  const target = after.lte(0) ? roundMoney(before.value.times(after).div(before.qty)) : roundMoney(after.times(dec(rate)));
  return roundMoney(dec(target).minus(before.value.plus(dec(value))));
}

function checkLines(lines: readonly (StockIn | StockOut | StockTransfer)[]) {
  for (const [n, line] of lines.entries()) {
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
}

/**
 * Posts a document's stock: its transfers, then its goods out, then its goods in, each in the order given, after
 * locking every position they touch. Answers each movement it wrote, for the document's journal entry.
 */
export async function postStock(ctx: Ctx, p: StockPosting): Promise<PostedMovement[]> {
  const ins = p.ins ?? [];
  const outs = p.outs ?? [];
  const transfers = p.transfers ?? [];
  checkLines([...ins, ...outs, ...transfers]);
  const negativeMode = ctx.settings.get(NEGATIVE_STOCK);
  await lockPositions(ctx, [...ins.map((l) => [l.itemId, l.locationId] as const), ...outs.map((l) => [l.itemId, l.locationId] as const),
    ...transfers.flatMap((t) => [[t.itemId, t.from] as const, [t.itemId, t.to] as const])]);
  const ids = await batchIds(ctx, ins);
  const tx = stockTx(ctx);
  const base = { sourceTable: p.sourceTable, sourceId: p.sourceId, businessDate: p.businessDate };
  const posted: PostedMovement[] = [];
  const write = async (m: { itemId: string; locationId: string; sourceLineId?: string | null | undefined;
    direction: PostedMovement['direction']; qty: Quantity; value: Money; rate?: Rate },
  rows: readonly { batchId: string | null; qty: Quantity }[]) => {
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
    const value = await issueValue(ctx, t.itemId, t.from, t.qty, p.businessDate, false);
    await write({ itemId: t.itemId, locationId: t.from, sourceLineId: t.sourceLineId, direction: 'out', qty: t.qty, value }, t.batches);
    await write({ itemId: t.itemId, locationId: t.to, sourceLineId: t.sourceLineId, direction: 'in', qty: t.qty, value }, t.batches);
  }
  for (const o of outs) {
    const value = await issueValue(ctx, o.itemId, o.locationId, o.qty, p.businessDate, negativeMode && o.delivery === true);
    await write({ itemId: o.itemId, locationId: o.locationId, sourceLineId: o.sourceLineId, direction: 'out', qty: o.qty, value }, o.batches);
  }
  for (const i of ins) {
    const before = position(await byDate(ctx, i.itemId, i.locationId));
    const rows = i.batches.map((b) => ({ batchId: b.batchNo === null ? null : ids.get(`${i.itemId} ${batchKey(b.batchNo)}`) ?? null, qty: b.qty }));
    const value = roundMoney(dec(i.qty).times(dec(i.rate)));
    await write({ itemId: i.itemId, locationId: i.locationId, sourceLineId: i.sourceLineId, direction: 'in', qty: i.qty,
      value, rate: roundRate(i.rate) }, rows);
    const change = revaluation(before, i.qty, i.rate, value);
    if (!dec(change).isZero()) {
      await write({ itemId: i.itemId, locationId: i.locationId, sourceLineId: i.sourceLineId, direction: 'revalue', qty: NO_UNITS, value: change }, []);
    }
  }
  return posted;
}
