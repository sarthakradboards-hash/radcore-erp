// An invoice's figures and rules (M3-09, RAD-113; ADR-007 §4, §7; ADR-006 §6, F6, F7; ADR-005 §2): each line's taxable
// value and tax, split by the place of supply, the totals with the round-off to the rupee, when an unregistered buyer
// must be named (Rule 46, CA-43), and how late an invoice may follow its deliveries (CA-09). The services call these
// with what they read; they're pure, and their unit tests reach every branch, so Stryker can judge them (RAD-96).
import { addDays, dec, roundMoney, type DecimalInput, type Money } from '@radcore/lib-common';
import { AppError } from '@radcore/lib-platform';

/** One line's figures: its taxable value, round(qty × rate less discount, 2); within the state CGST and SGST each at half
 * the rate, round(taxable × rate / 2 / 100, 2), so they're always equal; between states IGST at the rate. */
export type LineTax = { taxable: Money; cgst: Money; sgst: Money; igst: Money; lineTotal: Money };

export function lineTax(l: { qty: DecimalInput; rate: DecimalInput; discountPercent: DecimalInput; gstPercent: DecimalInput },
  intraState: boolean): LineTax {
  const taxable = roundMoney(dec(l.qty).times(dec(l.rate)).times(dec('100').minus(dec(l.discountPercent))).div('100'));
  const half = roundMoney(dec(taxable).times(dec(l.gstPercent)).div('200'));
  const whole = roundMoney(dec(taxable).times(dec(l.gstPercent)).div('100'));
  const [cgst, sgst, igst] = intraState ? [half, half, roundMoney('0')] : [roundMoney('0'), roundMoney('0'), whole];
  return { taxable, cgst, sgst, igst, lineTotal: roundMoney(dec(taxable).plus(dec(cgst)).plus(dec(sgst)).plus(dec(igst))) };
}

/** The place of supply (CA-08): the ship-to state where the goods go elsewhere, else the buyer's. Within the company's
 * own state the tax is CGST and SGST; otherwise IGST. */
export function placeOfSupply(companyState: string, buyerState: string, shipToState: string | null): { state: string; intraState: boolean } {
  const state = shipToState ?? buyerState;
  return { state, intraState: state === companyState };
}

/** The invoice's totals (ADR-005 §2, F7): its lines' sums, and the total rounded to the rupee, half up, so the
 * round-off, total less the lines, is always under 1 either way. */
export type Totals = { taxable: Money; cgst: Money; sgst: Money; igst: Money; linesTotal: Money; roundOff: Money; total: Money };

export function totalsOf(lines: readonly LineTax[]): Totals {
  const add = (pick: (l: LineTax) => Money) => roundMoney(lines.reduce((s, l) => s.plus(dec(pick(l))), dec('0')));
  const linesTotal = add((l) => l.lineTotal);
  const total = roundMoney(dec(linesTotal).toDecimalPlaces(0));
  return { taxable: add((l) => l.taxable), cgst: add((l) => l.cgst), sgst: add((l) => l.sgst), igst: add((l) => l.igst), linesTotal,
    roundOff: roundMoney(dec(total).minus(dec(linesTotal))), total };
}

/** Whether an unregistered buyer must be named, with their address and state (Rule 46): at or above the limit, judged on
 * the invoice value or the taxable value as the setting says until CA-43 answers. A registered buyer is always named,
 * by their GSTIN. */
export function needsBuyerDetails(t: { total: DecimalInput; taxable: DecimalInput }, limit: DecimalInput,
  basis: 'invoice_value' | 'taxable_value'): boolean {
  return dec(basis === 'invoice_value' ? t.total : t.taxable).gte(dec(limit));
}

/** An invoice's date against the deliveries it bills (ADR-007 §4): not before any of them (`date_before_source`), and
 * at most `lagDays` after the earliest (`invoice_too_late`), so an old challan can't slip through on a new invoice. */
export function checkInvoiceDate(date: string, deliveryDates: readonly string[], lagDays: number): void {
  const sorted = deliveryDates.toSorted();
  const earliest = sorted[0];
  const latest = sorted.at(-1) ?? date;
  if (date < latest) {
    throw new AppError('date_before_source', 'An invoice can’t be dated before a delivery it bills',
      [{ path: ['businessDate'], code: 'before_source', message: `A delivery on it is dated ${latest}` }]);
  }
  if (earliest !== undefined && date > addDays(earliest, lagDays)) {
    throw new AppError('invoice_too_late', 'This invoice is too long after the goods left',
      [{ path: ['businessDate'], code: 'too_late', message: `Its earliest delivery is dated ${earliest}: invoice it by ${addDays(earliest, lagDays)}` }]);
  }
}

/** Whose an invoice is (ADR-007 §7, the architect on RAD-113): the owner its deliveries share, else (several owners,
 * or none) whoever makes it. */
export function invoiceOwner(deliveryOwners: readonly string[], maker: string): string {
  const owners = new Set(deliveryOwners);
  return owners.size === 1 ? [...owners][0] ?? maker : maker;
}
