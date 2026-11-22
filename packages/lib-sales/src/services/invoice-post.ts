// Posting an invoice (M3-09, RAD-113; ADR-007 §4, §7, §9; ADR-006 §1, §4, §6, F6, F7). In ADR-006 §1's order: the
// period, the invoice (its date checked again once locked), the deliveries it bills (by id), then the party, before the
// credit check (and the price check on any line not at its order's price). The company profile is read FOR SHARE and
// frozen onto it with the buyer's details; each line copies the GST rate in force on its date and that rate's source;
// the entry is Dr Debtors (the total), Cr Sales and Output GST, the round-off, and Dr COGS, Cr GDNI for the goods'
// share of what they went out at; the number (INV) is drawn last. Over the checks it needs an approved override.
import { invoiceLines, invoices, salesTx } from '@radcore/db/sales';
import { companyForInvoice, getCompanyProfile, getPartyById, holdParty, holdPeriod, postEntry, type JournalLine } from '@radcore/lib-accounts';
import { dec, moneyString, roundMoney, type Money } from '@radcore/lib-common';
import { gstRateFor } from '@radcore/lib-gst';
import { AppError, defineSeries, defineSetting, nextNumber, requestApproval, versionHash, type Ctx } from '@radcore/lib-platform';
import { itemLabels, soldCondition } from '@radcore/lib-stock';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { postInvoice, requestInvoiceOverride } from '../contract.ts';
import { checkSale, overrideApproval, type OverrideVersion, type SaleCheck } from './checks.ts';
import { deliveredNotInvoiced } from './delivered.ts';
import { checkDate, listRateBeforeTax, netRate, shareOf } from './document-rules.ts';
import { sellingTo, today } from './document-lines.ts';
import { checkInvoiceDate, lineTax, needsBuyerDetails, placeOfSupply, totalsOf, type LineTax } from './invoice-rules.ts';
import { checkedLines, invoiceOf, ownerOf, wrongStatus, type CheckedLine } from './invoices.ts';
import { ISSUE_WORDS } from './order-checks.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;

/** Invoices' numbers (ADR-007 §3): INV/26-27/00001, drawn when an invoice posts. */
export const INVOICE_SERIES = defineSeries('sales.invoice', 'INV', { digits: 5, label: 'Tax invoices' });
/** How many days after its earliest delivery an invoice may be dated (ADR-007 §4): 0 until CA-09 says otherwise. */
export const INVOICE_LAG_DAYS = defineSetting('sales.invoice_lag_days', z.number().int().min(0).max(30), 0, {
  label: 'Invoice lag',
  description: 'How many days after its earliest delivery an invoice may be dated.',
  input: { kind: 'integer' },
});
/** At what amount an unregistered buyer must be named, with their address and state (Rule 46), and whether that's
 * judged on the invoice value or the taxable value: the stricter reading until CA-43 answers. */
export const B2C_DETAILS_LIMIT = defineSetting('sales.b2c_details_limit', moneyString(), roundMoney('50000'), {
  label: 'Unregistered buyer’s details from',
  description: 'At this amount or more, an invoice to an unregistered buyer names them, with their address and state (Rule 46).',
  input: { kind: 'money' },
});
export const B2C_DETAILS_BASIS = defineSetting('sales.b2c_details_basis', z.enum(['invoice_value', 'taxable_value']), 'invoice_value', {
  label: 'Unregistered buyer’s details judged on',
  description: 'Whether that amount is the invoice’s value or its taxable value.',
  input: { kind: 'choice', choices: [{ value: 'invoice_value', label: 'Invoice value' }, { value: 'taxable_value', label: 'Taxable value' }] },
});

type Invoice = Awaited<ReturnType<typeof invoiceOf>>;
type Company = Awaited<ReturnType<typeof companyForInvoice>>;
/** The company profile read plainly, for a read-only path: the same row and the same refusal as companyForInvoice. */
async function companyRead(ctx: Ctx): Promise<Company> {
  const { company } = await getCompanyProfile(ctx);
  if (company === null) throw new AppError('company_profile_incomplete', 'Set the company’s GSTIN, address and state before invoicing');
  return company;
}

/** A party's stored value, as lib-accounts' service answers it to another service: the handler masks answers, never a
 * service's values, so a masked one here is a bug, refused rather than frozen onto an invoice. */
export function plain(v: string | { masked: string } | null): string | null {
  if (v !== null && typeof v === 'object') throw new Error('a party’s stored detail came back masked');
  return v;
}
type Priced = CheckedLine & LineTax & { hsn: string; gstRate: string; gstRateSource: string; cost: Money; deliveryTaxable: Money;
  deliveryGst: Money };

/** The invoice's lines with every figure posting writes: the GST rate in force on its date and its source, the tax by
 * the place of supply, and each line's share of its delivery line's cost and selling value (ADR-006 §4). */
async function priced(ctx: Ctx, inv: Invoice, lines: readonly CheckedLine[], intraState: boolean): Promise<Priced[]> {
  const labels = await itemLabels(ctx, lines.map((l) => l.itemId));
  const out: Priced[] = [];
  for (const l of lines) {
    const hsn = labels.get(l.itemId)?.hsn ?? '';
    const rate = await gstRateFor(ctx, hsn, inv.businessDate);
    const share = (total: string | null, gone: string) => shareOf(total ?? '0', l.sent.qty, { qty: l.gone.qty, share: gone }, l.qty);
    out.push({ ...l, ...lineTax({ ...l, gstPercent: rate.rate }, intraState), hsn, gstRate: rate.rate, gstRateSource: rate.source,
      cost: share(l.sent.value, l.gone.value), deliveryTaxable: share(l.sent.taxable, l.gone.taxable), deliveryGst: share(l.sent.gst, l.gone.gst) });
  }
  return out;
}

/** What an override approves of the invoice: its party, date, ship-to and lines, as plain JSON (RAD-38). */
const figuresOf = (inv: Invoice, lines: readonly CheckedLine[]) => ({ partyId: inv.partyId, businessDate: inv.businessDate,
  shipToStateCode: inv.shipToStateCode, lines: lines.map((l) => ({ deliveryLineId: l.deliveryLineId, qty: l.qty, rate: l.rate,
    discountPercent: l.discountPercent })) });

/** What the invoice asks checkSale (ADR-007 §9): what it adds beyond the deliveries it bills, which delivered-not-
 * invoiced already counts; and a price check only on a line whose rate or discount isn't its order line's, its
 * discount measured from the list's rate (the architect on RAD-113). */
function saleOf(inv: Invoice, lines: readonly Priced[], total: Money, notInvoiced: Money): SaleCheck {
  const replaced = lines.reduce((s, l) => s.plus(dec(l.deliveryTaxable)).plus(dec(l.deliveryGst)), dec('0'));
  return {
    stage: 'invoice', partyId: inv.partyId, on: inv.businessDate, pricedBy: inv.createdBy, notInvoiced,
    adds: roundMoney(dec(total).minus(replaced)),
    lines: lines.map((l) => ({ itemId: l.itemId, locationId: l.delivery.locationId, rate: l.priceChanged ? netRate(l.rate, l.discountPercent) : null,
      listRate: !l.priceChanged || l.listRate === null ? null : listRateBeforeTax(l.listRate, l.listTaxInclusive, l.gstRate) })),
  };
}

/** Everything posting works out, read in the posting's own transaction: the parties, the place of supply, the lines'
 * figures and the totals. Reads only; the override's version and posting both ask it. */
async function workedOut(ctx: Ctx, inv: Invoice, company: Company, o: { forUpdate: boolean; permission: string }) {
  const drafted = await salesTx(ctx).select({ deliveryLineId: invoiceLines.deliveryLineId, qty: invoiceLines.qty, rate: invoiceLines.rate,
    discountPercent: invoiceLines.discountPercent }).from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id)).orderBy(asc(invoiceLines.lineNo));
  const lines = await checkedLines(ctx, inv.partyId, drafted.map((l) => ({ ...l, qty: l.qty as never, rate: l.rate as never,
    discountPercent: l.discountPercent as never })), { ...o, priceListId: inv.priceListId, on: inv.businessDate });
  // Its date against its deliveries before any rate is looked up for it (ADR-007 §4), so the date is what's refused.
  checkInvoiceDate(inv.businessDate, lines.map((l) => l.delivery.businessDate), ctx.settings.get(INVOICE_LAG_DAYS));
  const party = await getPartyById(ctx, { id: inv.partyId });
  const place = placeOfSupply(company.stateCode, party.stateCode, inv.shipToStateCode);
  const figures = await priced(ctx, inv, lines, place.intraState);
  return { lines, company, party, place, figures, totals: totalsOf(figures) };
}

/** The override's spec, for defineApproval with approvalContracts('sales-invoice-override', 'sales:override'). */
export const invoiceOverride = overrideApproval({
  kind: 'sales-invoice-override',
  table: 'invoices',
  parts: ['invoice_lines'],
  async read(ctx, id, { forUpdate }) {
    const sel = salesTx(ctx).select().from(invoices).where(eq(invoices.id, id));
    const [inv] = forUpdate ? await sel.for('update') : await sel;
    // Its maker asks (invoices:write) and someone else decides (sales:override); outside both, there's no such invoice.
    if (inv === undefined || inv.status !== 'draft') return null;
    const asks = ctx.can('invoices:write', { owner: inv.owner });
    if (!asks && !ctx.can('sales:override', { owner: inv.owner })) return null;
    // The approvals list and one request's page read this in a read-only transaction (a GET), where FOR SHARE is refused
    // (e2e-2 on #285), so only a request or decision, which locks the invoice, takes the profile FOR SHARE.
    const company = forUpdate ? await companyForInvoice(ctx) : await companyRead(ctx);
    const w = await workedOut(ctx, inv, company, { forUpdate: false, permission: asks ? 'invoices:write' : 'sales:override' });
    return { figures: figuresOf(inv, w.lines), sale: saleOf(inv, w.figures, w.totals.total, await deliveredNotInvoiced(ctx, inv.partyId)) };
  },
  // It records what was approved; posting the invoice is its maker's next step.
  async approved(ctx, id) {
    const version = await invoiceOverride.version(ctx, id, { forUpdate: false });
    if (version !== null) await salesTx(ctx).update(invoices).set({ overrideVersion: versionHash(version) }).where(eq(invoices.id, id));
  },
  async rejected() {
    // A refused override leaves the invoice a draft, to change or to ask again.
  },
});

/** POST /sales/invoices/:id/override (invoices:write): asks someone holding sales:override to approve the draft's issues. */
export async function askInvoiceOverride(ctx: Ctx, { id }: In<typeof requestInvoiceOverride>): Promise<Out<typeof requestInvoiceOverride>> {
  const now = await invoiceOf(ctx, id, 'invoices:write', true);
  if (now.status !== 'draft') throw wrongStatus(now.status);
  return requestApproval(ctx, invoiceOverride, id);
}

/** The entry (ADR-006 §6, F6, F7): Dr Debtors for the total; Cr Sales and each Output GST; the round-off, a debit when
 * it takes the total down; and the goods' cost from GDNI to COGS. Lines of 0 are left out: each line is above zero. */
function entryLines(partyId: string, t: ReturnType<typeof totalsOf>, cost: Money): JournalLine[] {
  const lines: JournalLine[] = [
    { account: { system: 'debtors' }, partyId, debit: t.total },
    { account: { system: 'sales' }, credit: t.taxable },
    { account: { system: 'output_cgst' }, credit: t.cgst },
    { account: { system: 'output_sgst' }, credit: t.sgst },
    { account: { system: 'output_igst' }, credit: t.igst },
    dec(t.roundOff).isNegative() ? { account: { system: 'round_off' }, debit: roundMoney(dec(t.roundOff).abs()) }
      : { account: { system: 'round_off' }, credit: t.roundOff },
    { account: { system: 'cogs' }, debit: cost },
    { account: { system: 'gdni' }, credit: cost },
  ];
  return lines.filter((l) => dec(l.debit ?? l.credit ?? '0').gt(0));
}

/** POST /sales/invoices/:id/post (invoices:write). */
export async function postInvoiceNow(ctx: Ctx, { id }: In<typeof postInvoice>): Promise<Out<typeof postInvoice>> {
  const tx = salesTx(ctx);
  // Its date first, unlocked, for the period lock; then the invoice, locked, still on that date.
  const held = (await invoiceOf(ctx, id, 'invoices:write')).businessDate;
  await holdPeriod(ctx, held);
  // The issuer's details it freezes. holdPeriod already holds the profile row FOR SHARE (ADR-006 §1 step 1, #260), so
  // they can't change under it; read here, before the documents, refused while the profile isn't set.
  const company = await companyForInvoice(ctx);
  const inv = await invoiceOf(ctx, id, 'invoices:write', true);
  if (inv.status !== 'draft') throw wrongStatus(inv.status, 'posted');
  if (inv.businessDate !== held) throw new AppError('version_changed', 'This invoice changed while it was being posted: post it again');
  checkDate(inv.businessDate, today());
  await sellingTo(ctx, inv.partyId);
  // The deliveries it bills, locked by id, and what's still to invoice on each read again under those locks.
  const w = await workedOut(ctx, inv, company, { forUpdate: true, permission: 'invoices:write' });
  // Rule 46: a registered buyer is named by their GSTIN; an unregistered one needs a name, address and state at the limit.
  const registered = w.party.gstin !== null;
  if (!registered && needsBuyerDetails(w.totals, ctx.settings.get(B2C_DETAILS_LIMIT), ctx.settings.get(B2C_DETAILS_BASIS))
    && (plain(w.party.addressLine1) === null || plain(w.party.city) === null || plain(w.party.pincode) === null)) {
    throw new AppError('buyer_details_required', 'An invoice this size names its buyer: add the party’s address first',
      [{ path: ['partyId'], code: 'buyer_details_required', message: 'Add the address, city and PIN code on the party' }]);
  }
  // ADR-006 §1's step 3: the party, after the documents, so two sales to it take turns at the credit check (ADR-007 §9).
  await holdParty(ctx, inv.partyId);
  const { issues } = await checkSale(ctx, saleOf(inv, w.figures, w.totals.total, await deliveredNotInvoiced(ctx, inv.partyId)));
  if (issues.length > 0) {
    const version: OverrideVersion = { figures: figuresOf(inv, w.lines), issues };
    if (inv.overrideVersion === null || inv.overrideVersion !== versionHash(version)) {
      throw new AppError('needs_override', 'This invoice needs someone else to approve an override before it’s posted',
        issues.map((i) => ({ path: 'line' in i ? ['lines', i.line] : ['partyId'], code: i.code, message: ISSUE_WORDS[i.code] ?? i.code })));
    }
  }
  // The lines' figures first: once the invoice is posted, its lines are fixed (guard_document_line). Each carries its
  // units' condition when they aren't all new, read now (the architect on RAD-112).
  const conditions = await soldCondition(ctx, w.figures.map((f) => f.deliveryLineId));
  for (const f of w.figures) {
    // Cess stays at its default 0 until lib-gst has cess rates (CA-50), so posting writes no cess line.
    await tx.update(invoiceLines).set({ listRate: f.listRate, listVersionId: f.listVersionId, hsn: f.hsn, gstRate: f.gstRate,
      gstRateSource: f.gstRateSource, taxable: f.taxable, cgst: f.cgst,
      sgst: f.sgst, igst: f.igst, lineTotal: f.lineTotal, cost: f.cost,
      deliveryTaxable: f.deliveryTaxable, deliveryGst: f.deliveryGst, unitCondition: conditions.get(f.deliveryLineId) ?? null })
      .where(and(eq(invoiceLines.invoiceId, id), eq(invoiceLines.lineNo, f.lineNo)));
  }
  const cost = roundMoney(w.figures.reduce((s, f) => s.plus(dec(f.cost)), dec('0')));
  const lines = entryLines(inv.partyId, w.totals, cost);
  const entry = lines.length === 0 ? null : await postEntry(ctx, { kind: 'invoice', businessDate: inv.businessDate,
    source: { table: 'invoices', id }, lines });
  const number = await nextNumber(ctx, INVOICE_SERIES, inv.businessDate);
  const c = w.company;
  const p = w.party;
  // Its owner is fixed now, from the deliveries it bills (ADR-007 §7).
  await tx.update(invoices).set({ status: 'posted', number, postedEntryId: entry?.id ?? null, owner: ownerOf(ctx, w.lines),
    issuerLegalName: c.legalName, issuerGstin: c.gstin, issuerAddressLine1: c.addressLine1, issuerAddressLine2: c.addressLine2,
    issuerCity: c.city, issuerPincode: c.pincode, issuerStateCode: c.stateCode,
    buyerName: p.name, buyerGstin: p.gstin, buyerAddressLine1: plain(p.addressLine1), buyerAddressLine2: plain(p.addressLine2),
    buyerCity: plain(p.city), buyerPincode: plain(p.pincode), buyerStateCode: p.stateCode, placeOfSupply: w.place.state,
    taxable: w.totals.taxable, cgst: w.totals.cgst, sgst: w.totals.sgst, igst: w.totals.igst, roundOff: w.totals.roundOff,
    total: w.totals.total }).where(eq(invoices.id, id));
  return { number, total: w.totals.total };
}
