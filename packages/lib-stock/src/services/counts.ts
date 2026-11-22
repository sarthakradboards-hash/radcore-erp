// Stock counts (M4-06, RAD-141; ADR-008 §10, §12; ADR-006 §6, F14, F21): what was found at a location as at
// `counted_at`. Lines for one item and batch are summed into one (RC-123). Each line's book quantity is the movements
// posted up to that moment, so a sale after the counting is neither missed nor counted twice; the difference posts,
// and only once someone other than its counter approves (stock:approve). A count is its counter's (created_by).
import { after, batches, stockCountLines, stockCounts, stockMovementBatches, stockMovements, stockTx, units } from '@radcore/db/stock';
import { holdPeriod, lockPeriod, reverseEntriesOf } from '@radcore/lib-accounts';
import { dec, quantityString, roundQty } from '@radcore/lib-common';
import {
  AppError, awaitingApproval, decodeCursor, defineSeries, encodeCursor, listScope, momentKey, nextNumber, principalId, requestApproval,
  withdrawPending, type ApprovalSpec, type Ctx,
} from '@radcore/lib-platform';
import { and, asc, desc, eq, inArray, isNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import type {
  cancelStockCount, createStockCount, deleteStockCount, getStockCount, listStockCounts, requestStockCountApproval, updateStockCount,
} from '../contract.ts';
import { reverseStock } from '../engine/stock.ts';
import { serialKey } from '../engine/units.ts';
import { batchNumbers, itemLabels } from './items.ts';
import { checkLines, placeNames, placeOf } from './moves-lines.ts';
import { postDifferences } from './moves-post.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;
type Status = 'draft' | 'posted' | 'cancelled';
type CountIn = In<typeof createStockCount>;
type Line = { itemId: string; batchId: string | null; found: string; serials: string[] };

/** Stock counts' numbers (ADR-008 §3): SC/26-27/00001, drawn as one posts. */
export const COUNT_SERIES = defineSeries('stock.count', 'SC', { digits: 5, label: 'Stock counts' });
const PAGE_KEY = z.object({ date: z.iso.date(), at: momentKey(), id: z.uuid() });
const wrongStatus = (status: string, what: string) => new AppError('wrong_status', `This count is ${status}, so it can’t be ${what}`);
const keyOf = (itemId: string, batchId: string | null) => `${itemId} ${batchId ?? ''}`;

async function countOf(ctx: Ctx, id: string, permission: string, forUpdate = false) {
  const sel = stockTx(ctx).select().from(stockCounts).where(eq(stockCounts.id, id));
  const [row] = forUpdate ? await sel.for('update') : await sel;
  if (row === undefined) throw new AppError('not_found', 'There is no such count');
  ctx.see(permission, { owner: row.createdBy });
  return row;
}

/** Lines for the same item and batch, summed into one, their serials together (RC-123); a serial twice is refused. */
export function mergeLines(lines: CountIn['lines']): Line[] {
  const merged = new Map<string, Line>();
  for (const l of lines) {
    const k = keyOf(l.itemId, l.batchId);
    const was = merged.get(k);
    merged.set(k, { itemId: l.itemId, batchId: l.batchId, found: roundQty(dec(was?.found ?? '0').plus(dec(l.qty)), 3), serials: [...(was?.serials ?? []), ...l.serials] });
  }
  return [...merged.values()];
}

/** A count's place, moment, lines, batches and serials (§10). */
async function checkCount(ctx: Ctx, input: CountIn): Promise<Line[]> {
  await placeOf(ctx, input.locationId, 'locationId');
  if (new Date(input.countedAt) > new Date()) {
    throw new AppError('counted_in_future', 'A count is taken now or earlier', [{ path: ['countedAt'], code: 'in_future', message: 'Enter when it was counted' }]);
  }
  await checkLines(ctx, input.lines);
  const lines = mergeLines(input.lines);
  const batchIds = lines.flatMap((l) => (l.batchId === null ? [] : [l.batchId]));
  const known = new Map(batchIds.length === 0 ? [] : (await stockTx(ctx).select({ id: batches.id, itemId: batches.itemId }).from(batches)
    .where(inArray(batches.id, batchIds))).map((b) => [b.id, b.itemId]));
  for (const [n, l] of lines.entries()) {
    if (l.batchId !== null && known.get(l.batchId) !== l.itemId) {
      throw new AppError('unknown_batch', 'That batch isn’t this item’s', [{ path: ['lines', n, 'batchId'], code: 'unknown', message: 'Choose a batch of this item' }]);
    }
    const keys = l.serials.map(serialKey);
    if (new Set(keys).size !== keys.length) {
      throw new AppError('serial_twice', 'A serial is counted once', [{ path: ['lines', n, 'serials'], code: 'serial_twice', message: 'Remove the repeated serial' }]);
    }
    if (keys.length === 0) continue;
    const found = await stockTx(ctx).select({ key: units.serialKey, ownership: units.ownership, locationId: units.locationId }).from(units)
      .where(and(eq(units.itemId, l.itemId), inArray(units.serialKey, keys)));
    const byKey = new Map(found.map((u) => [u.key, u]));
    for (const [s, k] of keys.entries()) {
      const u = byKey.get(k);
      if (u === undefined || u.ownership !== 'ours') {
        throw new AppError('serial_unknown', 'The books don’t hold this serial: it comes in through its receipt, or an approved adjustment',
          [{ path: ['lines', n, 'serials', s], code: 'serial_unknown', message: `${l.serials[s] ?? ''} isn’t in stock` }]);
      }
      if (u.locationId !== input.locationId) {
        throw new AppError('serial_elsewhere', 'This serial is booked at another place: transfer it here instead',
          [{ path: ['lines', n, 'serials', s], code: 'serial_elsewhere', message: `${l.serials[s] ?? ''} is booked elsewhere` }]);
      }
    }
  }
  return lines;
}

/** Each line's book quantity at the location as at `countedAt`: the movements posted up to then, by item and batch. */
async function bookOf(ctx: Ctx, locationId: string, countedAt: string, lines: readonly Line[]): Promise<Map<string, string>> {
  if (lines.length === 0) return new Map();
  const rows = await stockTx(ctx).select({ itemId: stockMovementBatches.itemId, batchId: stockMovementBatches.batchId,
    direction: stockMovements.direction, qty: stockMovementBatches.qty })
    .from(stockMovementBatches).innerJoin(stockMovements, eq(stockMovements.id, stockMovementBatches.movementId))
    .where(and(eq(stockMovements.locationId, locationId), inArray(stockMovementBatches.itemId, [...new Set(lines.map((l) => l.itemId))]),
      lte(stockMovements.postedAt, new Date(countedAt))));
  const book = new Map<string, ReturnType<typeof dec>>();
  for (const r of rows) {
    const k = keyOf(r.itemId, r.batchId);
    book.set(k, (book.get(k) ?? dec('0')).plus(r.direction === 'in' ? dec(r.qty) : dec(r.qty).neg()));
  }
  return new Map([...book].map(([k, q]) => [k, roundQty(q, 3)]));
}

/** A count's lines with their book quantities and differences, worked out now (a draft) or as stored (posted). */
async function workedLines(ctx: Ctx, c: { id: string; locationId: string; countedAt: string; status: string }) {
  const rows = await stockTx(ctx).select().from(stockCountLines).where(eq(stockCountLines.countId, c.id)).orderBy(asc(stockCountLines.lineNo));
  const lines: Line[] = rows.map((r) => ({ itemId: r.itemId, batchId: r.batchId, found: r.found, serials: r.serials as string[] }));
  const book = c.status === 'draft' ? await bookOf(ctx, c.locationId, c.countedAt, lines) : new Map<string, string>();
  return rows.map((r, n) => {
    const b = r.book ?? book.get(keyOf(r.itemId, r.batchId)) ?? '0.000';
    return { row: r, line: lines[n] as Line, book: quantityString({ signed: true }).parse(roundQty(dec(b), 3)),
      difference: quantityString({ signed: true }).parse(r.difference ?? roundQty(dec(r.found).minus(dec(b)), 3)) };
  });
}

/** The count's lines, and for each item counted, every batch the books hold at the place as at `countedAt` that the
 * count doesn't list, found 0 (auditor-2 on #339): what isn't counted wasn't found, so a difference between batches
 * alone moves the quantity between them (F21) instead of booking stock twice. */
async function withUnlisted(ctx: Ctx, locationId: string, countedAt: string, lines: readonly Line[]): Promise<Line[]> {
  const listed = new Set(lines.map((l) => keyOf(l.itemId, l.batchId)));
  const extra: Line[] = [];
  for (const [k, qty] of await bookOf(ctx, locationId, countedAt, lines)) {
    if (listed.has(k) || dec(qty).isZero()) continue;
    const [itemId = '', batchId = ''] = k.split(' ');
    extra.push({ itemId, batchId: batchId === '' ? null : batchId, found: '0.000', serials: [] });
  }
  return [...lines, ...extra];
}

async function writeLines(ctx: Ctx, countId: string, lines: readonly Line[]): Promise<void> {
  await stockTx(ctx).insert(stockCountLines).values(lines.map((l, n) => ({ countId, lineNo: n + 1, itemId: l.itemId, batchId: l.batchId,
    found: l.found, serials: l.serials })));
}

/** POST /stock/counts (stock:count): a draft, its lines merged. */
export async function addCount(ctx: Ctx, input: In<typeof createStockCount>): Promise<Out<typeof createStockCount>> {
  const lines = await withUnlisted(ctx, input.locationId, input.countedAt, await checkCount(ctx, input));
  const [row] = await stockTx(ctx).insert(stockCounts).values({ locationId: input.locationId, countedAt: input.countedAt,
    businessDate: input.businessDate, reason: input.reason }).returning({ id: stockCounts.id });
  if (row === undefined) throw new Error('the insert returned no row');
  await writeLines(ctx, row.id, lines);
  return row;
}

/** PUT /stock/counts/:id (stock:count): a draft rewritten whole. */
export async function changeCount(ctx: Ctx, { id, ...input }: In<typeof updateStockCount>): Promise<Out<typeof updateStockCount>> {
  const now = await countOf(ctx, id, 'stock:count', true);
  if (now.status !== 'draft') throw wrongStatus(now.status, 'changed');
  const lines = await withUnlisted(ctx, input.locationId, input.countedAt, await checkCount(ctx, input));
  const tx = stockTx(ctx);
  await tx.delete(stockCountLines).where(eq(stockCountLines.countId, id));
  await tx.update(stockCounts).set({ locationId: input.locationId, countedAt: input.countedAt, businessDate: input.businessDate,
    reason: input.reason }).where(eq(stockCounts.id, id));
  await writeLines(ctx, id, lines);
  return {};
}

/** DELETE /stock/counts/:id (stock:count): a draft, its pending request closed with it (withdrawPending). */
export async function dropCount(ctx: Ctx, { id }: In<typeof deleteStockCount>): Promise<Out<typeof deleteStockCount>> {
  const now = await countOf(ctx, id, 'stock:count', true);
  if (now.status !== 'draft') throw wrongStatus(now.status, 'deleted');
  await withdrawPending(ctx, countApprovalSpec, id);
  await stockTx(ctx).delete(stockCounts).where(eq(stockCounts.id, id));
  return {};
}

/** Posts an approved count: each difference out or in (F14), between batches at no value (F21), its number last. */
async function postCount(ctx: Ctx, id: string): Promise<void> {
  const tx = stockTx(ctx);
  const [c] = await tx.select().from(stockCounts).where(eq(stockCounts.id, id)).for('update');
  if (c === undefined || !ctx.can('stock:approve', { owner: c.createdBy })) throw new AppError('not_found', 'There is no such count');
  if (c.status !== 'draft') throw wrongStatus(c.status, 'posted');
  await holdPeriod(ctx, c.businessDate);
  await placeOf(ctx, c.locationId, 'locationId');
  const worked = await workedLines(ctx, c);
  const outs = [];
  for (const w of worked.filter((x) => dec(x.difference).isNegative())) {
    const qty = roundQty(dec(w.difference).neg(), 3);
    // A serialised shortage names the units the books hold here in this line's batch that weren't found anywhere on the
    // count: written off, `scrapped` (auditor-2 on #339).
    const found = new Set(worked.filter((x) => x.row.itemId === w.row.itemId).flatMap((x) => x.line.serials.map(serialKey)));
    const held = (await tx.select({ serialNo: units.serialNo, key: units.serialKey }).from(units).where(and(eq(units.itemId, w.row.itemId),
      eq(units.locationId, c.locationId), eq(units.ownership, 'ours'), w.row.batchId === null ? isNull(units.batchId) : eq(units.batchId, w.row.batchId)))
      .orderBy(asc(units.id))).filter((u) => !found.has(u.key));
    const serials: string[] = [];
    for (const u of held) if (dec(String(serials.length)).lt(dec(qty))) serials.push(u.serialNo);
    outs.push({ lineId: w.row.id, itemId: w.row.itemId, qty, batches: [{ batchId: w.row.batchId, qty }], serials });
  }
  const ins = worked.filter((x) => dec(x.difference).isPositive()).map((w) => ({ lineId: w.row.id, itemId: w.row.itemId, qty: w.difference,
    batches: [{ batchId: w.row.batchId, qty: w.difference }], units: [] }));
  // A count's gains name no new units (a serial the books don't know is refused), so no batch is named after it.
  const { values, entryId } = await postDifferences(ctx, { sourceTable: 'stock_counts', sourceId: id, businessDate: c.businessDate,
    locationId: c.locationId, kind: 'stock_adjustment', outs, ins, batchNo: '' });
  for (const w of worked) {
    await tx.update(stockCountLines).set({ book: w.book, difference: w.difference, value: values.get(w.row.id) ?? '0.00' })
      .where(eq(stockCountLines.id, w.row.id));
  }
  // Its number last (ADR-006 §1).
  const number = await nextNumber(ctx, COUNT_SERIES, c.businessDate);
  await tx.update(stockCounts).set({ status: 'posted', number, postedEntryId: entryId }).where(eq(stockCounts.id, id));
}

/** What the approver approves: the count as found, with its book quantities and differences as at `counted_at`. */
type CountVersion = { locationId: string; countedAt: string; businessDate: string; reason: string;
  lines: { itemId: string; batchId: string | null; found: string; serials: string[]; book: string; difference: string }[] };

/** The count approval (RAD-38): someone other than the counter (stock:approve); approving posts it (lockFirst). */
export const countApprovalSpec: ApprovalSpec<CountVersion> = {
  kind: 'stock-count',
  table: 'stock_counts',
  parts: ['stock_count_lines'],
  async lockFirst(ctx) {
    await lockPeriod(ctx);
  },
  async version(ctx, id, { forUpdate }) {
    const sel = stockTx(ctx).select().from(stockCounts).where(eq(stockCounts.id, id));
    const [c] = forUpdate ? await sel.for('update') : await sel;
    if (c === undefined || (!ctx.can('stock:count', { owner: c.createdBy }) && !ctx.can('stock:approve', { owner: c.createdBy }))) return null;
    const worked = await workedLines(ctx, c);
    return { locationId: c.locationId, countedAt: c.countedAt, businessDate: c.businessDate, reason: c.reason,
      lines: worked.map((w) => ({ itemId: w.row.itemId, batchId: w.row.batchId, found: w.row.found, serials: w.line.serials, book: w.book,
        difference: w.difference })) };
  },
  async approved(ctx, id) {
    await postCount(ctx, id);
  },
  async rejected() {
    // A refused count stays a draft, for its counter to change or throw away.
  },
};

/** POST /stock/counts/:id/approval (stock:count): its serials judged again, then sent to someone else. */
export async function askCountApproval(ctx: Ctx, { id }: In<typeof requestStockCountApproval>): Promise<Out<typeof requestStockCountApproval>> {
  const c = await countOf(ctx, id, 'stock:count', true);
  if (c.status !== 'draft') throw wrongStatus(c.status, 'sent for approval');
  const rows = await stockTx(ctx).select().from(stockCountLines).where(eq(stockCountLines.countId, id)).orderBy(asc(stockCountLines.lineNo));
  await checkCount(ctx, { locationId: c.locationId, countedAt: c.countedAt, businessDate: c.businessDate, reason: c.reason,
    lines: rows.map((r) => ({ itemId: r.itemId, batchId: r.batchId, qty: quantityString().parse(r.found), serials: r.serials as string[] })) });
  return requestApproval(ctx, countApprovalSpec, id);
}

/** POST /stock/counts/:id/cancel (stock:approve): its mirror, dated `businessDate`. */
export async function cancelCountNow(ctx: Ctx, { id, businessDate, reason }: In<typeof cancelStockCount>): Promise<Out<typeof cancelStockCount>> {
  await holdPeriod(ctx, businessDate);
  const c = await countOf(ctx, id, 'stock:approve', true);
  if (c.status !== 'posted') throw wrongStatus(c.status, 'cancelled');
  if (businessDate < c.businessDate) {
    throw new AppError('date_before_source', 'A cancellation is dated on or after what it cancels',
      [{ path: ['businessDate'], code: 'date_before_source', message: `The count is dated ${c.businessDate}` }]);
  }
  await reverseStock(ctx, { sourceTable: 'stock_counts', sourceId: id, businessDate }).catch((e: unknown) => {
    if (e instanceof AppError && ['units_mismatch', 'unit_held', 'not_reversible'].includes(e.code)) {
      throw new AppError('goods_moved_on', 'Goods this count posted have moved on since, so it can’t be undone: adjust them instead');
    }
    throw e;
  });
  const [own] = c.postedEntryId === null ? [] : await reverseEntriesOf(ctx, { source: { table: 'stock_counts', id }, businessDate, reason });
  await stockTx(ctx).update(stockCounts).set({ status: 'cancelled', cancelledAt: new Date(), cancelledBy: principalId(ctx.principal),
    cancelReason: reason, cancelEntryId: own?.id ?? null }).where(eq(stockCounts.id, id));
  return {};
}

/** GET /stock/counts (stock:read): newest first, the principal's own at `own` scope. */
export async function listCountsPage(ctx: Ctx, input: In<typeof listStockCounts>): Promise<Out<typeof listStockCounts>> {
  const key = input.after === undefined ? undefined : decodeCursor(PAGE_KEY, input.after);
  const rows = await stockTx(ctx).select({ id: stockCounts.id, number: stockCounts.number, locationId: stockCounts.locationId,
    countedAt: stockCounts.countedAt, businessDate: stockCounts.businessDate, status: stockCounts.status, createdAt: stockCounts.createdAt })
    .from(stockCounts).where(and(
      input.filter.status === undefined ? undefined : eq(stockCounts.status, input.filter.status),
      input.filter.locationId === undefined ? undefined : eq(stockCounts.locationId, input.filter.locationId),
      listScope(ctx, 'stock:read', stockCounts.createdBy),
      after([stockCounts.businessDate, stockCounts.createdAt, stockCounts.id], key && [key.date, key.at, key.id], 'desc'),
    )).orderBy(desc(stockCounts.businessDate), desc(stockCounts.createdAt), desc(stockCounts.id)).limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const names = await placeNames(ctx, page.map((r) => r.locationId));
  const last = page.at(-1);
  return {
    items: page.map((r) => ({ ...r, countedAt: new Date(r.countedAt).toISOString(), status: r.status as Status, locationName: names.get(r.locationId) ?? '' })),
    next: rows.length > input.limit && last ? encodeCursor({ date: last.businessDate, at: last.createdAt, id: last.id }) : null,
  };
}

/** GET /stock/counts/:id (stock:read): its lines, their differences and where its approval stands. */
export async function getCountById(ctx: Ctx, { id }: In<typeof getStockCount>): Promise<Out<typeof getStockCount>> {
  const c = await countOf(ctx, id, 'stock:read');
  const worked = await workedLines(ctx, c);
  const [labels, names] = [await itemLabels(ctx, worked.map((w) => w.row.itemId)), await placeNames(ctx, [c.locationId])];
  const batchNos = await batchNumbers(ctx, worked.flatMap((w) => (w.row.batchId === null ? [] : [w.row.batchId])));
  const pending = c.status === 'draft' && (await awaitingApproval(ctx, countApprovalSpec, [id])).has(id);
  return { id: c.id, number: c.number, locationId: c.locationId, locationName: names.get(c.locationId) ?? '', countedAt: new Date(c.countedAt).toISOString(),
    businessDate: c.businessDate, status: c.status as Status, reason: c.reason, approval: c.status === 'draft' ? (pending ? 'pending' : 'none') : 'approved',
    lines: worked.map((w) => ({ id: w.row.id, lineNo: w.row.lineNo, itemId: w.row.itemId, sku: labels.get(w.row.itemId)?.sku ?? '',
      name: labels.get(w.row.itemId)?.name ?? '', batchId: w.row.batchId, batchNo: w.row.batchId === null ? null : batchNos.get(w.row.batchId) ?? null,
      found: quantityString().parse(w.row.found), book: w.book, difference: w.difference, serials: w.line.serials, value: w.row.value })) };
}
