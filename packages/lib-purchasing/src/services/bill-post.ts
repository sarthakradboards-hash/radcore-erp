// Posting a purchase bill (M4-03, RAD-138; ADR-008 §7, §12; ADR-009 §2; ADR-006 §4, §6, F3): matched three ways, each goods line
// against the receipt line it bills and through it the PO line, then posted in one save. Its approval, past the tolerance,
// posts it too; cancelling mirrors it.
//   locks (§12): the period FOR SHARE → its POs FOR SHARE → its receipts → its job-work receipts (RAD-142) → the bill
//     → the stock positions → the series
//   Goods Received Not Billed: cleared by exactly what the billed quantities accrued at receipt, accepted goods first
//     (F3, F4): a line taking a receipt line from b0 to b1 of its quantity q, worth v at receipt, clears
//     round(v × b1 / q) − round(v × b0 / q), so the bill that takes the last of it clears what's left, exactly
//   the price difference: the bill's value (with its charges spread by value, and GST it doesn’t claim) less what it
//     accrued; an accepted part's goes to stock across the sellable places holding the item, and to cost of goods sold
//     for what's gone (ADR-006 §4); a billed reject's onto its rejects place
import { purchaseBillLines, purchaseBills, purchasingTx } from '@radcore/db/purchasing';
import { getPartyById, holdPeriod, JOURNAL_SERIES, lockPeriod, postEntry, reverseEntriesOf, type JournalLine } from '@radcore/lib-accounts';
import { dec, indiaDate, roundMoney, roundQty, type Decimal, type Money } from '@radcore/lib-common';
import { AppError, holdSeries, nextNumber, principalId, requestApproval, type ApprovalSpec, type Ctx } from '@radcore/lib-platform';
import { creditFrom, inputCredit, supplierKind } from '@radcore/lib-gst';
import { holdStock, jobWorkLinesFor, postStock, quantitiesAt, revaluesOf, sellableOnHand, type StockRevalue } from '@radcore/lib-stock';
import { asc, eq } from 'drizzle-orm';
import type { cancelPurchaseBill, postPurchaseBill } from '../contract.ts';
import {
  amountsOf, BILL_SERIES, BILL_TOLERANCE, billOf, checkDraft, holdOrders, overPoRate, wrongStatus, type BillIn, type In, type Out, type Row,
} from './bill-checks.ts';
import { accrued, jobWorkAccruals, type Accrual } from './bill-job-work.ts';
import { billedQty } from './billed.ts';
import { receiptLinesFor } from './receipt-lines.ts';
import { billDebited, returnedOf } from './received.ts';
import { buyingFrom } from './suppliers.ts';

type Line = typeof purchaseBillLines.$inferSelect;
type ReceiptLine = Awaited<ReturnType<typeof receiptLinesFor>>[number];
const SOURCE = 'purchase_bills';
const refuse = (code: string, message: string, path: (string | number)[]) => new AppError(code, message, [{ path, code, message }]);
const zero = () => dec('0');
const minOf = (a: Decimal, b: Decimal) => (a.lt(b) ? a : b);

const linesOf = (ctx: Ctx, id: string) => purchasingTx(ctx).select().from(purchaseBillLines).where(eq(purchaseBillLines.billId, id))
  .orderBy(asc(purchaseBillLines.lineNo));
const receiptIdsOf = (lines: readonly Line[]) => lines.flatMap((l) => (l.receiptLineId === null ? [] : [l.receiptLineId]));

/** §12's step 2 for a bill: its POs FOR SHARE, then its goods receipts, then its job-work receipts, each in id order,
 * before the bill itself. */
async function holdSources(ctx: Ctx, lines: readonly Line[]): Promise<ReceiptLine[]> {
  await holdOrders(ctx, lines.flatMap((l) => (l.poLineId === null ? [] : [l.poLineId])));
  const receipts = await receiptLinesFor(ctx, receiptIdsOf(lines), { forUpdate: true });
  await jobWorkLinesFor(ctx, lines.flatMap((l) => (l.jobWorkReceiptLineId === null ? [] : [l.jobWorkReceiptLineId])), { lock: 'update' });
  return receipts;
}

/** The stored draft as its save sent it, for the draft's checks again. */
const inputOf = (b: Row, lines: readonly Line[]): BillIn => ({ supplierId: b.partyId, businessDate: b.businessDate,
  supplierInvoiceNumber: b.supplierInvoiceNumber, supplierInvoiceDate: b.supplierInvoiceDate, supplierGstin: b.supplierGstin,
  statedTotal: b.statedTotal as Money, fileId: b.fileId, notes: b.notes,
  lines: lines.map((l) => (l.kind === 'goods'
    ? { kind: 'goods' as const, poLineId: l.poLineId ?? '', receiptLineId: l.receiptLineId, qty: (l.qty ?? '0') as never, rate: (l.rate ?? '0') as never }
    : l.kind === 'job_work'
      ? { kind: 'job_work' as const, jobWorkReceiptLineId: l.jobWorkReceiptLineId ?? '', qty: (l.qty ?? '0') as never, rate: (l.rate ?? '0') as never,
        hsn: l.hsn ?? '' }
      : { kind: 'charge' as const, charge: (l.charge ?? 'other') as 'other', description: l.description ?? '', hsn: l.hsn ?? '', amount: (l.amount ?? '0') as Money })) });

type Judged = Awaited<ReturnType<typeof judge>>;

/** Everything posting checks and works out, under the locks: the draft's checks again, the file, each goods line's
 * receipt line (posted, dated on or before the bill, not billed past what came in), the tax and the stated total, and
 * whether a line or the charges are past the tolerance. */
async function judge(ctx: Ctx, b: Row, lines: readonly Line[], receipts: readonly ReceiptLine[]) {
  if (b.status !== 'draft') throw wrongStatus(b.status, 'posted');
  const { po, made } = await checkDraft(ctx, inputOf(b, lines));
  if (b.fileId === null) throw refuse('bill_file_required', 'Attach the supplier’s bill before posting it', ['fileId']);
  const byId = new Map(receipts.map((r) => [r.id, r]));
  const used = await billedQty(ctx, receiptIdsOf(lines));
  const back = await returnedOf(ctx, receiptIdsOf(lines), { drafts: false });
  const accruals: Accrual[] = [];
  for (const [n, line] of lines.entries()) {
    if (line.kind !== 'goods') continue;
    const r = line.receiptLineId === null ? undefined : byId.get(line.receiptLineId);
    if (r === undefined) throw refuse('goods_not_received', 'Name the goods receipt this line bills, once the goods are in', ['lines', n, 'receiptLineId']);
    if (b.businessDate < r.receiptDate) throw refuse('date_before_source', `Goods receipt ${r.receiptNumber ?? ''} is dated ${r.receiptDate}`, ['businessDate']);
    const qty = dec(line.qty ?? '0');
    const before = used.get(r.id) ?? zero();
    // A posted receipt line has its QC figures (only a draft's are null).
    const accepted = dec(r.accepted ?? '0');
    const rejectedAll = dec(r.rejected ?? '0');
    // Less rejects returned before they were billed (ADR-008 §7). A return takes its unbilled part first (§8): the rejects,
    // then any accepted goods moved to rejects, each from the top of its pool and clearing its share of what the pool
    // accrued (debit-notes.ts), so with the shares below, taken from the bottom, the last document clears what's left of
    // GRNB exactly. A return's billed part only comes once nothing is unbilled, so counting it here bills nothing more.
    const returned = back.get(r.id) ?? zero();
    const accLeft = accepted.minus(returned.gt(rejectedAll) ? returned.minus(rejectedAll) : zero());
    const left = accLeft.plus(rejectedAll.minus(minOf(returned, rejectedAll)));
    if (before.plus(qty).gt(left)) {
      throw refuse('over_received', `Only ${left.minus(before).toFixed()} of that receipt line is left to bill`, ['lines', n, 'qty']);
    }
    // The accepted goods are billed first, the rejects only beyond them (F3, F4).
    const accBefore = minOf(before, accLeft);
    const acc = minOf(qty, accLeft.minus(accBefore));
    const rejBefore = before.gt(accLeft) ? before.minus(accLeft) : zero();
    const rej = qty.minus(acc);
    const value = accrued(r.acceptedValue ?? '0', accepted, accBefore, accBefore.plus(acc))
      .plus(accrued(r.rejectedValue ?? '0', rejectedAll, rejBefore, rejBefore.plus(rej)));
    used.set(r.id, before.plus(qty));
    accruals.push({ line, n, itemId: r.itemId, rejectsLocationId: r.rejectsLocationId, accepted: acc, rejected: rej, value, jobWork: false });
  }
  accruals.push(...await jobWorkAccruals(ctx, b, lines, made));
  const supplier = await buyingFrom(ctx, b.partyId);
  const amounts = await amountsOf(ctx, supplier.stateCode, b.supplierInvoiceDate, lines);
  if (dec(amounts.totals.total).minus(dec(b.statedTotal)).abs().gte(1)) {
    throw refuse('total_mismatch', `The bill works out at ${amounts.totals.total}, not the ${b.statedTotal} it states: put it right with the supplier`, ['statedTotal']);
  }
  const tolerance = dec(ctx.settings.get(BILL_TOLERANCE));
  const lineOver = lines.some((l) => {
    if (l.kind === 'charge') return false;
    // A job worker's charge against its receipt's charge rate, as goods against their PO's (the architect on RAD-142).
    const against = l.kind === 'job_work' ? made.get(l.jobWorkReceiptLineId ?? '')?.chargeRate : po.get(l.poLineId ?? '')?.rate;
    const over = overPoRate(l.rate ?? '0', against ?? '0');
    return over === null || dec(over).gt(tolerance);
  });
  const taxableOf = (kind: string) => lines.reduce((s, l, i) => (l.kind === kind ? s.plus(dec(amounts.lines[i]?.taxable ?? '0')) : s), zero());
  const [goods, charges] = [taxableOf('goods').plus(taxableOf('job_work')), taxableOf('charge')];
  const chargesOver = !charges.isZero() && (goods.isZero() || charges.times(100).div(goods).gt(tolerance));
  // Each line's input credit by ADR-009 §2: the supplier's kind against gst.credit_from, and its heads against its state.
  // The GSTIN as printed is the party's (checkDraft). A charge line's blocked category comes with M5-02.
  const [kind, from] = [supplierKind(supplier), creditFrom(ctx)];
  const credits = amounts.lines.map((tax) => inputCredit({ tax, kind, creditFrom: from, blocked: false, intraState: amounts.intraState }));
  return { amounts, accruals, over: lineOver || chargesOver, credits };
}

/** Spreads `total` over `weights` by value, to the paisa, the last taking what's left so the shares add up exactly. */
function spread(total: Decimal, weights: readonly Decimal[]): Decimal[] {
  const sum = weights.reduce((s, w) => s.plus(w), zero());
  let left = total;
  return weights.map((w, i) => {
    if (i === weights.length - 1) return left;
    const share = sum.isZero() ? zero() : dec(roundMoney(total.times(w).div(sum)));
    left = left.minus(share);
    return share;
  });
}

/** Posts a judged bill: its price difference into stock and cost of goods sold, its entry, its tax and number. */
async function commit(ctx: Ctx, b: Row, lines: readonly Line[], j: Judged): Promise<string> {
  const headsOf = (a: { cgst: string; sgst: string; igst: string } | undefined) =>
    (a === undefined ? zero() : dec(a.cgst).plus(dec(a.sgst)).plus(dec(a.igst)));
  // What each line costs: its taxable value, and the GST it doesn't claim (ADR-009 §2). Charges spread over the goods.
  const costOf = (i: number) => dec(j.amounts.lines[i]?.taxable ?? '0').plus(headsOf(j.amounts.lines[i])).minus(headsOf(j.credits[i]));
  const claimed = (head: 'cgst' | 'sgst' | 'igst') => j.credits.reduce((s, c) => s.plus(dec(c[head])), zero());
  const chargeCost = lines.reduce((s, l, i) => (l.kind === 'charge' ? s.plus(costOf(i)) : s), zero());
  const goodsAt = j.accruals.map((a) => lines.indexOf(a.line));
  const chargeShares = spread(chargeCost, goodsAt.map((i) => dec(j.amounts.lines[i]?.taxable ?? '0')));
  const byItem = new Map<string, { d: Decimal; billed: Decimal }>();
  // Each line's part of its item's billed quantity, in order, and how much of each line the stock share covers (q).
  const parts: { itemId: string; lineId: string; qty: Decimal }[] = [];
  const covered = new Map<string, Decimal>();
  const cover = (lineId: string, qty: Decimal) => covered.set(lineId, (covered.get(lineId) ?? zero()).plus(qty));
  const add = (itemId: string, d: Decimal, billed: Decimal, lineId: string) => {
    const item = byItem.get(itemId) ?? { d: zero(), billed: zero() };
    byItem.set(itemId, { d: item.d.plus(d), billed: item.billed.plus(billed) });
    if (billed.gt(0)) parts.push({ itemId, lineId, qty: billed });
  };
  const revalues: StockRevalue[] = [];
  const rejects: { itemId: string; locationId: string; lineId: string; d: Decimal; qty: Decimal }[] = [];
  for (const [k, a] of j.accruals.entries()) {
    const d = costOf(goodsAt[k] ?? 0).plus(chargeShares[k] ?? zero()).minus(a.value);
    const qty = a.accepted.plus(a.rejected);
    const dRejected = a.rejected.isZero() || qty.isZero() ? zero() : dec(roundMoney(d.times(a.rejected).div(qty)));
    if (!a.rejected.isZero()) rejects.push({ itemId: a.itemId, locationId: a.rejectsLocationId, lineId: a.line.id, d: dRejected, qty: a.rejected });
    add(a.itemId, d.minus(dRejected), a.accepted, a.line.id);
  }
  // The positions it may revalue, under their locks: the sellable places holding each item, and each reject's place.
  const items = [...byItem.keys()];
  const seen = await sellableOnHand(ctx, items);
  await holdStock(ctx, [...items.flatMap((itemId) => (seen.get(itemId) ?? []).map((p) => ({ itemId, locationId: p.locationId }))),
    ...rejects.map((r) => ({ itemId: r.itemId, locationId: r.locationId }))]);
  // A billed reject's difference goes onto what its rejects place still holds, so it's worth what was billed (§7). What's
  // left it since (requalified into stock, or written off) takes the rest, with the accepted goods, by ADR-006 §4 (the
  // auditor on #380).
  const stillThere = await quantitiesAt(ctx, rejects);
  for (const r of rejects) {
    const key = `${r.itemId} ${r.locationId}`;
    const there = dec(stillThere.get(key) ?? '0');
    const used = there.lt(r.qty) ? (there.gt(0) ? there : zero()) : r.qty;
    stillThere.set(key, roundQty(there.minus(used), 3));
    const toRejects = used.eq(r.qty) ? r.d : dec(roundMoney(r.d.times(used).div(r.qty)));
    if (!toRejects.isZero()) revalues.push({ itemId: r.itemId, locationId: r.locationId, sourceLineId: r.lineId, value: roundMoney(toRejects) });
    cover(r.lineId, used);
    add(r.itemId, r.d.minus(toRejects), r.qty.minus(used), r.lineId);
  }
  const on = await sellableOnHand(ctx, items);
  let cogs = zero();
  for (const [itemId, { d, billed }] of byItem) {
    // Only the positions held above (backend-3 on #380): a place that took the item between the two reads would be locked
    // out of order by postStock, so it counts as having taken it just after this bill.
    const held = new Set((seen.get(itemId) ?? []).map((p) => p.locationId));
    const places = (on.get(itemId) ?? []).filter((p) => held.has(p.locationId));
    const onHand = places.reduce((s, p) => s.plus(dec(p.qty)), zero());
    const toStock = onHand.gte(billed) ? d : onHand.gt(0) ? dec(roundMoney(d.times(onHand).div(billed))) : zero();
    // The units that share covers, handed to the item's lines in order.
    let left = onHand.gte(billed) ? billed : onHand.gt(0) ? onHand : zero();
    for (const part of parts.filter((x) => x.itemId === itemId)) {
      const take = minOf(part.qty, left);
      cover(part.lineId, take);
      left = left.minus(take);
    }
    cogs = cogs.plus(d.minus(toStock));
    for (const [i, share] of spread(toStock, places.map((p) => dec(p.qty))).entries()) {
      if (!share.isZero()) revalues.push({ itemId, locationId: places[i]?.locationId ?? '', value: roundMoney(share) });
    }
  }
  const moved = revalues.length === 0 ? [] : await postStock(ctx, { sourceTable: SOURCE, sourceId: b.id, businessDate: b.businessDate, revalues });
  const t = j.amounts.totals;
  const signed = (account: JournalLine['account'], v: Decimal, more: Partial<JournalLine> = {}): JournalLine[] =>
    (v.isZero() ? [] : [{ account, ...more, ...(v.gt(0) ? { debit: roundMoney(v) } : { credit: roundMoney(v.abs()) }) }]);
  const entryLines: JournalLine[] = [
    ...signed({ system: 'grni' }, j.accruals.reduce((s, a) => (a.jobWork ? s : s.plus(a.value)), zero())),
    ...signed({ system: 'jw_accrued' }, j.accruals.reduce((s, a) => (a.jobWork ? s.plus(a.value) : s), zero())),
    ...moved.flatMap((m) => signed({ system: 'stock' }, dec(m.value), { itemId: m.itemId, locationId: m.locationId })),
    ...signed({ system: 'cogs' }, cogs),
    ...signed({ system: 'input_cgst' }, claimed('cgst')), ...signed({ system: 'input_sgst' }, claimed('sgst')),
    ...signed({ system: 'input_igst' }, claimed('igst')),
    ...signed({ system: 'round_off' }, dec(t.roundOff)),
    { account: { system: 'creditors' }, partyId: b.partyId, credit: t.total },
  ];
  // The journal's and the bills' series last (ADR-006 §1): the number is the save's last step.
  await holdSeries(ctx, [JOURNAL_SERIES, BILL_SERIES]);
  const number = await nextNumber(ctx, BILL_SERIES, b.businessDate);
  const entry = await postEntry(ctx, { kind: 'purchase_bill', businessDate: b.businessDate, source: { table: SOURCE, id: b.id }, lines: entryLines });
  const tx = purchasingTx(ctx);
  // Each line keeps what it cleared of Goods Received Not Billed or Job Work Charges to be Billed, for the books check
  // (ADR-006 §7, RAD-95).
  const cleared = new Map(j.accruals.map((x) => [x.line.id, roundMoney(x.value)]));
  for (const [i, l] of lines.entries()) {
    const [a, c] = [j.amounts.lines[i], j.credits[i]];
    if (a !== undefined && c !== undefined) {
      await tx.update(purchaseBillLines).set({ gstRate: a.gstRate, gstRateSource: a.gstRateSource, taxable: a.taxable, cgst: a.cgst, sgst: a.sgst,
        igst: a.igst, lineTotal: a.lineTotal, creditCgst: c.cgst, creditSgst: c.sgst, creditIgst: c.igst, creditReason: c.reason, ...(l.kind === 'charge' ? {} : { revaluedQty: roundQty(covered.get(l.id) ?? zero(), 3),
          [l.kind === 'goods' ? 'grniValue' : 'jwcbValue']: cleared.get(l.id) ?? null }) })
        .where(eq(purchaseBillLines.id, l.id));
    }
  }
  await tx.update(purchaseBills).set({ status: 'posted', number, postedEntryId: entry.id, placeOfSupply: j.amounts.placeOfSupply,
    taxable: t.taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst, roundOff: t.roundOff, total: t.total }).where(eq(purchaseBills.id, b.id));
  return number;
}

/** What the approver sees and approves (RAD-38): the supplier's bill as entered, its lines and its total. */
type Version = { supplierId: string; businessDate: string; supplierInvoiceNumber: string; supplierInvoiceDate: string; statedTotal: string;
  fileId: string | null; lines: { kind: string; poLineId: string | null; receiptLineId: string | null; jobWorkReceiptLineId: string | null;
    qty: string | null; rate: string | null; hsn: string | null; amount: string | null }[]; total: string | null };

/** The bills' approval (ADR-008 §7): kind purchase-bill, under bills:approve. Approving posts the bill, so its locks come
 * first (§12): the period, then the bill's POs and receipts, before the engine locks the bill. */
export const billApproval: ApprovalSpec<Version> = {
  kind: 'purchase-bill',
  table: 'purchase_bills',
  parts: ['purchase_bill_lines'],
  async version(ctx, id, { forUpdate }) {
    const q = purchasingTx(ctx).select().from(purchaseBills).where(eq(purchaseBills.id, id)).limit(1);
    const [b] = forUpdate ? await q.for('update') : await q;
    // Its poster asks (bills:write) and someone else decides (bills:approve); outside both, there's no such bill. Its
    // status isn't part of it: approving posts it, which changes no figure approved.
    if (b === undefined) return null;
    if (!ctx.can('bills:write', { owner: b.createdBy }) && !ctx.can('bills:approve', { owner: b.createdBy })) return null;
    const lines = await linesOf(ctx, id);
    // It refuses nothing, for the approver's queue: a total that can't be worked out now hashes as null.
    const party = await getPartyById(ctx, { id: b.partyId });
    const worked = await amountsOf(ctx, party.stateCode, b.supplierInvoiceDate, lines).catch(() => null);
    return { supplierId: b.partyId, businessDate: b.businessDate, supplierInvoiceNumber: b.supplierInvoiceNumber, supplierInvoiceDate: b.supplierInvoiceDate,
      statedTotal: b.statedTotal, fileId: b.fileId, total: worked?.totals.total ?? null,
      lines: lines.map((l) => ({ kind: l.kind, poLineId: l.poLineId, receiptLineId: l.receiptLineId, jobWorkReceiptLineId: l.jobWorkReceiptLineId,
        qty: l.qty, rate: l.rate, hsn: l.hsn, amount: l.amount })) };
  },
  async lockFirst(ctx, id) {
    await lockPeriod(ctx);
    await holdSources(ctx, await linesOf(ctx, id));
  },
  async approved(ctx, id) {
    const b = await billOf(ctx, id, 'bills:approve', true);
    await holdPeriod(ctx, b.businessDate);
    const lines = await linesOf(ctx, id);
    const receipts = await receiptLinesFor(ctx, receiptIdsOf(lines), { forUpdate: true });
    await commit(ctx, b, lines, await judge(ctx, b, lines, receipts));
  },
  // A refused one stays a draft: its poster puts it right with the supplier, or lets it be.
  async rejected() {},
};

/** POST /purchasing/bills/:id/post (bills:write): posted at once within the tolerance, else by asking for approval. */
export async function postBillNow(ctx: Ctx, { id }: In<typeof postPurchaseBill>): Promise<Out<typeof postPurchaseBill>> {
  // §12: the period first, so the draft is read unlocked to learn its date and sources, then they and it are locked.
  const seen = await billOf(ctx, id, 'bills:write');
  if (seen.status !== 'draft') throw wrongStatus(seen.status, 'posted');
  await holdPeriod(ctx, seen.businessDate);
  await holdSources(ctx, await linesOf(ctx, id));
  const b = await billOf(ctx, id, 'bills:write', true);
  const lines = await linesOf(ctx, id);
  const receipts = await receiptLinesFor(ctx, receiptIdsOf(lines), { forUpdate: true });
  const j = await judge(ctx, b, lines, receipts);
  if (j.over) {
    const asked = await requestApproval(ctx, billApproval, id);
    return { status: 'pending_approval', number: null, approvalId: asked.id, versionHash: asked.versionHash };
  }
  return { status: 'posted', number: await commit(ctx, b, lines, j), approvalId: null, versionHash: null };
}

/**
 * A cancelled bill's price difference, taken back as things stand now (the architect on RAD-138, ADR-008 §7): its entry
 * is mirrored whole, so the Cost of Goods Sold part comes back from there; its stock part comes back by ADR-006 §4's
 * split, from the places still holding the item (the sellable ones, and a rejects place it revalued), by quantity, and
 * from Cost of Goods Sold for what's gone. No position at quantity 0 is revalued (0044). A `revaluation` entry moves the
 * mirror's stock lines to where the value really comes back from, so each position's movements and lines still agree
 * (RA007).
 */
async function undoDifference<T>(ctx: Ctx, b: Row, lines: readonly Line[], businessDate: string, mirror: () => Promise<T>): Promise<T> {
  const original = await revaluesOf(ctx, SOURCE, b.id);
  if (original.length === 0) return mirror();
  const items = [...new Set(original.map((r) => r.itemId))];
  const seen = await sellableOnHand(ctx, items);
  const sellableAt = (itemId: string) => new Set((seen.get(itemId) ?? []).map((p) => p.locationId));
  // The rejects places it revalued count while they still hold the item.
  const others = original.filter((r) => !sellableAt(r.itemId).has(r.locationId)).map((r) => ({ itemId: r.itemId, locationId: r.locationId }));
  await holdStock(ctx, [...items.flatMap((itemId) => (seen.get(itemId) ?? []).map((p) => ({ itemId, locationId: p.locationId }))), ...others]);
  const mirrored = await mirror();
  const [on, there] = [await sellableOnHand(ctx, items), await quantitiesAt(ctx, others)];
  const revalues: StockRevalue[] = [];
  let cogs = zero();
  for (const itemId of items) {
    const share = original.filter((r) => r.itemId === itemId).reduce((t, r) => t.plus(dec(r.value)), zero());
    const covered = lines.reduce((t, l) => (l.itemId === itemId ? t.plus(dec(l.revaluedQty ?? '0')) : t), zero());
    const held = sellableAt(itemId);
    const places = [...(on.get(itemId) ?? []).filter((p) => held.has(p.locationId)).map((p) => ({ locationId: p.locationId, qty: dec(p.qty) })),
      ...others.filter((o) => o.itemId === itemId).map((o) => ({ locationId: o.locationId, qty: dec(there.get(`${itemId} ${o.locationId}`) ?? '0') }))]
      .filter((p) => p.qty.gt(0));
    const now = places.reduce((t, p) => t.plus(p.qty), zero());
    const back = now.gte(covered) ? share : now.gt(0) ? dec(roundMoney(share.times(now).div(covered))) : zero();
    cogs = cogs.plus(share.minus(back));
    for (const [i, part] of spread(back, places.map((p) => p.qty)).entries()) {
      if (!part.isZero()) revalues.push({ itemId, locationId: places[i]?.locationId ?? '', value: roundMoney(part.negated()) });
    }
  }
  const moved = revalues.length === 0 ? [] : await postStock(ctx, { sourceTable: SOURCE, sourceId: b.id, businessDate, revalues });
  // Per position: the mirror credited what posting debited, so put that back and take off what really came back.
  const net = new Map<string, { itemId: string; locationId: string; value: Decimal }>();
  const at = (itemId: string, locationId: string, v: Decimal) => {
    const key = `${itemId} ${locationId}`;
    net.set(key, { itemId, locationId, value: (net.get(key)?.value ?? zero()).plus(v) });
  };
  for (const r of original) at(r.itemId, r.locationId, dec(r.value));
  for (const m of moved) at(m.itemId, m.locationId, dec(m.value));
  const signed = (account: JournalLine['account'], v: Decimal, more: Partial<JournalLine> = {}): JournalLine[] =>
    (v.isZero() ? [] : [{ account, ...more, ...(v.gt(0) ? { debit: roundMoney(v) } : { credit: roundMoney(v.abs()) }) }]);
  const entryLines = [...[...net.values()].flatMap((p) => signed({ system: 'stock' }, p.value, { itemId: p.itemId, locationId: p.locationId })),
    ...signed({ system: 'cogs' }, cogs.negated())];
  if (entryLines.length > 0) {
    await postEntry(ctx, { kind: 'revaluation', businessDate, source: { table: SOURCE, id: b.id }, lines: entryLines });
  }
  return mirrored;
}

/** POST /purchasing/bills/:id/cancel (bills:write): its entry and price difference mirrored, dated the cancellation's
 * day, only while nothing is applied to it (the database's guard_applied_cancel answers still_applied), and not while a
 * posted supplier return debits it (bill_returned, RAD-140). */
export async function cancelBillNow(ctx: Ctx, { id, businessDate, reason }: In<typeof cancelPurchaseBill>): Promise<Out<typeof cancelPurchaseBill>> {
  await holdPeriod(ctx, businessDate);
  await holdSources(ctx, await linesOf(ctx, (await billOf(ctx, id, 'bills:write')).id));
  const b = await billOf(ctx, id, 'bills:write', true);
  if (b.status !== 'posted') throw wrongStatus(b.status, 'cancelled');
  if (businessDate > indiaDate(new Date())) throw refuse('date_in_future', 'A cancellation can’t be dated after today', ['businessDate']);
  if (businessDate < b.businessDate) throw refuse('date_before_source', `The bill is dated ${b.businessDate}`, ['businessDate']);
  // A bill a posted supplier return debits stays: its debit note mirrors it (RAD-140). Cancel the return first.
  if (await billDebited(ctx, id)) throw new AppError('bill_returned', 'A supplier return’s debit note is against this bill: cancel that return first');
  // The stock positions before any series' turn (ADR-006 §1, the auditor on #380): undoDifference holds them, then runs
  // the mirror (which draws the journal's number), then posts its own entry, which the mirror mustn't reverse.
  const own = await undoDifference(ctx, b, await linesOf(ctx, id), businessDate,
    async () => (await reverseEntriesOf(ctx, { source: { table: SOURCE, id }, businessDate, reason }))[0]);
  await purchasingTx(ctx).update(purchaseBills).set({ status: 'cancelled', cancelledAt: new Date(), cancelledBy: principalId(ctx.principal),
    cancelReason: reason, cancelEntryId: own?.id ?? null }).where(eq(purchaseBills.id, id));
  return {};
}
