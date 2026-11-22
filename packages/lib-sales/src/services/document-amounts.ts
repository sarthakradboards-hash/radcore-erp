// A quote's or an order's amounts (the architect on RAD-112, ruled on RAD-125), worked out exactly as an invoice's are:
// each line's GST rate in force on the document's date (lib-gst) and its source, the place of supply from the company's
// state and the party's (CA-08; a quote or order names no ship-to), the line's taxable value and tax (invoice-rules'
// lineTax), and the totals rounded to the rupee (totalsOf). A draft's are worked out on read; sending a quote or
// confirming an order stores them, and they're never worked out again.
import { getCompanyProfile, getPartyById } from '@radcore/lib-accounts';
import { dec, roundMoney } from '@radcore/lib-common';
import { gstRateFor } from '@radcore/lib-gst';
import { AppError, type Ctx } from '@radcore/lib-platform';
import { itemLabels } from '@radcore/lib-stock';
import { lineTax, placeOfSupply, totalsOf, type LineTax, type Totals } from './invoice-rules.ts';

type Line = { itemId: string; qty: string; rate: string; discountPercent: string };
export type PricedLine = LineTax & { gstRate: string; gstRateSource: string };
export type Amounts = { placeOfSupply: string; lines: PricedLine[]; totals: Totals };

/** The document's amounts, refused while the company's profile isn't set (no state to judge the place of supply by,
 * RC-112: `company_profile_incomplete`) or a line's item has no GST rate on the date (`no_gst_rate`). */
export async function amountsOf(ctx: Ctx, partyId: string, on: string, lines: readonly Line[], shipToState?: string): Promise<Amounts> {
  const { company } = await getCompanyProfile(ctx);
  if (company === null) {
    throw new AppError('company_profile_incomplete', 'Set the company’s GSTIN, address and state before sending a quote or confirming an order');
  }
  const party = await getPartyById(ctx, { id: partyId });
  const place = placeOfSupply(company.stateCode, party.stateCode, shipToState ?? null);
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

type StoredHeader = { placeOfSupply: string | null; taxable: string | null; cgst: string | null; sgst: string | null; igst: string | null;
  roundOff: string | null; total: string | null };
type StoredLine = { gstRate: string | null; gstRateSource: string | null; taxable: string | null; cgst: string | null; sgst: string | null;
  igst: string | null; lineTotal: string | null };
/** What a read answers. Its tax and totals are null, with `note` saying why, while a draft's can't be worked out. */
type HeaderOut = { placeOfSupply: string | null; taxable: string; cgst: string | null; sgst: string | null; igst: string | null;
  roundOff: string | null; total: string | null; note: string | null };
type LineOut = { gstRate: string | null; gstRateSource: string | null; taxable: string; cgst: string | null; sgst: string | null;
  igst: string | null; lineTotal: string | null };

/** The header columns sending a quote or confirming an order stores. */
export const frozenHeader = (a: Amounts) => ({ placeOfSupply: a.placeOfSupply, taxable: a.totals.taxable, cgst: a.totals.cgst,
  sgst: a.totals.sgst, igst: a.totals.igst, roundOff: a.totals.roundOff, total: a.totals.total });
/** One line's columns it stores. */
export const frozenLine = (l: PricedLine) => ({ gstRate: l.gstRate, gstRateSource: l.gstRateSource, taxable: l.taxable, cgst: l.cgst,
  sgst: l.sgst, igst: l.igst, lineTotal: l.lineTotal });

/** A draft's amounts on read. While its tax can't be worked out (the company's state isn't set, or an item has no GST
 * rate on its date), its taxable values still are, with a note saying what's missing (the architect on RAD-112). */
async function draftAmounts(ctx: Ctx, partyId: string, on: string, lines: readonly Line[]): Promise<{ amounts: HeaderOut; lines: LineOut[] }> {
  const a = await amountsOf(ctx, partyId, on, lines).catch((e: unknown) => {
    if (e instanceof AppError && (e.code === 'company_profile_incomplete' || e.code === 'no_gst_rate')) return e;
    throw e;
  });
  if (!(a instanceof AppError)) return { amounts: { ...frozenHeader(a), note: null }, lines: a.lines.map(frozenLine) };
  const taxed = lines.map((l) => lineTax({ ...l, gstPercent: '0' }, true).taxable);
  const none = { cgst: null, sgst: null, igst: null };
  return {
    amounts: { placeOfSupply: null, taxable: roundMoney(taxed.reduce((sum, t) => sum.plus(dec(t)), dec('0'))), ...none, roundOff: null,
      total: null,
    note: a.code === 'company_profile_incomplete' ? 'Set the company’s state to work out the GST' : a.message },
    lines: taxed.map((taxable) => ({ gstRate: null, gstRateSource: null, taxable, ...none, lineTotal: null })),
  };
}

/** What a read answers: a draft's amounts worked out now, else the ones stored when it was sent or confirmed, each line
 * with its own. */
export async function amountsForRead<L extends Line & StoredLine>(ctx: Ctx, doc: StoredHeader & { status: string; partyId: string;
  businessDate: string }, lines: readonly L[]): Promise<{ amounts: HeaderOut; lines: (L & { amounts: LineOut })[] }> {
  if (doc.status === 'draft') {
    const worked = await draftAmounts(ctx, doc.partyId, doc.businessDate, lines);
    return { amounts: worked.amounts, lines: lines.map((l, i) => ({ ...l, amounts: worked.lines[i] ?? stored(l) })) };
  }
  // The CHECKs hold each set all or none, and every one there once it's sent or confirmed (ck_*_frozen).
  return {
    amounts: { placeOfSupply: doc.placeOfSupply, taxable: doc.taxable ?? '0.00', cgst: doc.cgst, sgst: doc.sgst, igst: doc.igst,
      roundOff: doc.roundOff, total: doc.total, note: null },
    lines: lines.map((l) => ({ ...l, amounts: stored(l) })),
  };
}

const stored = (l: StoredLine): LineOut => ({ gstRate: l.gstRate, gstRateSource: l.gstRateSource, taxable: l.taxable ?? '0.00', cgst: l.cgst,
  sgst: l.sgst, igst: l.igst, lineTotal: l.lineTotal });
