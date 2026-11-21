// A quote's or an order's amounts (the architect on RAD-112, ruled on RAD-125), worked out exactly as an invoice's are:
// each line's GST rate in force on the document's date (lib-gst) and its source, the place of supply from the company's
// state and the party's (CA-08; a quote or order names no ship-to), the line's taxable value and tax (invoice-rules'
// lineTax), and the totals rounded to the rupee (totalsOf). A draft's are worked out on read; sending a quote or
// confirming an order stores them, and they're never worked out again.
import { getCompanyProfile, getPartyById } from '@radcore/lib-accounts';
import { gstRateFor } from '@radcore/lib-gst';
import { AppError, type Ctx } from '@radcore/lib-platform';
import { itemLabels } from '@radcore/lib-stock';
import { lineTax, placeOfSupply, totalsOf, type LineTax, type Totals } from './invoice-rules.ts';

type Line = { itemId: string; qty: string; rate: string; discountPercent: string };
export type PricedLine = LineTax & { gstRate: string; gstRateSource: string };
export type Amounts = { placeOfSupply: string; lines: PricedLine[]; totals: Totals };

/** The document's amounts, refused while the company's profile isn't set (no state to judge the place of supply by,
 * RC-112: `company_profile_incomplete`) or a line's item has no GST rate on the date (`no_gst_rate`). */
export async function amountsOf(ctx: Ctx, partyId: string, on: string, lines: readonly Line[]): Promise<Amounts> {
  const { company } = await getCompanyProfile(ctx);
  if (company === null) {
    throw new AppError('company_profile_incomplete', 'Set the company’s GSTIN, address and state before sending a quote or confirming an order');
  }
  const party = await getPartyById(ctx, { id: partyId });
  const place = placeOfSupply(company.stateCode, party.stateCode, null);
  const labels = await itemLabels(ctx, lines.map((l) => l.itemId));
  const priced: PricedLine[] = [];
  for (const [n, l] of lines.entries()) {
    const rate = await gstRateFor(ctx, labels.get(l.itemId)?.hsn ?? '', on).catch((e: unknown) => {
      throw e instanceof AppError ? new AppError(e.code, e.message, [{ path: ['lines', n, 'itemId'], code: e.code, message: e.message }]) : e;
    });
    priced.push({ ...lineTax({ ...l, gstPercent: rate.rate }, place.intraState), gstRate: rate.rate, gstRateSource: rate.source });
  }
  return { placeOfSupply: place.state, lines: priced, totals: totalsOf(priced) };
}

/** A draft's amounts on read: none while they can't be worked out yet, so the document still opens. */
export function draftAmounts(ctx: Ctx, partyId: string, on: string, lines: readonly Line[]): Promise<Amounts | null> {
  return amountsOf(ctx, partyId, on, lines).catch((e: unknown) => {
    if (e instanceof AppError && (e.code === 'company_profile_incomplete' || e.code === 'no_gst_rate')) return null;
    throw e;
  });
}

type StoredHeader = { placeOfSupply: string | null; taxable: string | null; cgst: string | null; sgst: string | null; igst: string | null;
  roundOff: string | null; total: string | null };
type StoredLine = { gstRate: string | null; gstRateSource: string | null; taxable: string | null; cgst: string | null; sgst: string | null;
  igst: string | null; lineTotal: string | null };
type HeaderOut = { placeOfSupply: string; taxable: string; cgst: string; sgst: string; igst: string; roundOff: string; total: string };
type LineOut = { gstRate: string; gstRateSource: string; taxable: string; cgst: string; sgst: string; igst: string; lineTotal: string };

/** The header columns sending a quote or confirming an order stores. */
export const frozenHeader = (a: Amounts) => ({ placeOfSupply: a.placeOfSupply, taxable: a.totals.taxable, cgst: a.totals.cgst,
  sgst: a.totals.sgst, igst: a.totals.igst, roundOff: a.totals.roundOff, total: a.totals.total });
/** One line's columns it stores. */
export const frozenLine = (l: PricedLine) => ({ gstRate: l.gstRate, gstRateSource: l.gstRateSource, taxable: l.taxable, cgst: l.cgst,
  sgst: l.sgst, igst: l.igst, lineTotal: l.lineTotal });

/** What a read answers: a draft's amounts worked out now, else the ones stored when it was sent or confirmed. */
export async function amountsForRead(ctx: Ctx, doc: StoredHeader & { status: string; partyId: string; businessDate: string },
  lines: readonly (Line & StoredLine)[]): Promise<{ amounts: HeaderOut | null; lines: (LineOut | null)[] }> {
  if (doc.status === 'draft') {
    const a = await draftAmounts(ctx, doc.partyId, doc.businessDate, lines);
    return { amounts: a === null ? null : frozenHeader(a), lines: lines.map((_, i) => {
      const l = a?.lines[i];
      return l === undefined ? null : frozenLine(l);
    }) };
  }
  // The CHECKs hold each set all or none (ck_*_frozen), so its total says whether it's there.
  const s = (v: string | null) => v ?? '';
  const h = doc;
  return {
    amounts: h.total === null ? null : { placeOfSupply: s(h.placeOfSupply), taxable: s(h.taxable), cgst: s(h.cgst), sgst: s(h.sgst),
      igst: s(h.igst), roundOff: s(h.roundOff), total: h.total },
    lines: lines.map((l) => (l.lineTotal === null ? null : { gstRate: s(l.gstRate), gstRateSource: s(l.gstRateSource), taxable: s(l.taxable),
      cgst: s(l.cgst), sgst: s(l.sgst), igst: s(l.igst), lineTotal: l.lineTotal })),
  };
}
