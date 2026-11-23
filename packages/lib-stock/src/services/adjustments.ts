// Stock adjustments (M4-06, RAD-141; ADR-008 §10, §12; ADR-006 §6, F14): a one-off in or out at a location with a
// reason, goods damaged, lost or found. Nothing changes until someone else approves (stock:approve), and approving posts
// it. A found serialised unit names its serial, its condition and, where the item keeps one, its chassis number, and is
// `received` with the adjustment's number as its batch. An adjustment is its maker's (created_by).
import { after, batches, items, stockAdjustmentLines, stockAdjustments, stockTx, units } from '@radcore/db/stock';
import { holdPeriod, JOURNAL_SERIES, lockPeriod, reverseEntriesOf } from '@radcore/lib-accounts';
import { dec, quantityString, type UnitCondition } from '@radcore/lib-common';
import {
  AppError, awaitingApproval, decodeCursor, defineSeries, encodeCursor, holdSeries, listScope, momentKey, nextNumber, principalId, requestApproval,
  withdrawPending, type ApprovalSpec, type Ctx,
} from '@radcore/lib-platform';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type {
  cancelStockAdjustment, createStockAdjustment, deleteStockAdjustment, getStockAdjustment, listStockAdjustments,
  requestStockAdjustmentApproval, updateStockAdjustment,
} from '../contract.ts';
import { holdStock, reverseStock } from '../engine/stock.ts';
import { serialKey } from '../engine/units.ts';
import { batchNumbers, itemLabels } from './items.ts';
import { checkLines, picksOf, placeNames, placeOf } from './moves-lines.ts';
import { postDifferences } from './moves-post.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;
type Status = 'draft' | 'posted' | 'cancelled';
type AdjustmentIn = In<typeof createStockAdjustment>;
type Serial = { serialNo: string; chassisNo: string | null };

/** Stock adjustments' numbers (ADR-008 §3): SA/26-27/00001. */
export const ADJUSTMENT_SERIES = defineSeries('stock.adjustment', 'SA', { digits: 5, label: 'Stock adjustments' });
const PAGE_KEY = z.object({ date: z.iso.date(), at: momentKey(), id: z.uuid() });
const wrongStatus = (status: string, what: string) => new AppError('wrong_status', `This adjustment is ${status}, so it can’t be ${what}`);
const refuse = (code: string, message: string, path: (string | number)[]) => new AppError(code, message, [{ path, code, message }]);

async function adjustmentOf(ctx: Ctx, id: string, permission: string, forUpdate = false) {
  const sel = stockTx(ctx).select().from(stockAdjustments).where(eq(stockAdjustments.id, id));
  const [row] = forUpdate ? await sel.for('update') : await sel;
  if (row === undefined) throw new AppError('not_found', 'There is no such adjustment');
  ctx.see(permission, { owner: row.createdBy });
  return row;
}

/** An adjustment's place and lines (§10): batches of the line's item, a found unit's chassis number only where its
 * item keeps one (and always then), none on goods going out, and a found serial the books don't already hold. */
async function checkAdjustment(ctx: Ctx, input: Pick<AdjustmentIn, 'locationId' | 'lines'>): Promise<void> {
  await placeOf(ctx, input.locationId, 'locationId');
  await checkLines(ctx, input.lines);
  const itemIds = [...new Set(input.lines.map((l) => l.itemId))];
  const flags = new Map((await stockTx(ctx).select({ id: items.id, serialised: items.serialised, hasChassis: items.hasChassis }).from(items)
    .where(inArray(items.id, itemIds))).map((i) => [i.id, i]));
  const batchIds = input.lines.flatMap((l) => l.batches.flatMap((b) => (b.batchId === null ? [] : [b.batchId])));
  const known = new Map(batchIds.length === 0 ? [] : (await stockTx(ctx).select({ id: batches.id, itemId: batches.itemId }).from(batches)
    .where(inArray(batches.id, batchIds))).map((b) => [b.id, b.itemId]));
  for (const [n, l] of input.lines.entries()) {
    for (const [b, batch] of l.batches.entries()) {
      if (batch.batchId !== null && known.get(batch.batchId) !== l.itemId) throw refuse('unknown_batch', 'That batch isn’t this item’s', ['lines', n, 'batches', b, 'batchId']);
    }
    if (l.direction === 'in' && l.serials.length === 0 && l.batches.some((b) => b.batchId === null)) {
      throw refuse('unknown_batch', 'Goods found come in to their batch, not as batch unknown', ['lines', n, 'batches']);
    }
    const item = flags.get(l.itemId);
    if (l.serials.length > 0 && item?.serialised !== true) throw refuse('not_serialised', 'This item has no serials', ['lines', n, 'serials']);
    // A serialised line names a serial for each unit, and a found one the condition it's in, from the draft on (auditor-2
    // on #339), not only as it posts.
    if (item?.serialised === true && !dec(String(l.serials.length)).eq(dec(l.qty))) {
      throw refuse('serials_mismatch', 'Name a serial for each unit', ['lines', n, 'serials']);
    }
    if (item?.serialised === true && l.direction === 'in' && l.condition === null) {
      throw refuse('condition_required', 'Say what condition the found units are in', ['lines', n, 'condition']);
    }
    const keys = l.serials.map((s) => serialKey(s.serialNo));
    if (new Set(keys).size !== keys.length) throw refuse('serial_twice', 'A serial is named once', ['lines', n, 'serials']);
    for (const [s, serial] of l.serials.entries()) {
      if (serial.chassisNo !== null && (l.direction === 'out' || item?.hasChassis !== true)) {
        throw refuse('chassis_not_allowed', 'A chassis number goes only on a found unit of an item that keeps one', ['lines', n, 'serials', s, 'chassisNo']);
      }
      if (serial.chassisNo === null && l.direction === 'in' && item?.hasChassis === true) {
        throw refuse('chassis_required', 'This item keeps a chassis number: enter the found unit’s', ['lines', n, 'serials', s, 'chassisNo']);
      }
    }
    if (l.direction === 'in' && keys.length > 0) {
      const held = await stockTx(ctx).select({ key: units.serialKey }).from(units)
        .where(and(eq(units.itemId, l.itemId), inArray(units.serialKey, keys), eq(units.ownership, 'ours')));
      if (held.length > 0) throw refuse('serial_elsewhere', 'The books already hold this serial: move it, don’t find it', ['lines', n, 'serials']);
    }
  }
}

async function writeLines(ctx: Ctx, adjustmentId: string, lines: AdjustmentIn['lines']): Promise<void> {
  await stockTx(ctx).insert(stockAdjustmentLines).values(lines.map((l, n) => ({ adjustmentId, lineNo: n + 1, direction: l.direction, itemId: l.itemId,
    qty: l.qty, picks: { batches: l.batches, serials: l.serials }, condition: l.direction === 'in' ? l.condition : null })));
}

/** POST /stock/adjustments (stock:count): a draft. */
export async function addAdjustment(ctx: Ctx, input: In<typeof createStockAdjustment>): Promise<Out<typeof createStockAdjustment>> {
  await checkAdjustment(ctx, input);
  const [row] = await stockTx(ctx).insert(stockAdjustments).values({ locationId: input.locationId, businessDate: input.businessDate,
    reason: input.reason }).returning({ id: stockAdjustments.id });
  if (row === undefined) throw new Error('the insert returned no row');
  await writeLines(ctx, row.id, input.lines);
  return row;
}

/** PUT /stock/adjustments/:id (stock:count): a draft rewritten whole. */
export async function changeAdjustment(ctx: Ctx, { id, ...input }: In<typeof updateStockAdjustment>): Promise<Out<typeof updateStockAdjustment>> {
  const now = await adjustmentOf(ctx, id, 'stock:count', true);
  if (now.status !== 'draft') throw wrongStatus(now.status, 'changed');
  await checkAdjustment(ctx, input);
  const tx = stockTx(ctx);
  await tx.delete(stockAdjustmentLines).where(eq(stockAdjustmentLines.adjustmentId, id));
  await tx.update(stockAdjustments).set({ locationId: input.locationId, businessDate: input.businessDate, reason: input.reason }).where(eq(stockAdjustments.id, id));
  await writeLines(ctx, id, input.lines);
  return {};
}

/** DELETE /stock/adjustments/:id (stock:count): a draft, its pending request closed with it (withdrawPending). */
export async function dropAdjustment(ctx: Ctx, { id }: In<typeof deleteStockAdjustment>): Promise<Out<typeof deleteStockAdjustment>> {
  const now = await adjustmentOf(ctx, id, 'stock:count', true);
  if (now.status !== 'draft') throw wrongStatus(now.status, 'deleted');
  await withdrawPending(ctx, adjustmentApprovalSpec, id);
  await stockTx(ctx).delete(stockAdjustments).where(eq(stockAdjustments.id, id));
  return {};
}

/** The drafted lines, as approval shows them and posting reads them. */
async function linesOf(ctx: Ctx, id: string) {
  const rows = await stockTx(ctx).select().from(stockAdjustmentLines).where(eq(stockAdjustmentLines.adjustmentId, id)).orderBy(asc(stockAdjustmentLines.lineNo));
  return rows.map((r) => {
    const picks = picksOf<Serial>(r.picks);
    return { row: r, line: { itemId: r.itemId, direction: r.direction as 'in' | 'out', qty: quantityString().parse(r.qty),
      condition: (r.condition ?? null) as UnitCondition | null, serials: picks.serials,
      batches: picks.batches.map((b) => ({ batchId: b.batchId, qty: quantityString().parse(b.qty) })) } };
  });
}

/** Posts an approved adjustment (F14), its lines judged again (the item's chassis flag may have changed). A found
 * serialised unit takes the adjustment's number as its batch (§10), so it's drawn as a batch-naming document draws its
 * own (the architect on RAD-141): its stock first, then the JV and SA turns, then the number, then the posting. Nothing
 * else draws SA. */
async function postAdjustment(ctx: Ctx, id: string): Promise<void> {
  const tx = stockTx(ctx);
  const [a] = await tx.select().from(stockAdjustments).where(eq(stockAdjustments.id, id)).for('update');
  if (a === undefined || !ctx.can('stock:approve', { owner: a.createdBy })) throw new AppError('not_found', 'There is no such adjustment');
  if (a.status !== 'draft') throw wrongStatus(a.status, 'posted');
  await holdPeriod(ctx, a.businessDate);
  const lines = await linesOf(ctx, id);
  await checkAdjustment(ctx, { locationId: a.locationId, lines: lines.map((l) => l.line) });
  // ADR-006 §1 for a document whose number names a batch (the architect on RAD-141): its stock, then the journal's and its
  // own series' turns, then its number, which names the batch postDifferences creates before it posts.
  await holdStock(ctx, lines.map((l) => ({ itemId: l.line.itemId, locationId: a.locationId, serials: l.line.serials.map((s) => s.serialNo) })));
  await holdSeries(ctx, [JOURNAL_SERIES, ADJUSTMENT_SERIES]);
  const number = await nextNumber(ctx, ADJUSTMENT_SERIES, a.businessDate);
  const { values, entryId } = await postDifferences(ctx, { sourceTable: 'stock_adjustments', sourceId: id, businessDate: a.businessDate,
    locationId: a.locationId, kind: 'stock_adjustment', batchNo: number,
    outs: lines.filter((l) => l.line.direction === 'out').map((l) => ({ lineId: l.row.id, itemId: l.line.itemId, qty: l.line.qty,
      batches: l.line.batches, serials: l.line.serials.map((s) => s.serialNo) })),
    ins: lines.filter((l) => l.line.direction === 'in').map((l) => ({ lineId: l.row.id, itemId: l.line.itemId, qty: l.line.qty,
      batches: l.line.batches, units: l.line.serials.map((s) => ({ serialNo: s.serialNo, chassisNo: s.chassisNo, condition: l.line.condition })) })) });
  for (const l of lines) await tx.update(stockAdjustmentLines).set({ value: values.get(l.row.id) ?? '0.00' }).where(eq(stockAdjustmentLines.id, l.row.id));
  await tx.update(stockAdjustments).set({ status: 'posted', number, postedEntryId: entryId }).where(eq(stockAdjustments.id, id));
}

type AdjustmentVersion = { locationId: string; businessDate: string; reason: string;
  lines: { itemId: string; direction: string; qty: string; condition: string | null; batches: { batchId: string | null; qty: string }[]; serials: Serial[] }[] };

/** The adjustment approval (RAD-38): someone else (stock:approve) approves what was drafted; approving posts it. */
export const adjustmentApprovalSpec: ApprovalSpec<AdjustmentVersion> = {
  kind: 'stock-adjustment',
  table: 'stock_adjustments',
  parts: ['stock_adjustment_lines'],
  async lockFirst(ctx) {
    await lockPeriod(ctx);
  },
  async version(ctx, id, { forUpdate }) {
    const sel = stockTx(ctx).select().from(stockAdjustments).where(eq(stockAdjustments.id, id));
    const [a] = forUpdate ? await sel.for('update') : await sel;
    if (a === undefined || (!ctx.can('stock:count', { owner: a.createdBy }) && !ctx.can('stock:approve', { owner: a.createdBy }))) return null;
    return { locationId: a.locationId, businessDate: a.businessDate, reason: a.reason, lines: (await linesOf(ctx, id)).map((l) => l.line) };
  },
  async approved(ctx, id) {
    await postAdjustment(ctx, id);
  },
  async rejected() {
    // A refused adjustment stays a draft, for its maker to change or throw away.
  },
};

/** POST /stock/adjustments/:id/approval (stock:count): sent to someone else; nothing posts until then. */
export async function askAdjustmentApproval(ctx: Ctx, { id }: In<typeof requestStockAdjustmentApproval>): Promise<Out<typeof requestStockAdjustmentApproval>> {
  const a = await adjustmentOf(ctx, id, 'stock:count', true);
  if (a.status !== 'draft') throw wrongStatus(a.status, 'sent for approval');
  return requestApproval(ctx, adjustmentApprovalSpec, id);
}

/** POST /stock/adjustments/:id/cancel (stock:approve): its mirror, dated `businessDate`. */
export async function cancelAdjustmentNow(ctx: Ctx, { id, businessDate, reason }: In<typeof cancelStockAdjustment>): Promise<Out<typeof cancelStockAdjustment>> {
  await holdPeriod(ctx, businessDate);
  const a = await adjustmentOf(ctx, id, 'stock:approve', true);
  if (a.status !== 'posted') throw wrongStatus(a.status, 'cancelled');
  if (businessDate < a.businessDate) throw refuse('date_before_source', `The adjustment is dated ${a.businessDate}`, ['businessDate']);
  await reverseStock(ctx, { sourceTable: 'stock_adjustments', sourceId: id, businessDate }).catch((e: unknown) => {
    if (e instanceof AppError && ['units_mismatch', 'unit_held', 'not_reversible'].includes(e.code)) {
      throw new AppError('goods_moved_on', 'Goods this adjustment posted have moved on since, so it can’t be undone: adjust them instead');
    }
    throw e;
  });
  const [own] = a.postedEntryId === null ? [] : await reverseEntriesOf(ctx, { source: { table: 'stock_adjustments', id }, businessDate, reason });
  await stockTx(ctx).update(stockAdjustments).set({ status: 'cancelled', cancelledAt: new Date(), cancelledBy: principalId(ctx.principal),
    cancelReason: reason, cancelEntryId: own?.id ?? null }).where(eq(stockAdjustments.id, id));
  return {};
}

/** GET /stock/adjustments (stock:read): newest first, the principal's own at `own` scope. */
export async function listAdjustmentsPage(ctx: Ctx, input: In<typeof listStockAdjustments>): Promise<Out<typeof listStockAdjustments>> {
  const key = input.after === undefined ? undefined : decodeCursor(PAGE_KEY, input.after);
  const rows = await stockTx(ctx).select({ id: stockAdjustments.id, number: stockAdjustments.number, locationId: stockAdjustments.locationId,
    businessDate: stockAdjustments.businessDate, status: stockAdjustments.status, createdAt: stockAdjustments.createdAt }).from(stockAdjustments).where(and(
    input.filter.status === undefined ? undefined : eq(stockAdjustments.status, input.filter.status),
    input.filter.locationId === undefined ? undefined : eq(stockAdjustments.locationId, input.filter.locationId),
    listScope(ctx, 'stock:read', stockAdjustments.createdBy),
    after([stockAdjustments.businessDate, stockAdjustments.createdAt, stockAdjustments.id], key && [key.date, key.at, key.id], 'desc'),
  )).orderBy(desc(stockAdjustments.businessDate), desc(stockAdjustments.createdAt), desc(stockAdjustments.id)).limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const names = await placeNames(ctx, page.map((r) => r.locationId));
  const last = page.at(-1);
  return {
    items: page.map((r) => ({ ...r, status: r.status as Status, locationName: names.get(r.locationId) ?? '' })),
    next: rows.length > input.limit && last ? encodeCursor({ date: last.businessDate, at: last.createdAt, id: last.id }) : null,
  };
}

/** GET /stock/adjustments/:id (stock:read): its lines, their values once posted, and where its approval stands. */
export async function getAdjustmentById(ctx: Ctx, { id }: In<typeof getStockAdjustment>): Promise<Out<typeof getStockAdjustment>> {
  const a = await adjustmentOf(ctx, id, 'stock:read');
  const lines = await linesOf(ctx, id);
  const [labels, names] = [await itemLabels(ctx, lines.map((l) => l.line.itemId)), await placeNames(ctx, [a.locationId])];
  const batchNos = await batchNumbers(ctx, lines.flatMap((l) => l.line.batches.flatMap((b) => (b.batchId === null ? [] : [b.batchId]))));
  const pending = a.status === 'draft' && (await awaitingApproval(ctx, adjustmentApprovalSpec, [id])).has(id);
  return { id: a.id, number: a.number, locationId: a.locationId, locationName: names.get(a.locationId) ?? '', businessDate: a.businessDate,
    status: a.status as Status, reason: a.reason, approval: a.status === 'draft' ? (pending ? 'pending' : 'none') : 'approved',
    lines: lines.map((l) => ({ id: l.row.id, lineNo: l.row.lineNo, itemId: l.line.itemId, sku: labels.get(l.line.itemId)?.sku ?? '',
      name: labels.get(l.line.itemId)?.name ?? '', direction: l.line.direction, qty: l.line.qty, condition: l.line.condition, serials: l.line.serials,
      value: l.row.value, batches: l.line.batches.map((b) => ({ batchId: b.batchId, batchNo: b.batchId === null ? null : batchNos.get(b.batchId) ?? null, qty: b.qty })) })) };
}
