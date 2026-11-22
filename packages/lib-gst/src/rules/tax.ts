// A document's line tax and totals (ADR-005 §2; ADR-006 F6, F7; ADR-007 §7), the same for a sale (lib-sales' invoices,
// quotes and orders) and a purchase (lib-purchasing's orders, ADR-008 §5): each line's taxable value and tax, split by
// the place of supply, and the totals with the round-off to the rupee. Pure, and their unit tests reach every branch, so
// Stryker can judge them (RAD-96). Moved here from lib-sales' invoice-rules.ts (RAD-136), which re-exports them.
import { dec, roundMoney, type DecimalInput, type Money } from '@radcore/lib-common';

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

/** An amount rounded to the rupee, half up, as an invoice's total is (ADR-005 §2, F7); a delivery's value is counted
 * the same way in the credit check, so a bill paid in full isn't over by its round-off (the architect on RAD-115). */
export const toRupee = (x: DecimalInput): Money => roundMoney(dec(x).toDecimalPlaces(0));

/** The invoice's totals (ADR-005 §2, F7): its lines' sums, and the total rounded to the rupee, half up, so the
 * round-off, total less the lines, is always under 1 either way. */
export type Totals = { taxable: Money; cgst: Money; sgst: Money; igst: Money; linesTotal: Money; roundOff: Money; total: Money };

export function totalsOf(lines: readonly LineTax[]): Totals {
  const add = (pick: (l: LineTax) => Money) => roundMoney(lines.reduce((s, l) => s.plus(dec(pick(l))), dec('0')));
  const linesTotal = add((l) => l.lineTotal);
  const total = toRupee(linesTotal);
  return { taxable: add((l) => l.taxable), cgst: add((l) => l.cgst), sgst: add((l) => l.sgst), igst: add((l) => l.igst), linesTotal,
    roundOff: roundMoney(dec(total).minus(dec(linesTotal))), total };
}
