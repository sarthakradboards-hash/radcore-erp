// Job work receipts (M4-07, RAD-142; ADR-008 §11, §12; ADR-006 §6, F16): what a challan sent, accounted for. Each line
// answers a challan line: the goods made from it, which come in at the inputs used plus the job worker's charge; the
// inputs used and lost, out of the job worker's place (units `scrapped`); and those back unused, moved home
// (`received_from_job_work`). Its number names the made goods' batch (RC-130). Its charges accrue to Job Work Charges
// to be Billed. Undone by its mirror while what it brought in is still where it went. A receipt is its maker's.
import { after, jobWorkChallanLines, jobWorkChallanStates, jobWorkChallans, jobWorkReceiptLines, jobWorkReceipts, stockTx } from '@radcore/db/stock';
import { holdPeriod, JOURNAL_SERIES, partyNames, postEntry, reverseEntriesOf, type JournalLine } from '@radcore/lib-accounts';
import { dec, quantityString, roundMoney, roundQty, roundRate, type Money, type Quantity } from '@radcore/lib-common';
import {
  AppError, decodeCursor, defineSeries, encodeCursor, holdSeries, listScope, momentKey, nextNumber, principalId, type Ctx,
} from '@radcore/lib-platform';
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { cancelJobWorkReceipt, createJobWorkReceipt, getJobWorkReceipt, listJobWorkReceipts } from '../contract.ts';
import { holdStock, postStock, reverseStock, type PostedMovement } from '../engine/stock.ts';
import { serialKey } from '../engine/units.ts';
import { batchNumbers, itemLabels } from './items.ts';
import { accountedFor } from './job-work-accounted.ts';
import { challanOf } from './job-work-challans.ts';
import { checkLines, placeNames, placeOf, picksOf } from './moves-lines.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;
type Status = 'posted' | 'cancelled';
type Part = { qty: Quantity; batches: { batchId: string | null; qty: Quantity }[]; serials: string[] };

/** Job work receipts' numbers (ADR-008 §3): JWR/26-27/00001, drawn as one posts, before its goods, to name their batch. */
export const JOB_WORK_RECEIPT_SERIES = defineSeries('stock.job_work_receipt', 'JWR', { digits: 5, label: 'Job work receipts' });

const SOURCE = 'job_work_receipts';
const PAGE_KEY = z.object({ date: z.iso.date(), at: momentKey(), id: z.uuid() });
const ZERO = roundQty('0', 3);
const positive = (p: { qty: string }) => dec(p.qty).gt(0);
const wrongStatus = (what: string, status: string, doing: string) => new AppError('wrong_status', `This ${what} is ${status}, so it can’t be ${doing}`);
const at = (n: number, field: string) => ['lines', n, field];

/** The receipt, locked when it's to be written, within the principal's scope for `permission` (else not_found). */
async function receiptOf(ctx: Ctx, id: string, permission: string, forUpdate = false) {
  const sel = stockTx(ctx).select().from(jobWorkReceipts).where(eq(jobWorkReceipts.id, id));
  const [row] = forUpdate ? await sel.for('update') : await sel;
  if (row === undefined) throw new AppError('not_found', 'There is no such receipt');
  ctx.see(permission, { owner: row.createdBy });
  return row;
}

/** Each line's parts judged against its challan line, before anything is written (§11). */
async function checkReceipt(ctx: Ctx, input: In<typeof createJobWorkReceipt>,
  challanLines: ReadonlyMap<string, { qty: string; picks: unknown }>): Promise<void> {
  const asked = new Map<string, Quantity>();
  for (const [n, l] of input.lines.entries()) {
    const line = challanLines.get(l.challanLineId);
    if (line === undefined) {
      throw new AppError('not_on_challan', 'A line names an input this challan didn’t send',
        [{ path: at(n, 'challanLineId'), code: 'not_on_challan', message: 'Choose one of the challan’s lines' }]);
    }
    // A serial accounted for is one this challan line sent, not another challan's unit at the same job worker.
    const sent = new Set(picksOf<string>(line.picks).serials.map(serialKey));
    for (const part of ['used', 'back', 'lost'] as const) {
      const stray = l[part].serials.find((s) => !sent.has(serialKey(s)));
      if (stray !== undefined) {
        throw new AppError('not_on_challan', `Unit ${stray} wasn’t sent on this challan line`,
          [{ path: at(n, part), code: 'not_on_challan', message: `${stray} wasn’t sent on this line` }]);
      }
    }
    const used = positive(l.used);
    if (l.made !== null && !used) {
      throw new AppError('made_without_use', 'Goods made use some of the inputs', [{ path: at(n, 'used'), code: 'made_without_use', message: 'Say how much was used' }]);
    }
    if (l.made === null && used) {
      throw new AppError('used_without_made', 'Inputs used went into goods made: name them, or count the inputs back or lost',
        [{ path: at(n, 'made'), code: 'used_without_made', message: 'Name the goods made' }]);
    }
    asked.set(l.challanLineId, roundQty(dec(asked.get(l.challanLineId) ?? ZERO).plus(l.used.qty).plus(l.back.qty).plus(l.lost.qty), 3));
  }
  // At most what each challan line sent, less what earlier receipts accounted for.
  const done = await accountedFor(ctx, [...asked.keys()]);
  for (const [n, l] of input.lines.entries()) {
    const d = done.get(l.challanLineId) ?? { used: ZERO, back: ZERO, lost: ZERO };
    const left = dec(challanLines.get(l.challanLineId)?.qty ?? '0').minus(d.used).minus(d.back).minus(d.lost);
    if (dec(asked.get(l.challanLineId) ?? ZERO).gt(left)) {
      throw new AppError('over_challan', `That’s more than the challan line has left to account for: ${roundQty(left, 3)}`,
        [{ path: at(n, 'challanLineId'), code: 'over_challan', message: `At most ${roundQty(left, 3)}` }]);
    }
  }
  await checkLines(ctx, input.lines.flatMap((l) => (l.made === null ? [] : [{ itemId: l.made.itemId, qty: l.made.qty }])));
}

/**
 * POST /stock/job-work/receipts (job_work:write): posted at once (F16), dated on or after its challan. ADR-006 §1's
 * order: the period, then the challan, then the stock it moves, then the journal's and its own series' turns, then its
 * number, which names its made goods' batch; then the goods.
 */
export async function addReceipt(ctx: Ctx, input: In<typeof createJobWorkReceipt>): Promise<Out<typeof createJobWorkReceipt>> {
  await holdPeriod(ctx, input.businessDate);
  const c = await challanOf(ctx, input.challanId, 'job_work:write', true).catch((e: unknown) => {
    if (e instanceof AppError && e.code === 'not_found') {
      throw new AppError('unknown_challan', 'There is no such challan', [{ path: ['challanId'], code: 'unknown_challan', message: 'Choose a challan' }]);
    }
    throw e;
  });
  if (c.status !== 'posted') throw wrongStatus('challan', c.status, 'received against');
  if (input.businessDate < c.businessDate) {
    throw new AppError('date_before_source', 'A receipt is dated on or after its challan',
      [{ path: ['businessDate'], code: 'date_before_source', message: `The challan is dated ${c.businessDate}` }]);
  }
  const into = await placeOf(ctx, input.locationId, 'locationId');
  if (into.kind === 'job_work') {
    throw new AppError('use_job_work', 'Goods made and inputs back come into a place of ours', [{ path: ['locationId'], code: 'use_job_work', message: 'Choose a place of ours' }]);
  }
  if (into.kind === 'rejected') {
    throw new AppError('needs_qc', 'Goods back from a job worker come into a place of ours that isn’t rejects',
      [{ path: ['locationId'], code: 'needs_qc', message: 'Choose a place that isn’t rejects' }]);
  }
  const tx = stockTx(ctx);
  const challanLines = new Map((await tx.select({ id: jobWorkChallanLines.id, itemId: jobWorkChallanLines.itemId, qty: jobWorkChallanLines.qty,
    picks: jobWorkChallanLines.picks })
    .from(jobWorkChallanLines).where(eq(jobWorkChallanLines.challanId, c.id))).map((l) => [l.id, l]));
  await checkReceipt(ctx, input, challanLines);

  const [row] = await tx.insert(jobWorkReceipts).values({ challanId: c.id, locationId: input.locationId, businessDate: input.businessDate,
    notes: input.notes }).returning({ id: jobWorkReceipts.id });
  if (row === undefined) throw new Error('the insert returned no row');
  const lines = await tx.insert(jobWorkReceiptLines).values(input.lines.map((l, n) => ({ receiptId: row.id, lineNo: n + 1,
    challanLineId: l.challanLineId, madeItemId: l.made?.itemId ?? null, madeQty: l.made?.qty ?? null, chargeRate: l.made?.chargeRate ?? null,
    madeSerials: l.made === null ? null : l.made.serials, used: l.used.qty, usedPicks: pick(l.used), back: l.back.qty, backPicks: pick(l.back),
    lost: l.lost.qty, lostPicks: pick(l.lost) }))).returning({ id: jobWorkReceiptLines.id });
  const input_ = input.lines.map((l, n) => ({ ...l, id: lines[n]?.id ?? '', itemId: challanLines.get(l.challanLineId)?.itemId ?? '' }));

  await holdStock(ctx, [
    ...input_.map((l) => ({ itemId: l.itemId, locationId: c.toId, serials: [...l.used.serials, ...l.back.serials, ...l.lost.serials] })),
    ...input_.map((l) => ({ itemId: l.itemId, locationId: input.locationId, serials: l.back.serials })),
    ...input_.flatMap((l) => (l.made === null ? [] : [{ itemId: l.made.itemId, locationId: input.locationId, serials: l.made.serials }])),
  ]);
  await holdSeries(ctx, [JOURNAL_SERIES, JOB_WORK_RECEIPT_SERIES]);
  const number = await nextNumber(ctx, JOB_WORK_RECEIPT_SERIES, input.businessDate);

  // The inputs: used and lost out of the job worker's place, scrapped; back home, received from job work.
  const outOf = async (part: 'used' | 'lost') => {
    const take = input_.filter((l) => positive(l[part]));
    const moved = take.length === 0 ? [] : await postStock(ctx, { sourceTable: SOURCE, sourceId: row.id, businessDate: input.businessDate,
      outs: take.map((l) => ({ itemId: l.itemId, locationId: c.toId, sourceLineId: l.id, qty: l[part].qty, batches: l[part].batches,
        units: l[part].serials.map((serialNo) => ({ serialNo })), unitEvent: 'scrapped' as const })) });
    return new Map(take.map((l, n) => [l.id, moved[n]]));
  };
  const used = await outOf('used');
  const lost = await outOf('lost');
  const home = input_.filter((l) => positive(l.back));
  const back = home.length === 0 ? [] : await postStock(ctx, { sourceTable: SOURCE, sourceId: row.id, businessDate: input.businessDate,
    transfers: home.map((l) => ({ itemId: l.itemId, from: c.toId, to: input.locationId, sourceLineId: l.id, qty: l.back.qty, batches: l.back.batches,
      units: l.back.serials.map((serialNo) => ({ serialNo })), unitEvent: 'received_from_job_work' as const })) });
  // The goods made: at the inputs used plus the charge (F16), in a batch the receipt's number names (RC-130). Goods
  // received into negative stock also revalue, which the engine posts as its own entry (ADR-006 §4), so the entry takes
  // only the ins (auditor-2's MUST on #381); a transfer never revalues.
  const charges = input_.map((l) => (l.made === null ? roundMoney('0') : roundMoney(dec(l.made.qty).times(l.made.chargeRate))));
  const madeLines = input_.flatMap((l, n) => (l.made === null ? [] : [{ l, made: l.made, value: roundMoney(dec(used.get(l.id)?.value ?? '0').plus(charges[n] ?? '0')) }]));
  const made = madeLines.length === 0 ? [] : (await postStock(ctx, { sourceTable: SOURCE, sourceId: row.id, businessDate: input.businessDate,
    ins: madeLines.map(({ l, made: m, value }) => ({ itemId: m.itemId, locationId: input.locationId, sourceLineId: l.id, qty: m.qty,
      rate: roundRate(dec(value).div(m.qty)), value, batches: [{ batchNo: number, qty: m.qty }],
      units: m.serials.map((serialNo) => ({ serialNo, batchNo: number })) })) })).filter((m) => m.direction === 'in');

  const charged = roundMoney(charges.reduce((s, x) => s.plus(x), dec('0')));
  const entry = await entryOf(ctx, row.id, input.businessDate, { made, back, out: [...used.values(), ...lost.values()].filter((m): m is PostedMovement => m !== undefined),
    lost: [...lost.values()].filter((m): m is PostedMovement => m !== undefined), charged });
  for (const [n, l] of input_.entries()) {
    await tx.update(jobWorkReceiptLines).set({ usedValue: used.get(l.id)?.value ?? roundMoney('0'), lostValue: lost.get(l.id)?.value ?? roundMoney('0'),
      charge: charges[n] ?? roundMoney('0') }).where(eq(jobWorkReceiptLines.id, l.id));
  }
  await tx.update(jobWorkReceipts).set({ status: 'posted', number, postedEntryId: entry, charges: charged }).where(eq(jobWorkReceipts.id, row.id));
  await closeIfDone(ctx, c.id, challanLines);
  return { id: row.id, number };
}

/** The receipt's picks as kept: the batches and serials a part named. */
const pick = (p: Part) => ({ batches: p.batches, serials: p.serials });

/**
 * The entry (F16): Dr Stock in Hand for the goods made, at the inputs used plus the charge; Dr Stock Adjustment for the
 * inputs lost; Cr Stock in Hand at the job worker's place for the inputs used and lost; Cr Job Work Charges to be
 * Billed for the charges; and the inputs back, Dr at home, Cr at the job worker's. None when nothing has value.
 */
async function entryOf(ctx: Ctx, id: string, businessDate: string, m: { made: readonly PostedMovement[]; back: readonly PostedMovement[];
  out: readonly PostedMovement[]; lost: readonly PostedMovement[]; charged: Money }): Promise<string | null> {
  const stock = (x: PostedMovement, side: 'debit' | 'credit'): JournalLine => ({ account: { system: 'stock' }, itemId: x.itemId, locationId: x.locationId, [side]: x.value });
  const valued = (xs: readonly PostedMovement[]) => xs.filter((x) => dec(x.value).gt(0));
  const lostValue = roundMoney(m.lost.reduce((s, x) => s.plus(x.value), dec('0')));
  const lines: JournalLine[] = [
    ...valued(m.made).map((x) => stock(x, 'debit')),
    ...(dec(lostValue).gt(0) ? [{ account: { system: 'stock_adjustment' }, debit: lostValue } as JournalLine] : []),
    ...valued(m.back).map((x) => stock(x, x.direction === 'in' ? 'debit' : 'credit')),
    ...valued(m.out).map((x) => stock(x, 'credit')),
    ...(dec(m.charged).gt(0) ? [{ account: { system: 'jw_accrued' }, credit: m.charged } as JournalLine] : []),
  ];
  if (lines.length === 0) return null;
  return (await postEntry(ctx, { kind: 'job_work', businessDate, source: { table: SOURCE, id }, lines })).id;
}

/** Marks the challan closed once its receipts account for everything it sent, or open again once they don't (§11). */
async function closeIfDone(ctx: Ctx, challanId: string, lines: ReadonlyMap<string, { qty: string }>): Promise<void> {
  const done = await accountedFor(ctx, [...lines.keys()]);
  const closed = [...lines].every(([id, l]) => {
    const d = done.get(id);
    return d !== undefined && dec(d.used).plus(d.back).plus(d.lost).gte(l.qty);
  });
  await stockTx(ctx).update(jobWorkChallanStates).set({ closed }).where(eq(jobWorkChallanStates.challanId, challanId));
}

/**
 * POST /stock/job-work/receipts/:id/cancel (job_work:write): its mirror, dated `businessDate`, which opens its challan's
 * lines again; refused once what it brought in has moved on (`goods_moved_on`).
 * shortcut: `charges_billed` is declared but never raised yet: no purchase bill names a receipt's charges until M4-03's
 * bills do; that ticket adds the check here.
 */
export async function cancelReceiptNow(ctx: Ctx, { id, businessDate, reason }: In<typeof cancelJobWorkReceipt>): Promise<Out<typeof cancelJobWorkReceipt>> {
  await holdPeriod(ctx, businessDate);
  // §12: the challan before the receipt, so read the receipt unlocked for its challan first.
  const seen = await receiptOf(ctx, id, 'job_work:write');
  await challanOf(ctx, seen.challanId, 'job_work:write', true);
  const r = await receiptOf(ctx, id, 'job_work:write', true);
  if (r.status !== 'posted') throw wrongStatus('receipt', r.status, 'cancelled');
  if (businessDate < r.businessDate) {
    throw new AppError('date_before_source', 'A cancellation is dated on or after what it cancels',
      [{ path: ['businessDate'], code: 'date_before_source', message: `The receipt is dated ${r.businessDate}` }]);
  }
  await reverseStock(ctx, { sourceTable: SOURCE, sourceId: id, businessDate }).catch((e: unknown) => {
    if (e instanceof AppError && ['not_enough_stock', 'units_mismatch', 'unit_held', 'not_reversible'].includes(e.code)) {
      throw new AppError('goods_moved_on', 'What this receipt brought in has moved on since, so it can’t be undone');
    }
    throw e;
  });
  const [own] = r.postedEntryId === null ? [] : await reverseEntriesOf(ctx, { source: { table: SOURCE, id }, businessDate, reason });
  const tx = stockTx(ctx);
  await tx.update(jobWorkReceipts).set({ status: 'cancelled', cancelledAt: new Date(), cancelledBy: principalId(ctx.principal),
    cancelReason: reason, cancelEntryId: own?.id ?? null }).where(eq(jobWorkReceipts.id, id));
  const lines = await tx.select({ id: jobWorkChallanLines.id, qty: jobWorkChallanLines.qty }).from(jobWorkChallanLines)
    .where(eq(jobWorkChallanLines.challanId, r.challanId));
  await closeIfDone(ctx, r.challanId, new Map(lines.map((l) => [l.id, l])));
  return {};
}

/** GET /stock/job-work/receipts (stock:read): newest first, a page at a time, the principal's own at `own` scope. */
export async function listReceiptsPage(ctx: Ctx, input: In<typeof listJobWorkReceipts>): Promise<Out<typeof listJobWorkReceipts>> {
  const key = input.after === undefined ? undefined : decodeCursor(PAGE_KEY, input.after);
  const f = input.filter;
  const rows = await stockTx(ctx).select({ id: jobWorkReceipts.id, number: jobWorkReceipts.number, challanId: jobWorkReceipts.challanId,
    challanNumber: jobWorkChallans.number, partyId: jobWorkChallans.partyId, locationId: jobWorkReceipts.locationId,
    businessDate: jobWorkReceipts.businessDate, status: jobWorkReceipts.status, createdAt: jobWorkReceipts.createdAt })
    .from(jobWorkReceipts).innerJoin(jobWorkChallans, eq(jobWorkChallans.id, jobWorkReceipts.challanId)).where(and(
      f.status === undefined ? undefined : eq(jobWorkReceipts.status, f.status),
      f.challanId === undefined ? undefined : eq(jobWorkReceipts.challanId, f.challanId),
      f.partyId === undefined ? undefined : eq(jobWorkChallans.partyId, f.partyId),
      listScope(ctx, 'stock:read', jobWorkReceipts.createdBy),
      after([jobWorkReceipts.businessDate, jobWorkReceipts.createdAt, jobWorkReceipts.id], key && [key.date, key.at, key.id], 'desc'),
    )).orderBy(desc(jobWorkReceipts.businessDate), desc(jobWorkReceipts.createdAt), desc(jobWorkReceipts.id)).limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const [places, parties] = [await placeNames(ctx, page.map((r) => r.locationId)), await partyNames(ctx, page.map((r) => r.partyId))];
  const last = page.at(-1);
  return {
    items: page.map((r) => ({ id: r.id, number: r.number ?? '', challanId: r.challanId, challanNumber: r.challanNumber ?? '', partyId: r.partyId,
      partyName: parties.get(r.partyId) ?? '', locationId: r.locationId, locationName: places.get(r.locationId) ?? '', businessDate: r.businessDate,
      status: r.status as Status })),
    next: rows.length > input.limit && last ? encodeCursor({ date: last.businessDate, at: last.createdAt, id: last.id }) : null,
  };
}

/** GET /stock/job-work/receipts/:id (stock:read): line by line; its values are cost(), its charges shown. */
export async function getReceiptById(ctx: Ctx, { id }: In<typeof getJobWorkReceipt>): Promise<Out<typeof getJobWorkReceipt>> {
  const r = await receiptOf(ctx, id, 'stock:read');
  if (r.number === null) throw new AppError('not_found', 'There is no such receipt');
  // Its challan's number and party, as the receipt the reader may see names them.
  ctx.see('stock:read', { owner: r.createdBy });
  const tx = stockTx(ctx);
  const [c] = await tx.select({ number: jobWorkChallans.number, partyId: jobWorkChallans.partyId }).from(jobWorkChallans)
    .where(eq(jobWorkChallans.id, r.challanId));
  const lines = await tx.select({ line: jobWorkReceiptLines, inputItemId: jobWorkChallanLines.itemId }).from(jobWorkReceiptLines)
    .innerJoin(jobWorkChallanLines, eq(jobWorkChallanLines.id, jobWorkReceiptLines.challanLineId))
    .where(eq(jobWorkReceiptLines.receiptId, id)).orderBy(asc(jobWorkReceiptLines.lineNo));
  const labels = await itemLabels(ctx, lines.flatMap(({ line, inputItemId }) => [inputItemId, ...(line.madeItemId === null ? [] : [line.madeItemId])]));
  const batchNos = await batchNumbers(ctx, lines.flatMap(({ line }) => [line.usedPicks, line.backPicks, line.lostPicks]
    .flatMap((p) => picksOf<string>(p).batches.flatMap((b) => (b.batchId === null ? [] : [b.batchId])))));
  const [places, parties] = [await placeNames(ctx, [r.locationId]), await partyNames(ctx, c === undefined ? [] : [c.partyId])];
  const item = (itemId: string) => ({ itemId, sku: labels.get(itemId)?.sku ?? '', name: labels.get(itemId)?.name ?? '' });
  const part = (qty: string, picks: unknown) => {
    const p = picksOf<string>(picks);
    return { qty: quantityString().parse(qty), serials: p.serials,
      batches: p.batches.map((b) => ({ batchId: b.batchId, batchNo: b.batchId === null ? null : batchNos.get(b.batchId) ?? null, qty: b.qty })) };
  };
  return {
    id: r.id, number: r.number, challanId: r.challanId, challanNumber: c?.number ?? '', partyId: c?.partyId ?? '',
    partyName: parties.get(c?.partyId ?? '') ?? '', locationId: r.locationId, locationName: places.get(r.locationId) ?? '',
    businessDate: r.businessDate, status: r.status as Status, notes: r.notes, cancelReason: r.cancelReason, charges: r.charges ?? roundMoney('0'),
    lines: lines.map(({ line: l, inputItemId }) => ({
      id: l.id, lineNo: l.lineNo, challanLineId: l.challanLineId, input: item(inputItemId),
      made: l.madeItemId === null || l.madeQty === null || l.chargeRate === null ? null : { ...item(l.madeItemId), qty: quantityString().parse(l.madeQty),
        serials: (l.madeSerials ?? []) as string[], chargeRate: l.chargeRate, charge: l.charge ?? roundMoney('0'),
        value: roundMoney(dec(l.usedValue ?? '0').plus(l.charge ?? '0')) },
      used: part(l.used, l.usedPicks), back: part(l.back, l.backPicks),
      lost: { ...part(l.lost, l.lostPicks), value: l.lostValue ?? roundMoney('0') },
    })),
  };
}
