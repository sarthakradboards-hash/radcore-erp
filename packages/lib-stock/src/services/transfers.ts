// Stock transfers (M4-06, RAD-141; ADR-008 §9, §12; ADR-006 §6, F13): goods from one location to another with a
// reason, posted at once through the engine, their entry one Stock in Hand line per location (ADR-006 §7). Into a
// franchisee's place while `stock.franchisee_transfer_approval` is on (Sarthak, default off), the transfer waits as a
// draft for someone else's approval (stock:approve), and approving posts it. Undone by its mirror (RC-124). A transfer
// is its maker's (created_by) for record scope.
import { after, stockTransferLines, stockTransfers, stockTx } from '@radcore/db/stock';
import { holdPeriod, lockPeriod, postEntry, reverseEntriesOf, type JournalLine } from '@radcore/lib-accounts';
import { dec, quantityString, roundMoney } from '@radcore/lib-common';
import {
  AppError, awaitingApproval, decodeCursor, defineSeries, defineSetting, encodeCursor, listScope, momentKey, nextNumber,
  principalId, requestApproval, withdrawPending, type ApprovalSpec, type Ctx,
} from '@radcore/lib-platform';
import { and, asc, desc, eq, or } from 'drizzle-orm';
import { z } from 'zod';
import type {
  cancelStockTransfer, createStockTransfer, deleteStockTransfer, getStockTransfer, listStockTransfers, requestStockTransferApproval,
} from '../contract.ts';
import { postStock, reverseStock, type PostedMovement } from '../engine/stock.ts';
import { batchNumbers, itemLabels } from './items.ts';
import { checkLines, placeNames, placeOf, picksOf, type Place } from './moves-lines.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;
type Status = 'draft' | 'posted' | 'cancelled';

/** Stock transfers' numbers (ADR-008 §3): ST/26-27/00001, drawn as one posts. */
export const TRANSFER_SERIES = defineSeries('stock.transfer', 'ST', { digits: 5, label: 'Stock transfers' });
/** Whether a transfer into a franchisee's place waits for someone else's approval (Sarthak, 22 Nov: "Setting, default no"). */
export const FRANCHISEE_TRANSFER_APPROVAL = defineSetting('stock.franchisee_transfer_approval', z.boolean(), false, {
  label: 'Approve transfers to franchisees',
  description: 'Whether a stock transfer into a franchisee’s store waits for someone else’s approval before it posts.',
  input: { kind: 'yes_no' },
});

const header = { id: stockTransfers.id, number: stockTransfers.number, fromId: stockTransfers.fromId, toId: stockTransfers.toId,
  businessDate: stockTransfers.businessDate, status: stockTransfers.status, reason: stockTransfers.reason, createdAt: stockTransfers.createdAt };
const PAGE_KEY = z.object({ date: z.iso.date(), at: momentKey(), id: z.uuid() });
const wrongStatus = (status: string, what: string) => new AppError('wrong_status', `This transfer is ${status}, so it can’t be ${what}`);

/** The transfer, locked when it's to be written, within the principal's scope for `permission` (else not_found). */
async function transferOf(ctx: Ctx, id: string, permission: string, forUpdate = false) {
  const sel = stockTx(ctx).select().from(stockTransfers).where(eq(stockTransfers.id, id));
  const [row] = forUpdate ? await sel.for('update') : await sel;
  if (row === undefined) throw new AppError('not_found', 'There is no such transfer');
  ctx.see(permission, { owner: row.createdBy });
  return row;
}

/**
 * Where a transfer may go (§9): never to the same place, never to or from a job work place (its own documents, §11),
 * and out of `rejected` only to another `rejected` place (the architect on RAD-141): through demo or in transit, rejects
 * would reach a selling shelf in two hops. Rejects leave only by a supplier return, M4-02's re-inspection under inward:qc,
 * or an approved write-off.
 */
function checkRoute(from: Place, to: Place): void {
  if (from.id === to.id) {
    throw new AppError('transfer_same_location', 'A transfer must go to another location', [{ path: ['toId'], code: 'same_location', message: 'Pick a different location' }]);
  }
  if (from.kind === 'job_work' || to.kind === 'job_work') {
    throw new AppError('use_job_work', 'Goods go to and from a job worker on a job work challan and receipt',
      [{ path: [from.kind === 'job_work' ? 'fromId' : 'toId'], code: 'use_job_work', message: 'Use job work for this place' }]);
  }
  if (from.kind === 'rejected' && to.kind !== 'rejected') {
    throw new AppError('needs_qc', 'Rejected stock goes back to selling only after it’s inspected again',
      [{ path: ['toId'], code: 'needs_qc', message: 'Rejects go only to another rejects place' }]);
  }
}

/** Posts a draft transfer: its stock, its entry, its lines' values and its number, last (ADR-008 §12). */
async function postTransfer(ctx: Ctx, id: string): Promise<string> {
  const tx = stockTx(ctx);
  const [t] = await tx.select().from(stockTransfers).where(eq(stockTransfers.id, id)).for('update');
  // Its maker posting it at once (stock:move), or its approver approving it (stock:approve), within scope.
  if (t === undefined || (!ctx.can('stock:move', { owner: t.createdBy }) && !ctx.can('stock:approve', { owner: t.createdBy }))) {
    throw new AppError('not_found', 'There is no such transfer');
  }
  if (t.status !== 'draft') throw wrongStatus(t.status, 'posted');
  const [from, to] = [await placeOf(ctx, t.fromId, 'fromId'), await placeOf(ctx, t.toId, 'toId')];
  checkRoute(from, to);
  const lines = await tx.select().from(stockTransferLines).where(eq(stockTransferLines.transferId, id)).orderBy(asc(stockTransferLines.lineNo));
  // Into `demo`, serialised units take condition `demo` (F13); out of it they keep it.
  const moved = await postStock(ctx, { sourceTable: 'stock_transfers', sourceId: id, businessDate: t.businessDate,
    transfers: lines.map((l) => {
      const picks = picksOf<string>(l.picks);
      return { itemId: l.itemId, from: t.fromId, to: t.toId, sourceLineId: l.id, qty: quantityString().parse(l.qty), batches: picks.batches.map((b) =>
        ({ batchId: b.batchId, qty: quantityString().parse(b.qty) })), units: picks.serials.map((serialNo) => (to.kind === 'demo' ? { serialNo, condition: 'demo' as const } : { serialNo })) };
    }) });
  // Each line moves out of `from`, then into `to`, in the lines' order (the engine's).
  const outs = moved.filter((m) => m.direction === 'out');
  for (const [n, l] of lines.entries()) await tx.update(stockTransferLines).set({ value: outs[n]?.value ?? roundMoney('0') }).where(eq(stockTransferLines.id, l.id));
  const entry = await entryOf(ctx, id, t.businessDate, moved);
  const number = await nextNumber(ctx, TRANSFER_SERIES, t.businessDate);
  await tx.update(stockTransfers).set({ status: 'posted', number, postedEntryId: entry }).where(eq(stockTransfers.id, id));
  return number;
}

/** The entry (ADR-006 §6, F13): Dr Stock in Hand at `to`, Cr at `from`, by item, or none when nothing moved has value. */
async function entryOf(ctx: Ctx, id: string, businessDate: string, moved: readonly PostedMovement[]): Promise<string | null> {
  const lines: JournalLine[] = moved.filter((m) => dec(m.value).gt(0)).map((m) => ({ account: { system: 'stock' }, itemId: m.itemId,
    locationId: m.locationId, ...(m.direction === 'in' ? { debit: m.value } : { credit: m.value }) }));
  if (lines.length === 0) return null;
  return (await postEntry(ctx, { kind: 'stock_transfer', businessDate, source: { table: 'stock_transfers', id }, lines })).id;
}

/** What the approver approves (§9): the transfer as drafted. */
type TransferVersion = { fromId: string; toId: string; businessDate: string; reason: string;
  lines: { itemId: string; qty: string; picks: { batches: { batchId: string | null; qty: string }[]; serials: string[] } }[] };

/** The franchisee transfer's approval (RAD-38): its maker asks (stock:move), someone else approves (stock:approve), and
 * approving posts it, so the period's locks come first (lockFirst, ADR-006 §1). */
export const transferApprovalSpec: ApprovalSpec<TransferVersion> = {
  kind: 'stock-transfer',
  table: 'stock_transfers',
  parts: ['stock_transfer_lines'],
  async lockFirst(ctx) {
    await lockPeriod(ctx);
  },
  async version(ctx, id, { forUpdate }) {
    const sel = stockTx(ctx).select().from(stockTransfers).where(eq(stockTransfers.id, id));
    const [t] = forUpdate ? await sel.for('update') : await sel;
    if (t === undefined || (!ctx.can('stock:move', { owner: t.createdBy }) && !ctx.can('stock:approve', { owner: t.createdBy }))) return null;
    const lines = await stockTx(ctx).select().from(stockTransferLines).where(eq(stockTransferLines.transferId, id)).orderBy(asc(stockTransferLines.lineNo));
    return { fromId: t.fromId, toId: t.toId, businessDate: t.businessDate, reason: t.reason,
      lines: lines.map((l) => ({ itemId: l.itemId, qty: quantityString().parse(l.qty), picks: picksOf<string>(l.picks) })) };
  },
  async approved(ctx, id) {
    await postTransfer(ctx, id);
  },
  async rejected() {
    // A refused transfer stays a draft, for its maker to throw away or send again.
  },
};

/** POST /stock/transfers (stock:move): posted at once, or kept and sent for approval into a franchisee's place. */
export async function addTransfer(ctx: Ctx, input: In<typeof createStockTransfer>): Promise<Out<typeof createStockTransfer>> {
  // ADR-006 §1's step 1 first: the company profile and period lock, then the transfer, the positions, the numbers.
  await holdPeriod(ctx, input.businessDate);
  const [from, to] = [await placeOf(ctx, input.fromId, 'fromId'), await placeOf(ctx, input.toId, 'toId')];
  checkRoute(from, to);
  await checkLines(ctx, input.lines);
  const tx = stockTx(ctx);
  const [row] = await tx.insert(stockTransfers).values({ fromId: input.fromId, toId: input.toId, businessDate: input.businessDate,
    reason: input.reason }).returning({ id: stockTransfers.id });
  if (row === undefined) throw new Error('the insert returned no row');
  await tx.insert(stockTransferLines).values(input.lines.map((l, n) => ({ transferId: row.id, lineNo: n + 1, itemId: l.itemId, qty: l.qty,
    picks: { batches: l.batches, serials: l.serials } })));
  if (to.kind === 'franchisee' && ctx.settings.get(FRANCHISEE_TRANSFER_APPROVAL)) {
    return { id: row.id, number: null, approval: await requestApproval(ctx, transferApprovalSpec, row.id) };
  }
  return { id: row.id, number: await postTransfer(ctx, row.id), approval: null };
}

/** POST /stock/transfers/:id/approval (stock:move): a waiting transfer sent again, after a refusal. */
export async function askTransferApproval(ctx: Ctx, { id }: In<typeof requestStockTransferApproval>): Promise<Out<typeof requestStockTransferApproval>> {
  const t = await transferOf(ctx, id, 'stock:move', true);
  if (t.status !== 'draft') throw wrongStatus(t.status, 'sent for approval');
  return requestApproval(ctx, transferApprovalSpec, id);
}

/** DELETE /stock/transfers/:id (stock:move): a waiting draft, with its pending request closed (withdrawPending). */
export async function dropTransfer(ctx: Ctx, { id }: In<typeof deleteStockTransfer>): Promise<Out<typeof deleteStockTransfer>> {
  const t = await transferOf(ctx, id, 'stock:move', true);
  if (t.status !== 'draft') throw wrongStatus(t.status, 'deleted');
  await withdrawPending(ctx, transferApprovalSpec, id);
  await stockTx(ctx).delete(stockTransfers).where(eq(stockTransfers.id, id));
  return {};
}

/** POST /stock/transfers/:id/cancel (stock:move): its mirror, dated `businessDate` (RC-124). Refused once the goods
 * have left where it put them, or a unit on it has moved since (`goods_moved_on`). */
export async function cancelTransferNow(ctx: Ctx, { id, businessDate, reason }: In<typeof cancelStockTransfer>): Promise<Out<typeof cancelStockTransfer>> {
  await holdPeriod(ctx, businessDate);
  const t = await transferOf(ctx, id, 'stock:move', true);
  if (t.status !== 'posted') throw wrongStatus(t.status, 'cancelled');
  if (businessDate < t.businessDate) {
    throw new AppError('date_before_source', 'A cancellation is dated on or after what it cancels',
      [{ path: ['businessDate'], code: 'date_before_source', message: `The transfer is dated ${t.businessDate}` }]);
  }
  await reverseStock(ctx, { sourceTable: 'stock_transfers', sourceId: id, businessDate }).catch((e: unknown) => {
    if (e instanceof AppError && ['not_enough_stock', 'units_mismatch', 'unit_held', 'not_reversible'].includes(e.code)) {
      throw new AppError('goods_moved_on', 'The goods have moved on since this transfer, so it can’t be undone: transfer them back instead');
    }
    throw e;
  });
  const [own] = t.postedEntryId === null ? [] : await reverseEntriesOf(ctx, { source: { table: 'stock_transfers', id }, businessDate, reason });
  await stockTx(ctx).update(stockTransfers).set({ status: 'cancelled', cancelledAt: new Date(), cancelledBy: principalId(ctx.principal),
    cancelReason: reason, cancelEntryId: own?.id ?? null }).where(eq(stockTransfers.id, id));
  return {};
}

/** GET /stock/transfers (stock:read): newest first, a page at a time, the principal's own at `own` scope. */
export async function listTransfersPage(ctx: Ctx, input: In<typeof listStockTransfers>): Promise<Out<typeof listStockTransfers>> {
  const key = input.after === undefined ? undefined : decodeCursor(PAGE_KEY, input.after);
  const f = input.filter;
  const rows = await stockTx(ctx).select(header).from(stockTransfers).where(and(
    f.status === undefined ? undefined : eq(stockTransfers.status, f.status),
    // A place's transfers, out of it or into it (auditor-2 on #339).
    f.locationId === undefined ? undefined : or(eq(stockTransfers.fromId, f.locationId), eq(stockTransfers.toId, f.locationId)),
    listScope(ctx, 'stock:read', stockTransfers.createdBy),
    after([stockTransfers.businessDate, stockTransfers.createdAt, stockTransfers.id], key && [key.date, key.at, key.id], 'desc'),
  )).orderBy(desc(stockTransfers.businessDate), desc(stockTransfers.createdAt), desc(stockTransfers.id)).limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const names = await placeNames(ctx, page.flatMap((r) => [r.fromId, r.toId]));
  const last = page.at(-1);
  return {
    items: page.map((r) => ({ ...r, status: r.status as Status, fromName: names.get(r.fromId) ?? '', toName: names.get(r.toId) ?? '' })),
    next: rows.length > input.limit && last ? encodeCursor({ date: last.businessDate, at: last.createdAt, id: last.id }) : null,
  };
}

/** GET /stock/transfers/:id (stock:read): with its lines, their values once posted, and where its approval stands. */
export async function getTransferById(ctx: Ctx, { id }: In<typeof getStockTransfer>): Promise<Out<typeof getStockTransfer>> {
  const t = await transferOf(ctx, id, 'stock:read');
  const lines = await stockTx(ctx).select().from(stockTransferLines).where(eq(stockTransferLines.transferId, id)).orderBy(asc(stockTransferLines.lineNo));
  const [labels, names, pending] = [await itemLabels(ctx, lines.map((l) => l.itemId)), await placeNames(ctx, [t.fromId, t.toId]),
    t.status === 'draft' && (await awaitingApproval(ctx, transferApprovalSpec, [id])).has(id)];
  const batchNos = await batchNumbers(ctx, lines.flatMap((l) => picksOf<string>(l.picks).batches.flatMap((b) => (b.batchId === null ? [] : [b.batchId]))));
  return { id: t.id, number: t.number, fromId: t.fromId, fromName: names.get(t.fromId) ?? '', toId: t.toId, toName: names.get(t.toId) ?? '',
    businessDate: t.businessDate, status: t.status as Status, reason: t.reason,
    approval: t.status !== 'draft' ? 'none' : pending ? 'pending' : 'none',
    lines: lines.map((l) => {
      const picks = picksOf<string>(l.picks);
      return { id: l.id, lineNo: l.lineNo, itemId: l.itemId, sku: labels.get(l.itemId)?.sku ?? '', name: labels.get(l.itemId)?.name ?? '',
        qty: quantityString().parse(l.qty), serials: picks.serials, value: l.value,
        batches: picks.batches.map((b) => ({ batchId: b.batchId, batchNo: b.batchId === null ? null : batchNos.get(b.batchId) ?? null, qty: b.qty })) };
    }) };
}

