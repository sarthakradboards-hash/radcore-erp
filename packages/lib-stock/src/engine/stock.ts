// The stock engine (ADR-006 §1, §4, §4a; M2-05, RAD-93). A document's service calls `postStock` inside its save's one
// transaction for the document's movements: goods in, goods out, and transfers between locations. It keeps:
// - one moving average per item and location, so rejected, job-work and demo stock, each in its own kind of location,
//   never enter the average of the stock that is sold (RC-205);
// - a business date on every movement (RC-025), and costs fixed at posting, in posting order (§4);
// - one lock order (RC-053, §1): the period lock FOR SHARE (lib-accounts' holdPeriod), then the touched positions,
//   created if new and locked `ORDER BY item_id, location_id FOR UPDATE`, then any new batches, created in
//   `(item_id, supplier_id, batch_key)` order, null supplier first. Never the item row, whose lock would block every
//   insert that references the item;
// - batches on every `in` and `out` (D-15, §4a): the person picking names them; the engine never chooses;
// - negative stock (RC-062) when the company allows it: only a delivery may go below zero, the part beyond what's on
//   hand at an estimate, and the receipt that follows revalues, so no value is left without units (F15).
// The database checks the batches and positions again at commit (RA007, `stock_commit_check`), whatever path wrote.
// The document posts its own entry from the movements answered here; the engine posts only the revaluations it makes,
// as the document's one `revaluation` entry (§1, F15).
import {
  batches, stockMovementBatches, stockMovements, stockPositions, stockTx, unitEvents,
} from '@radcore/db/stock';
import { holdPeriod, postEntry, type JournalLine } from '@radcore/lib-accounts';
import { dec, roundMoney, roundQty, roundRate, type Money, type Quantity, type Rate } from '@radcore/lib-common';
import { AppError, defineSetting, type Ctx } from '@radcore/lib-platform';
import {
  checkUnits, lockUnits, oneCondition, refuseDamaged, serialisedItems, serialKey, writeUnitEvents, type InUnitEvent, type MoveUnitEvent, type OutUnitEvent,
  type UnitEventRow, type UnitOnLine,
} from './units.ts';
import { and, asc, desc, eq, inArray, isNull, or, sum } from 'drizzle-orm';
import { averageIssue, estimatedIssue, lowestFrom, position, revaluation } from './valuation.ts';
import { z } from 'zod';

/** Whether a delivery may take a location below zero (RC-062, ADR-006 §4). The database's commit check reads the same
 * key, so the two can't disagree. */
export const NEGATIVE_STOCK = defineSetting('stock.negative_stock', z.boolean(), false, {
  label: 'Allow negative stock',
  description: 'Whether a delivery may take a location’s stock below zero.',
  input: { kind: 'yes_no' },
});

/** A batch named on goods coming in: its number, or null for "batch unknown" (a count bringing it back towards zero),
 * and how many of the line's units are in it. */
export type BatchIn = { readonly batchNo: string | null; readonly qty: Quantity };
/** A batch named on goods going out or moving: the batch's id, or null for "batch unknown", and how many units. */
export type BatchOut = { readonly batchId: string | null; readonly qty: Quantity };

/** Goods coming into a location at a rate, split by batch: named by number on a receipt, or by id for goods coming
 * back to the batches they left with (§4a). Goods coming back (a delivery return, a credit note) carry the `value` they
 * went out at, which the movement takes instead of qty × rate (RC-207). A serialised item's line names its units (§5):
 * `received` by default, or `returned` (a credit note) or `delivery_returned`. */
export type StockIn = { readonly itemId: string; readonly locationId: string; readonly sourceLineId?: string | null;
  readonly qty: Quantity; readonly rate: Rate; readonly value?: Money; readonly batches: readonly (BatchIn | BatchOut)[];
  readonly units?: readonly UnitOnLine[]; readonly unitEvent?: InUnitEvent };
/** Goods going out of a location, split by the batches picked. Only a delivery may go below zero, in negative-stock
 * mode, naming the part beyond what's on hand as "batch unknown". A serialised item's line names its units: `delivered`
 * by default (on its line, `sourceLineId`, and to the order line it may be promised to), `returned_to_supplier` or
 * `scrapped`. */
export type StockOut = { readonly itemId: string; readonly locationId: string; readonly sourceLineId?: string | null;
  readonly qty: Quantity; readonly batches: readonly BatchOut[]; readonly delivery?: boolean;
  readonly units?: readonly UnitOnLine[]; readonly unitEvent?: OutUnitEvent; readonly orderLineId?: string };
/** Goods moving from one location to another, split by the batches picked; they arrive in the same batches. A
 * serialised item's line names its units: `moved` by default, or `sent_to_job_work` and `received_from_job_work`. */
export type StockTransfer = { readonly itemId: string; readonly from: string; readonly to: string;
  readonly sourceLineId?: string | null; readonly qty: Quantity; readonly batches: readonly BatchOut[];
  readonly units?: readonly UnitOnLine[]; readonly unitEvent?: MoveUnitEvent };

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
    if (!('batchNo' in b) || b.batchNo === null) return [];
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
 * the lowest running quantity from its date onward, so a back-dated one can't make a later day negative. The arithmetic
 * is valuation.ts's; this reads the position and, only when it's needed, the estimate. */
async function issueValue(ctx: Ctx, itemId: string, locationId: string, qty: Quantity, date: string, negative: boolean): Promise<Money> {
  const rows = await byDate(ctx, itemId, locationId);
  const on = position(rows);
  if (negative && dec(qty).gt(on.qty)) return estimatedIssue(on, qty, await estimate(ctx, itemId, locationId));
  return averageIssue(on, qty, negative ? on.qty : lowestFrom(rows, date), date); // a delivery that may go below zero needs no later day's cover
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
  checkUnits([...ins, ...outs, ...transfers], await serialisedItems(ctx, [...ins, ...outs, ...transfers].map((l) => l.itemId)));
  // §1's step 1, before the positions: the period lock FOR SHARE, and the date's year open and unlocked.
  await holdPeriod(ctx, p.businessDate);
  const negativeMode = ctx.settings.get(NEGATIVE_STOCK);
  await lockPositions(ctx, [...ins.map((l) => [l.itemId, l.locationId] as const), ...outs.map((l) => [l.itemId, l.locationId] as const),
    ...transfers.flatMap((t) => [[t.itemId, t.from] as const, [t.itemId, t.to] as const])]);
  const ids = await batchIds(ctx, ins);
  // §1's step 4: the units the lines name, after the positions and batches.
  await lockUnits(ctx, [...ins, ...outs, ...transfers].flatMap((l) => (l.units ?? []).map((u) => ({ itemId: l.itemId, serialNo: u.serialNo }))));
  // A delivery never names a damaged unit (unit_damaged): a return to the supplier may.
  const delivered = outs.filter((o) => (o.unitEvent ?? 'delivered') === 'delivered');
  await refuseDamaged(ctx, delivered.flatMap((o) => (o.units ?? []).map((u) => ({ itemId: o.itemId, serialNo: u.serialNo }))));
  // Each delivery line's units are of one condition, which their `delivered` events record (the architect on RAD-112).
  const conditions = await oneCondition(ctx, delivered);
  const events: UnitEventRow[] = [];
  const lastId = () => posted.at(-1)?.id ?? '';
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
    const outMovementId = lastId();
    await write({ itemId: t.itemId, locationId: t.to, sourceLineId: t.sourceLineId, direction: 'in', qty: t.qty, value }, t.batches);
    for (const u of t.units ?? []) {
      events.push({ itemId: t.itemId, serialNo: u.serialNo, kind: t.unitEvent ?? 'moved', outMovementId, inMovementId: lastId(),
        ...(u.condition === undefined ? {} : { condition: u.condition }) });
    }
  }
  for (const o of outs) {
    const value = await issueValue(ctx, o.itemId, o.locationId, o.qty, p.businessDate, negativeMode && o.delivery === true);
    await write({ itemId: o.itemId, locationId: o.locationId, sourceLineId: o.sourceLineId, direction: 'out', qty: o.qty, value }, o.batches);
    for (const u of o.units ?? []) {
      const condition = conditions.get(`${o.itemId}:${serialKey(u.serialNo)}`);
      events.push({ itemId: o.itemId, serialNo: u.serialNo, kind: o.unitEvent ?? 'delivered', outMovementId: lastId(),
        ...(o.sourceLineId == null ? {} : { saleLineId: o.sourceLineId }), ...(o.orderLineId === undefined ? {} : { promisedTo: o.orderLineId }),
        ...(condition === undefined ? {} : { condition }) });
    }
  }
  for (const i of ins) {
    const before = position(await byDate(ctx, i.itemId, i.locationId));
    const rows = i.batches.map((b) => ({ qty: b.qty,
      batchId: 'batchId' in b ? b.batchId : b.batchNo === null ? null : ids.get(`${i.itemId} ${batchKey(b.batchNo)}`) ?? null }));
    const value = i.value ?? roundMoney(dec(i.qty).times(dec(i.rate)));
    await write({ itemId: i.itemId, locationId: i.locationId, sourceLineId: i.sourceLineId, direction: 'in', qty: i.qty,
      value, rate: roundRate(i.rate) }, rows);
    for (const u of i.units ?? []) events.push(unitIn(i, u, lastId(), rows));
    const change = revaluation(before, i.qty, i.rate, value);
    if (!dec(change).isZero()) {
      await write({ itemId: i.itemId, locationId: i.locationId, sourceLineId: i.sourceLineId, direction: 'revalue', qty: NO_UNITS, value: change }, []);
    }
  }
  await writeUnitEvents(ctx, base, events);
  const revalued = posted.filter((m) => m.direction === 'revalue');
  if (revalued.length > 0) {
    await postEntry(ctx, { kind: 'revaluation', businessDate: p.businessDate, source: { table: p.sourceTable, id: p.sourceId },
      lines: revalued.flatMap(revaluationLines) });
  }
  return posted;
}

// A unit coming in (§5): `received` names the batch it came in, one of its line's (the only one, unless it says which)
// with its chassis number and QC condition; a unit coming back keeps the batch it first came in.
function unitIn(line: StockIn, u: UnitOnLine, inMovementId: string, rows: readonly { batchId: string | null }[]): UnitEventRow {
  const kind = line.unitEvent ?? 'received';
  const event: UnitEventRow = { itemId: line.itemId, serialNo: u.serialNo, kind, inMovementId,
    ...(u.condition === undefined ? {} : { condition: u.condition }), ...(u.chassisNo == null ? {} : { chassisNo: u.chassisNo }) };
  if (kind !== 'received') return event;
  const named = u.batchNo;
  const at = named === undefined ? (line.batches.length === 1 ? 0 : -1)
    : line.batches.findIndex((b) => 'batchNo' in b
      && (b.batchNo === null || named === null ? b.batchNo === named : batchKey(b.batchNo) === batchKey(named)));
  if (at < 0) {
    throw new AppError('unit_batch', 'Say which of the line’s batches each unit came in',
      [{ path: ['units'], code: 'batch', message: `${u.serialNo}: name one of the line’s batches` }]);
  }
  return { ...event, batchId: rows[at]?.batchId ?? null };
}

// A revaluation down is Dr Cost of Goods Sold, Cr Stock in Hand; up, the other way round (ADR-006 §4, F15).
function revaluationLines(m: PostedMovement): JournalLine[] {
  const amount = roundMoney(dec(m.value).abs());
  const stock = { account: { system: 'stock' }, itemId: m.itemId, locationId: m.locationId };
  const cogs = { account: { system: 'cogs' } };
  return dec(m.value).isNegative() ? [{ ...cogs, debit: amount }, { ...stock, credit: amount }]
    : [{ ...stock, debit: amount }, { ...cogs, credit: amount }];
}

// The unit event that undoes one on a movement being mirrored (§5): goods that went out come back, and goods that came
// back go out again, on the sale they were on. Any other kind isn't cancelled by a document's mirror.
const UNDO: Readonly<Record<string, 'delivered' | 'delivery_returned'>> = {
  delivered: 'delivery_returned', delivery_returned: 'delivered', returned: 'delivered',
};

/**
 * A document's cancellation (ADR-006 §4, §6; RC-207): the mirror of each of its movements, dated `businessDate`, at the
 * same value and in the same batches, each naming the movement it undoes (`reverses_movement_id`, unique, so once);
 * every unit that moved on them moves back. Goods taken out again must be on hand: only a delivery may go below zero
 * (`not_enough_stock`). The document's entries are reversed by its own service (lib-accounts), the revaluation the
 * engine posted included, so the books and stock still agree for the document (RA007).
 */
export async function reverseStock(ctx: Ctx, p: { sourceTable: string; sourceId: string; businessDate: string }): Promise<PostedMovement[]> {
  await holdPeriod(ctx, p.businessDate);
  const tx = stockTx(ctx);
  const originals = await tx.select().from(stockMovements)
    .where(and(eq(stockMovements.sourceTable, p.sourceTable), eq(stockMovements.sourceId, p.sourceId), isNull(stockMovements.reversesMovementId)))
    .orderBy(asc(stockMovements.postedAt), asc(stockMovements.id));
  if (originals.length === 0) return [];
  const ids = originals.map((m) => m.id);
  const [done] = await tx.select({ id: stockMovements.id }).from(stockMovements).where(inArray(stockMovements.reversesMovementId, ids)).limit(1);
  if (done !== undefined) throw new AppError('already_reversed', 'This document’s stock is already cancelled');
  await lockPositions(ctx, originals.map((m) => [m.itemId, m.locationId] as const));
  const events = await tx.select({ itemId: unitEvents.itemId, serialNo: unitEvents.serialNo, kind: unitEvents.kind,
    outMovementId: unitEvents.outMovementId, inMovementId: unitEvents.inMovementId }).from(unitEvents)
    .where(or(inArray(unitEvents.outMovementId, ids), inArray(unitEvents.inMovementId, ids)));
  await lockUnits(ctx, events);
  const rows = await tx.select({ movementId: stockMovementBatches.movementId, batchId: stockMovementBatches.batchId, qty: stockMovementBatches.qty })
    .from(stockMovementBatches).where(inArray(stockMovementBatches.movementId, ids));
  const base = { sourceTable: p.sourceTable, sourceId: p.sourceId, businessDate: p.businessDate };
  const mirrors = new Map<string, string>();
  const posted: PostedMovement[] = [];
  for (const m of originals) {
    const direction = m.direction === 'in' ? 'out' : m.direction === 'out' ? 'in' : 'revalue';
    const qty = roundQty(m.qty, 3);
    // Taken out again: what's there now must cover it, as for any issue but a delivery (§4).
    if (direction === 'out' && position(await byDate(ctx, m.itemId, m.locationId)).qty.lt(dec(qty))) {
      throw new AppError('not_enough_stock', 'The goods have gone since, so this can’t be cancelled');
    }
    const value = roundMoney(m.direction === 'revalue' ? dec(m.value).negated() : m.value);
    const [row] = await tx.insert(stockMovements).values({ ...base, itemId: m.itemId, locationId: m.locationId, sourceLineId: m.sourceLineId,
      direction, qty, value, rate: direction === 'in' ? roundRate(dec(value).div(dec(qty))) : null, reversesMovementId: m.id })
      .returning({ id: stockMovements.id });
    if (row === undefined) throw new Error('the mirror insert returned no row');
    const batchRows = rows.filter((b) => b.movementId === m.id);
    if (batchRows.length > 0) {
      await tx.insert(stockMovementBatches).values(batchRows.map((b) => ({ movementId: row.id, itemId: m.itemId, batchId: b.batchId, qty: b.qty })));
    }
    mirrors.set(m.id, row.id);
    posted.push({ id: row.id, itemId: m.itemId, locationId: m.locationId, direction, qty, value });
  }
  const undone: UnitEventRow[] = [];
  for (const e of events) {
    const kind = UNDO[e.kind];
    if (kind === undefined) throw new AppError('not_reversible', `A unit’s ${e.kind} isn’t undone by cancelling this document`);
    const mirror = mirrors.get(e.outMovementId ?? e.inMovementId ?? '') ?? '';
    undone.push(kind === 'delivery_returned' ? { itemId: e.itemId, serialNo: e.serialNo, kind, inMovementId: mirror }
      : { itemId: e.itemId, serialNo: e.serialNo, kind, outMovementId: mirror, saleLineId: await lastSaleLine(ctx, e.itemId, e.serialNo) });
  }
  await writeUnitEvents(ctx, base, undone);
  return posted;
}

// The sale a unit was last delivered on: where goods that came back go out again.
async function lastSaleLine(ctx: Ctx, itemId: string, serialNo: string): Promise<string> {
  const [row] = await stockTx(ctx).select({ saleLineId: unitEvents.saleLineId }).from(unitEvents)
    .where(and(eq(unitEvents.itemId, itemId), eq(unitEvents.serialNo, serialNo), eq(unitEvents.kind, 'delivered')))
    .orderBy(desc(unitEvents.postedAt)).limit(1);
  if (row?.saleLineId == null) throw new AppError('not_reversible', `Unit ${serialNo} was never delivered on a sale`);
  return row.saleLineId;
}
