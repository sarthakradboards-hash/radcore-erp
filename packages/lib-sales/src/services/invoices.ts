// Invoices (M3-09, RAD-113; ADR-007 §1–§4, §7; ADR-006 §6, F6): a party's posted deliveries billed, all or part of
// their lines. A draft is changed and thrown away freely; posting is invoice-post.ts's. A line bills no more of a
// delivery line than is still out (not taken back, not already invoiced), at its order line's rate and discount unless
// the person sets another.
import { after, deliveries, deliveryLines, invoiceLines, invoices, salesOrderLines, salesTx } from '@radcore/db/sales';
import { dec, type Money } from '@radcore/lib-common';
import { AppError, decodeCursor, encodeCursor, listScope, momentKey, principalId, type Ctx } from '@radcore/lib-platform';
import { checkQuantity, soldCondition, soldUnits } from '@radcore/lib-stock';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { createInvoice, deleteInvoice, getInvoice, listInvoices, updateInvoice } from '../contract.ts';
import { picksOf, returnedOf, type Returned } from './delivered.ts';
import { checkDate } from './document-rules.ts';
import { invoiceOwner } from './invoice-rules.ts';
import { listRatesOf, priceListOf } from './party-price-lists.ts';
import { labelled, numberedBatches, sellingTo, today } from './document-lines.ts';
import { partyNames } from './party-names.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;
export type LineIn = In<typeof createInvoice>['lines'][number];
type Status = 'draft' | 'posted' | 'cancelled';

const header = { id: invoices.id, number: invoices.number, partyId: invoices.partyId, businessDate: invoices.businessDate,
  status: invoices.status, notes: invoices.notes, total: invoices.total };
// Newest first: by date, then the moment each was made, then id (e2e-2: same-day ones were in id order, so random).
const PAGE_KEY = z.object({ date: z.iso.date(), at: momentKey(), id: z.uuid() });
export const wrongStatus = (status: string, what = 'changed') => new AppError('wrong_status', `This invoice is ${status}, so it can’t be ${what}`);

/** The invoice, locked when it's to be written, within the principal's scope for `permission` (else not_found), by its
 * owner (ADR-007 §7). */
export async function invoiceOf(ctx: Ctx, id: string, permission: string, forUpdate = false) {
  const sel = salesTx(ctx).select().from(invoices).where(eq(invoices.id, id));
  const [row] = forUpdate ? await sel.for('update') : await sel;
  if (row === undefined) throw new AppError('not_found', 'There is no such invoice');
  ctx.see(permission, { owner: row.owner });
  return row;
}

/** Whose an invoice is: its deliveries' shared owner, else the principal making it (invoice-rules.ts). */
export const ownerOf = (ctx: Ctx, lines: readonly CheckedLine[]): string =>
  invoiceOwner(lines.map((l) => l.delivery.owner), principalId(ctx.principal));
/** A billed line as checked: what it bills, at what price, and the delivery line it bills with what's gone from it. */
export type CheckedLine = {
  lineNo: number; deliveryLineId: string; itemId: string; qty: string; rate: string; discountPercent: string; priceChanged: boolean;
  /** What its discount is measured from (the architect on RAD-113): its order line's list rate when its price is
   * unchanged, else the invoice's list's rate on the invoice's date; null when the list has none. */
  listRate: string | null; listVersionId: string | null; listTaxInclusive: boolean;
  delivery: { id: string; businessDate: string; locationId: string; owner: string };
  sent: { qty: string; value: string | null; taxable: string | null; gst: string | null }; gone: Returned;
};

/**
 * An invoice's lines against the party's posted deliveries: each names a line of a posted delivery to this party, within
 * the principal's scope for `permission` (`not_on_source`, `other_party`), once, in a quantity its item's unit allows
 * and no more than is still out (`over_quantity`), at the order line's rate and discount unless set. One invoice may
 * bill deliveries of several orders and owners. Locks the deliveries, by id, when posting, so two invoices of one
 * delivery take turns over what's left of it.
 */
export async function checkedLines(ctx: Ctx, partyId: string, lines: readonly LineIn[],
  o: { priceListId: string | null; on: string; forUpdate?: boolean; permission?: string }): Promise<CheckedLine[]> {
  const forUpdate = o.forUpdate === true;
  const permission = o.permission ?? 'invoices:write';
  const tx = salesTx(ctx);
  const ids = [...new Set(lines.map((l) => l.deliveryLineId))];
  const sent = new Map((await tx.select({ id: deliveryLines.id, deliveryId: deliveryLines.deliveryId, itemId: deliveryLines.itemId,
    qty: deliveryLines.qty, picks: deliveryLines.picks, value: deliveryLines.value, taxable: deliveryLines.taxable, gst: deliveryLines.gst,
    rate: salesOrderLines.rate, discountPercent: salesOrderLines.discountPercent, listRate: salesOrderLines.listRate,
    listVersionId: salesOrderLines.listVersionId }).from(deliveryLines)
    .innerJoin(salesOrderLines, eq(salesOrderLines.id, deliveryLines.orderLineId))
    .where(inArray(deliveryLines.id, ids))).map((l) => [l.id, l])); // a contract's lines are one or more
  const deliveryIds = [...new Set([...sent.values()].map((l) => l.deliveryId))].toSorted();
  const sel = tx.select({ id: deliveries.id, partyId: deliveries.partyId, status: deliveries.status, owner: deliveries.owner,
    businessDate: deliveries.businessDate, locationId: deliveries.locationId }).from(deliveries)
    .where(inArray(deliveries.id, deliveryIds)).orderBy(asc(deliveries.id));
  const found = new Map(deliveryIds.length === 0 ? [] : (forUpdate ? await sel.for('update') : await sel).map((d) => [d.id, d]));
  const gone = await returnedOf(ctx, [...sent.values()]);
  const seen = new Set<string>();
  const rows: CheckedLine[] = [];
  for (const [n, l] of lines.entries()) {
    const line = sent.get(l.deliveryLineId);
    const delivery = line === undefined ? undefined : found.get(line.deliveryId);
    const path = ['lines', n, 'deliveryLineId'];
    if (line === undefined || delivery === undefined || delivery.status !== 'posted' || seen.has(line.id)
      || !ctx.can(permission, { owner: delivery.owner })) {
      throw new AppError('not_on_source', 'A line isn’t on a posted delivery you can bill',
        [{ path, code: 'not_on_source', message: line !== undefined && seen.has(line.id) ? 'Name each delivery line once' : 'Choose a posted delivery’s line' }]);
    }
    if (delivery.partyId !== partyId) {
      throw new AppError('other_party', 'An invoice bills one party’s deliveries', [{ path, code: 'other_party', message: 'This delivery is another party’s' }]);
    }
    seen.add(line.id);
    await checkQuantity(ctx, line.itemId, l.qty).catch((e: unknown) => {
      throw e instanceof AppError ? new AppError(e.code, e.message, [{ path: ['lines', n, 'qty'], code: e.code, message: e.message }]) : e;
    });
    const was = gone.get(line.id);
    if (was === undefined) throw new Error(`delivery line ${line.id} has no answer`);
    const out = dec(line.qty).minus(dec(was.qty));
    if (dec(l.qty).gt(out)) {
      throw new AppError('over_quantity', 'That’s more than is still to invoice on this delivery',
        [{ path: ['lines', n, 'qty'], code: 'over_quantity', message: `${out.toFixed()} still to invoice` }]);
    }
    const rate = l.rate ?? line.rate;
    const discountPercent = l.discountPercent ?? line.discountPercent;
    rows.push({ lineNo: n + 1, deliveryLineId: line.id, itemId: line.itemId, qty: l.qty, rate, discountPercent,
      priceChanged: !dec(rate).eq(dec(line.rate)) || !dec(discountPercent).eq(dec(line.discountPercent)),
      listRate: line.listRate, listVersionId: line.listVersionId, listTaxInclusive: false,
      delivery: { id: delivery.id, businessDate: delivery.businessDate, locationId: delivery.locationId, owner: delivery.owner },
      sent: { qty: line.qty, value: line.value, taxable: line.taxable, gst: line.gst }, gone: was });
  }
  // A changed line is measured from the invoice's own list on its date, never from its order's or a typed rate.
  const changed = rows.filter((r) => r.priceChanged);
  const listed = await listRatesOf(ctx, o.priceListId, o.on, changed.map((r) => r.itemId));
  changed.forEach((r, i) => Object.assign(r, listed[i]));
  return rows;
}

const stored = (lines: readonly CheckedLine[]) => lines.map((l) => ({ lineNo: l.lineNo, deliveryLineId: l.deliveryLineId, itemId: l.itemId,
  qty: l.qty, rate: l.rate, discountPercent: l.discountPercent, listRate: l.listRate, listVersionId: l.listVersionId }));
const shipToColumns = (s: In<typeof createInvoice>['shipTo']) =>
  ({ shipToName: s?.name ?? null, shipToAddress: s?.address ?? null, shipToStateCode: s?.stateCode ?? null });

/** GET /sales/invoices (sales:read): newest first, a page at a time, the principal's own when that's their scope. */
export async function listInvoicesPage(ctx: Ctx, input: In<typeof listInvoices>): Promise<Out<typeof listInvoices>> {
  const key = input.after === undefined ? undefined : decodeCursor(PAGE_KEY, input.after);
  const rows = await salesTx(ctx).select({ ...header, createdAt: invoices.createdAt }).from(invoices).where(and(
    input.filter.status === undefined ? undefined : eq(invoices.status, input.filter.status),
    input.filter.partyId === undefined ? undefined : eq(invoices.partyId, input.filter.partyId),
    listScope(ctx, 'sales:read', invoices.owner),
    after([invoices.businessDate, invoices.createdAt, invoices.id], key && [key.date, key.at, key.id], 'desc'),
  )).orderBy(desc(invoices.businessDate), desc(invoices.createdAt), desc(invoices.id)).limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const names = await partyNames(ctx, page.map((r) => r.partyId));
  const last = page.at(-1);
  return {
    items: page.map((r) => ({ ...r, status: r.status as Status, partyName: names.get(r.partyId) ?? '' })),
    next: rows.length > input.limit && last ? encodeCursor({ date: last.businessDate, at: last.createdAt, id: last.id }) : null,
  };
}

/** Each delivery line's batches as its goods left, with their numbers, and its units still out (ui-2 on #298). */
async function goodsOf(ctx: Ctx, deliveryLineIds: readonly string[]) {
  const rows = deliveryLineIds.length === 0 ? [] : await salesTx(ctx).select({ id: deliveryLines.id, picks: deliveryLines.picks })
    .from(deliveryLines).where(inArray(deliveryLines.id, [...deliveryLineIds]));
  const picked = await numberedBatches(ctx, rows.map((r) => ({ id: r.id, batches: picksOf(r.picks).batches })));
  const out = await soldUnits(ctx, deliveryLineIds);
  return new Map(picked.map((p) => [p.id, { batches: p.batches, units: out.get(p.id) ?? [] }]));
}

/** GET /sales/invoices/:id (sales:read): with its frozen issuer and buyer, once posted. */
export async function getInvoiceById(ctx: Ctx, { id }: In<typeof getInvoice>): Promise<Out<typeof getInvoice>> {
  const r = await invoiceOf(ctx, id, 'sales:read');
  const lines = await salesTx(ctx).select({ id: invoiceLines.id, lineNo: invoiceLines.lineNo, deliveryLineId: invoiceLines.deliveryLineId,
    itemId: invoiceLines.itemId, qty: invoiceLines.qty, rate: invoiceLines.rate, discountPercent: invoiceLines.discountPercent,
    hsn: invoiceLines.hsn, gstRate: invoiceLines.gstRate, gstRateSource: invoiceLines.gstRateSource, taxable: invoiceLines.taxable,
    cgst: invoiceLines.cgst, sgst: invoiceLines.sgst, igst: invoiceLines.igst, cessAdValorem: invoiceLines.cessAdValorem,
    cessPerUnitAmount: invoiceLines.cessPerUnitAmount, lineTotal: invoiceLines.lineTotal, cost: invoiceLines.cost,
    deliveryTaxable: invoiceLines.deliveryTaxable, deliveryGst: invoiceLines.deliveryGst, unitCondition: invoiceLines.unitCondition })
    .from(invoiceLines).where(eq(invoiceLines.invoiceId, id)).orderBy(asc(invoiceLines.lineNo));
  const names = await partyNames(ctx, [r.partyId]);
  const frozen = r.status !== 'draft';
  // A draft's units' condition is read as it stands; a posted line's is the one it carries (the architect on RAD-112).
  const live = frozen ? new Map<string, string | null>() : await soldCondition(ctx, lines.map((l) => l.deliveryLineId));
  const goods = await goodsOf(ctx, lines.map((l) => l.deliveryLineId));
  const shown = (await labelled(ctx, lines)).map((l) => ({ ...l,
    unitCondition: (frozen ? l.unitCondition : live.get(l.deliveryLineId) ?? null) as 'demo' | 'used' | 'damaged' | null,
    goods: goods.get(l.deliveryLineId) ?? { batches: [], units: [] } }));
  return {
    id: r.id, number: r.number, partyId: r.partyId, partyName: names.get(r.partyId) ?? '', businessDate: r.businessDate,
    status: r.status as Status, notes: r.notes, total: r.total as Money,
    shipTo: r.shipToName === null ? null : { name: r.shipToName, address: r.shipToAddress ?? '', stateCode: r.shipToStateCode ?? '' },
    issuer: frozen ? { legalName: r.issuerLegalName ?? '', gstin: r.issuerGstin ?? '', addressLine1: r.issuerAddressLine1 ?? '',
      addressLine2: r.issuerAddressLine2, city: r.issuerCity ?? '', pincode: r.issuerPincode ?? '', stateCode: r.issuerStateCode ?? '' } : null,
    buyer: frozen ? { name: r.buyerName ?? '', gstin: r.buyerGstin, addressLine1: r.buyerAddressLine1, addressLine2: r.buyerAddressLine2,
      city: r.buyerCity, pincode: r.buyerPincode, stateCode: r.buyerStateCode ?? '' } : null,
    placeOfSupply: r.placeOfSupply, taxable: r.taxable as Money, cgst: r.cgst as Money, sgst: r.sgst as Money, igst: r.igst as Money,
    cess: r.cess as Money, roundOff: r.roundOff, lines: shown,
  };
}

/** POST /sales/invoices (invoices:write): a draft of a party's posted deliveries' lines. */
export async function addInvoice(ctx: Ctx, input: In<typeof createInvoice>): Promise<Out<typeof createInvoice>> {
  checkDate(input.businessDate, today());
  await sellingTo(ctx, input.partyId);
  const priceListId = await priceListOf(ctx, input.partyId);
  const lines = await checkedLines(ctx, input.partyId, input.lines, { priceListId, on: input.businessDate });
  const tx = salesTx(ctx);
  const [row] = await tx.insert(invoices).values({ partyId: input.partyId, businessDate: input.businessDate, notes: input.notes,
    owner: ownerOf(ctx, lines), priceListId, ...shipToColumns(input.shipTo) }).returning({ id: invoices.id });
  if (row === undefined) throw new Error('the insert returned no row');
  await tx.insert(invoiceLines).values(stored(lines).map((l) => ({ ...l, invoiceId: row.id })));
  return row;
}

/** PUT /sales/invoices/:id (invoices:write): a draft, rewritten whole. Any override approved for the old one is stale. */
export async function changeInvoice(ctx: Ctx, { id, ...input }: In<typeof updateInvoice>): Promise<Out<typeof updateInvoice>> {
  const now = await invoiceOf(ctx, id, 'invoices:write', true);
  if (now.status !== 'draft') throw wrongStatus(now.status);
  checkDate(input.businessDate, today());
  await sellingTo(ctx, input.partyId);
  const priceListId = await priceListOf(ctx, input.partyId);
  const lines = await checkedLines(ctx, input.partyId, input.lines, { priceListId, on: input.businessDate });
  const tx = salesTx(ctx);
  await tx.update(invoices).set({ partyId: input.partyId, businessDate: input.businessDate, notes: input.notes, ...shipToColumns(input.shipTo),
    owner: ownerOf(ctx, lines), priceListId, overrideVersion: null }).where(eq(invoices.id, id));
  await tx.delete(invoiceLines).where(eq(invoiceLines.invoiceId, id));
  await tx.insert(invoiceLines).values(stored(lines).map((l) => ({ ...l, invoiceId: id })));
  return {};
}

/** DELETE /sales/invoices/:id (invoices:write): a draft only; it never had a number. */
export async function dropInvoice(ctx: Ctx, { id }: In<typeof deleteInvoice>): Promise<Out<typeof deleteInvoice>> {
  const now = await invoiceOf(ctx, id, 'invoices:write', true);
  if (now.status !== 'draft') throw wrongStatus(now.status);
  await salesTx(ctx).delete(invoices).where(eq(invoices.id, id));
  return {};
}
