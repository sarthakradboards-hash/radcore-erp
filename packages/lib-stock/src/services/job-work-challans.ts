// Job work challans (M4-07, RAD-142; ADR-008 §11, §12; ADR-006 §6, F16): inputs sent from a place of ours to the job
// worker's own place (kind `job_work`, found by its party), posted at once through the engine, serialised inputs going
// `sent_to_job_work`. Its entry moves Stock in Hand from our place to the job worker's, item by item (F16). Undone by
// its mirror while no receipt answers it. A challan is its maker's (created_by) for record scope.
import { after, jobWorkChallanLines, jobWorkChallans, jobWorkChallanStates, locations, stockTx } from '@radcore/db/stock';
import { getPartyById, holdPeriod, partyNames, postEntry, reverseEntriesOf, type JournalLine } from '@radcore/lib-accounts';
import { addDays, dec, indiaDate, quantityString, roundMoney, roundQty } from '@radcore/lib-common';
import {
  AppError, decodeCursor, defineSeries, defineSetting, encodeCursor, listScope, momentKey, nextNumber, principalId, type Ctx,
} from '@radcore/lib-platform';
import { and, asc, desc, eq, lte } from 'drizzle-orm';
import { z } from 'zod';
import type { cancelJobWorkChallan, createJobWorkChallan, getJobWorkChallan, listJobWorkChallans } from '../contract.ts';
import { postStock, reverseStock, type PostedMovement } from '../engine/stock.ts';
import { batchNumbers, itemLabels } from './items.ts';
import { accountedFor, answered } from './job-work-accounted.ts';
import { checkLines, placeNames, placeOf, picksOf } from './moves-lines.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;
type Status = 'posted' | 'cancelled';

/** Job work challans' numbers (ADR-008 §3): JWC/26-27/00001, drawn as one posts. */
export const JOB_WORK_CHALLAN_SERIES = defineSeries('stock.job_work_challan', 'JWC', { digits: 5, label: 'Job work challans' });
/** Section 143: inputs not back within this many days are a deemed supply (ADR-008 §11); the list flags them. */
export const JOB_WORK_RETURN_DAYS = defineSetting('stock.job_work_return_days', z.number().int().min(1).max(3650), 365, {
  label: 'Job work return days',
  description: 'Inputs sent for job work and not back within this many days are flagged on the job work list (section 143).',
  input: { kind: 'integer' },
});

const SOURCE = 'job_work_challans';
const PAGE_KEY = z.object({ date: z.iso.date(), at: momentKey(), id: z.uuid() });
const wrongStatus = (status: string, what: string) => new AppError('wrong_status', `This challan is ${status}, so it can’t be ${what}`);

/**
 * The posted challan with whether it's closed, both locked when it's to be written, within the principal's scope for
 * `permission` (else not_found). A draft lives only inside the save that posts it, and has no state yet.
 */
export async function challanOf(ctx: Ctx, id: string, permission: string, forUpdate = false) {
  const sel = stockTx(ctx).select({ challan: jobWorkChallans, closed: jobWorkChallanStates.closed }).from(jobWorkChallans)
    .innerJoin(jobWorkChallanStates, eq(jobWorkChallanStates.challanId, jobWorkChallans.id)).where(eq(jobWorkChallans.id, id));
  const [row] = forUpdate ? await sel.for('update') : await sel;
  if (row === undefined) throw new AppError('not_found', 'There is no such challan');
  ctx.see(permission, { owner: row.challan.createdBy });
  return { ...row.challan, closed: row.closed };
}

/** The job worker's own place: refused when the party doesn't exist (`unknown_party`) or has none (`no_job_work_place`). */
async function jobWorkerPlace(ctx: Ctx, partyId: string): Promise<string> {
  await getPartyById(ctx, { id: partyId }).catch((e: unknown) => {
    if (e instanceof AppError && e.code === 'not_found') {
      throw new AppError('unknown_party', 'There is no such party', [{ path: ['partyId'], code: 'unknown_party', message: 'Choose the job worker' }]);
    }
    throw e;
  });
  const [place] = await stockTx(ctx).select({ id: locations.id }).from(locations).where(eq(locations.partyId, partyId)).limit(1);
  if (place === undefined) {
    throw new AppError('no_job_work_place', 'This party has no job work place yet: add one for them first',
      [{ path: ['partyId'], code: 'no_job_work_place', message: 'Add the job worker’s place' }]);
  }
  return place.id;
}

/**
 * The entry (F16): Dr Stock in Hand at the job worker's place, Cr at ours, by item; none when nothing has value. A move
 * into negative stock also revalues, which the engine posts as its own entry (ADR-006 §4), so only ins and outs count.
 */
async function entryOf(ctx: Ctx, id: string, businessDate: string, moved: readonly PostedMovement[]): Promise<string | null> {
  const lines: JournalLine[] = moved.filter((m) => m.direction !== 'revalue' && dec(m.value).gt(0)).map((m) => ({ account: { system: 'stock' }, itemId: m.itemId,
    locationId: m.locationId, ...(m.direction === 'in' ? { debit: m.value } : { credit: m.value }) }));
  if (lines.length === 0) return null;
  return (await postEntry(ctx, { kind: 'job_work', businessDate, source: { table: SOURCE, id }, lines })).id;
}

/**
 * POST /stock/job-work/challans (job_work:write): posted at once (F16). Not from a job worker's place (`use_job_work`)
 * nor from rejects (`needs_qc`: a reject is re-inspected or returned to its supplier first, the architect on RAD-141).
 */
export async function addChallan(ctx: Ctx, input: In<typeof createJobWorkChallan>): Promise<Out<typeof createJobWorkChallan>> {
  // ADR-006 §1's step 1 first: the company profile and period lock; then the challan, the positions, the numbers.
  await holdPeriod(ctx, input.businessDate);
  const from = await placeOf(ctx, input.fromId, 'fromId');
  if (from.kind === 'job_work') {
    throw new AppError('use_job_work', 'Goods leave a job worker on a job work receipt',
      [{ path: ['fromId'], code: 'use_job_work', message: 'Send from a place of ours' }]);
  }
  if (from.kind === 'rejected') {
    throw new AppError('needs_qc', 'A reject is inspected again, or returned to its supplier, before it’s sent for job work',
      [{ path: ['fromId'], code: 'needs_qc', message: 'Send from a place that isn’t rejects' }]);
  }
  const toId = await jobWorkerPlace(ctx, input.partyId);
  await placeOf(ctx, toId, 'partyId');
  await checkLines(ctx, input.lines);
  const tx = stockTx(ctx);
  const [row] = await tx.insert(jobWorkChallans).values({ fromId: input.fromId, toId, partyId: input.partyId, businessDate: input.businessDate,
    notes: input.notes }).returning({ id: jobWorkChallans.id });
  if (row === undefined) throw new Error('the insert returned no row');
  const lines = await tx.insert(jobWorkChallanLines).values(input.lines.map((l, n) => ({ challanId: row.id, lineNo: n + 1, itemId: l.itemId,
    qty: l.qty, picks: { batches: l.batches, serials: l.serials } }))).returning({ id: jobWorkChallanLines.id });
  const moved = await postStock(ctx, { sourceTable: SOURCE, sourceId: row.id, businessDate: input.businessDate,
    transfers: input.lines.map((l, n) => ({ itemId: l.itemId, from: input.fromId, to: toId, sourceLineId: lines[n]?.id ?? null, qty: l.qty,
      batches: l.batches, units: l.serials.map((serialNo) => ({ serialNo })), unitEvent: 'sent_to_job_work' as const })) });
  // Each line moves out of ours, then into the job worker's, in the lines' order (the engine's).
  const outs = moved.filter((m) => m.direction === 'out');
  for (const [n, l] of lines.entries()) await tx.update(jobWorkChallanLines).set({ value: outs[n]?.value ?? roundMoney('0') }).where(eq(jobWorkChallanLines.id, l.id));
  const entry = await entryOf(ctx, row.id, input.businessDate, moved);
  const number = await nextNumber(ctx, JOB_WORK_CHALLAN_SERIES, input.businessDate);
  await tx.update(jobWorkChallans).set({ status: 'posted', number, postedEntryId: entry }).where(eq(jobWorkChallans.id, row.id));
  await tx.insert(jobWorkChallanStates).values({ challanId: row.id });
  return { id: row.id, number };
}

/** POST /stock/job-work/challans/:id/cancel (job_work:write): its mirror, while no receipt answers it. */
export async function cancelChallanNow(ctx: Ctx, { id, businessDate, reason }: In<typeof cancelJobWorkChallan>): Promise<Out<typeof cancelJobWorkChallan>> {
  await holdPeriod(ctx, businessDate);
  const c = await challanOf(ctx, id, 'job_work:write', true);
  if (c.status !== 'posted') throw wrongStatus(c.status, 'cancelled');
  if (businessDate < c.businessDate) {
    throw new AppError('date_before_source', 'A cancellation is dated on or after what it cancels',
      [{ path: ['businessDate'], code: 'date_before_source', message: `The challan is dated ${c.businessDate}` }]);
  }
  const tx = stockTx(ctx);
  if (await answered(ctx, id)) {
    throw new AppError('challan_answered', 'A receipt answers this challan: cancel the receipt first');
  }
  await reverseStock(ctx, { sourceTable: SOURCE, sourceId: id, businessDate }).catch((e: unknown) => {
    if (e instanceof AppError && ['units_mismatch', 'unit_held', 'not_reversible'].includes(e.code)) {
      throw new AppError('goods_moved_on', 'A unit on this challan has moved on since, so it can’t be undone');
    }
    throw e;
  });
  const [own] = c.postedEntryId === null ? [] : await reverseEntriesOf(ctx, { source: { table: SOURCE, id }, businessDate, reason });
  await tx.update(jobWorkChallans).set({ status: 'cancelled', cancelledAt: new Date(), cancelledBy: principalId(ctx.principal),
    cancelReason: reason, cancelEntryId: own?.id ?? null }).where(eq(jobWorkChallans.id, id));
  return {};
}

/** An open challan's age in days, and whether it's past stock.job_work_return_days (section 143). */
const ageOf = (ctx: Ctx, c: { businessDate: string; status: string; closed: boolean }) => {
  const open = c.status === 'posted' && !c.closed;
  const days = Math.max(0, Math.round((Date.parse(indiaDate(new Date())) - Date.parse(c.businessDate)) / 86_400_000));
  return { open, ageDays: open ? days : 0, pastReturnDays: open && days > ctx.settings.get(JOB_WORK_RETURN_DAYS) };
};

/** GET /stock/job-work/challans (stock:read): newest first, a page at a time, the principal's own at `own` scope. */
export async function listChallansPage(ctx: Ctx, input: In<typeof listJobWorkChallans>): Promise<Out<typeof listJobWorkChallans>> {
  const key = input.after === undefined ? undefined : decodeCursor(PAGE_KEY, input.after);
  const f = input.filter;
  const open = f.open === true || f.pastReturnDays === true;
  // Past its return days: dated on or before today less the setting's days.
  const lastDay = addDays(indiaDate(new Date()), -ctx.settings.get(JOB_WORK_RETURN_DAYS) - 1);
  const rows = await stockTx(ctx).select({ id: jobWorkChallans.id, number: jobWorkChallans.number, fromId: jobWorkChallans.fromId,
    partyId: jobWorkChallans.partyId, businessDate: jobWorkChallans.businessDate, status: jobWorkChallans.status, closed: jobWorkChallanStates.closed,
    createdAt: jobWorkChallans.createdAt }).from(jobWorkChallans)
    .innerJoin(jobWorkChallanStates, eq(jobWorkChallanStates.challanId, jobWorkChallans.id)).where(and(
    // A draft lives only inside the save that posts it, and has no state, so none is ever listed.
    f.status === undefined ? undefined : eq(jobWorkChallans.status, f.status),
    f.partyId === undefined ? undefined : eq(jobWorkChallans.partyId, f.partyId),
    open ? and(eq(jobWorkChallans.status, 'posted'), eq(jobWorkChallanStates.closed, false)) : undefined,
    f.pastReturnDays === true ? lte(jobWorkChallans.businessDate, lastDay) : undefined,
    listScope(ctx, 'stock:read', jobWorkChallans.createdBy),
    after([jobWorkChallans.businessDate, jobWorkChallans.createdAt, jobWorkChallans.id], key && [key.date, key.at, key.id], 'desc'),
  )).orderBy(desc(jobWorkChallans.businessDate), desc(jobWorkChallans.createdAt), desc(jobWorkChallans.id)).limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const [places, parties] = [await placeNames(ctx, page.map((r) => r.fromId)), await partyNames(ctx, page.map((r) => r.partyId))];
  const last = page.at(-1);
  return {
    items: page.map((r) => ({ id: r.id, number: r.number ?? '', fromId: r.fromId, fromName: places.get(r.fromId) ?? '', partyId: r.partyId,
      partyName: parties.get(r.partyId) ?? '', businessDate: r.businessDate, status: r.status as Status, ...ageOf(ctx, r) })),
    next: rows.length > input.limit && last ? encodeCursor({ date: last.businessDate, at: last.createdAt, id: last.id }) : null,
  };
}

/** GET /stock/job-work/challans/:id (stock:read): with each line's sending and what's been accounted for of it. */
export async function getChallanById(ctx: Ctx, { id }: In<typeof getJobWorkChallan>): Promise<Out<typeof getJobWorkChallan>> {
  const c = await challanOf(ctx, id, 'stock:read');
  if (c.number === null) throw new AppError('not_found', 'There is no such challan');
  const lines = await stockTx(ctx).select().from(jobWorkChallanLines).where(eq(jobWorkChallanLines.challanId, id)).orderBy(asc(jobWorkChallanLines.lineNo));
  const [labels, places, parties, done] = [await itemLabels(ctx, lines.map((l) => l.itemId)), await placeNames(ctx, [c.fromId]),
    await partyNames(ctx, [c.partyId]), await accountedFor(ctx, lines.map((l) => l.id))];
  const batchNos = await batchNumbers(ctx, lines.flatMap((l) => picksOf<string>(l.picks).batches.flatMap((b) => (b.batchId === null ? [] : [b.batchId]))));
  return {
    id: c.id, number: c.number, fromId: c.fromId, fromName: places.get(c.fromId) ?? '', partyId: c.partyId, partyName: parties.get(c.partyId) ?? '',
    businessDate: c.businessDate, status: c.status as Status, ...ageOf(ctx, c), notes: c.notes, cancelReason: c.cancelReason,
    lines: lines.map((l) => {
      const picks = picksOf<string>(l.picks);
      const d = done.get(l.id) ?? { used: roundQty('0', 3), back: roundQty('0', 3), lost: roundQty('0', 3) };
      return { id: l.id, lineNo: l.lineNo, itemId: l.itemId, sku: labels.get(l.itemId)?.sku ?? '', name: labels.get(l.itemId)?.name ?? '',
        qty: quantityString().parse(l.qty), serials: picks.serials, value: l.value,
        batches: picks.batches.map((b) => ({ batchId: b.batchId, batchNo: b.batchId === null ? null : batchNos.get(b.batchId) ?? null, qty: b.qty })),
        used: d.used, back: d.back, lost: d.lost,
        left: roundQty(dec(l.qty).minus(d.used).minus(d.back).minus(d.lost), 3) };
    }),
  };
}
