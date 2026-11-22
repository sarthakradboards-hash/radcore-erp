// A credit note's figures and rules (M3-10, RAD-114; ADR-007 §6; ADR-006 §4, F9, F25, F26): each line's credit
// against what's left of its invoice line, and whether its date is past section 34's limit for cutting output tax.
// The services call these with what they read; they're pure, and their unit tests reach every branch, so Stryker can
// judge them (RAD-96).
import { dec, isRealDate, roundMoney, type DecimalInput, type Money } from '@radcore/lib-common';
import { AppError } from '@radcore/lib-platform';
import type { LineTax } from './invoice-rules.ts';

/** What's left of an invoice line: the line less every standing credit note on it. `qty` counts goods back only; the
 * figures count every note, and `cost` is what the goods still out went out at. */
export type LineLeft = { qty: DecimalInput; taxable: DecimalInput; cgst: DecimalInput; sgst: DecimalInput; igst: DecimalInput; cost: DecimalInput };

/** A credit note line's figures: its taxable value and tax, and the cost of the goods it takes back (0 for value only). */
export type CreditFigures = LineTax & { cost: Money };

const over = (index: number, field: string, left: DecimalInput): never => {
  throw new AppError('exceeds_invoice', 'A credit note can’t exceed what’s left of its invoice',
    [{ path: ['lines', index, field], code: 'exceeds_invoice', message: `Only ${dec(left).toFixed()} is left on the invoice line` }]);
};

const withTotal = (f: Omit<CreditFigures, 'lineTotal'>): CreditFigures =>
  ({ ...f, lineTotal: roundMoney(dec(f.taxable).plus(dec(f.cgst)).plus(dec(f.sgst)).plus(dec(f.igst))) });

/**
 * One line's credit (ADR-007 §6). Goods back (`qty`): its share of what's left, round(left × qty / qty left, 2) for
 * each figure, the cost included, so goods come back at the value they went out at (RC-207); taking the last of the
 * line clears what's left exactly. Value only (`taxable`): that taxable value, with tax at the line's rate as the
 * invoice worked it, never more than the tax left; crediting all the taxable value left clears the tax left too.
 * Either refuses more than is left (`exceeds_invoice`).
 */
export function creditLine(left: LineLeft, back: { qty: DecimalInput } | { taxable: DecimalInput }, gstPercent: DecimalInput,
  intraState: boolean, index: number): CreditFigures {
  if ('qty' in back) {
    if (dec(back.qty).gt(dec(left.qty))) over(index, 'qty', left.qty);
    const part = (x: DecimalInput): Money => roundMoney(dec(x).times(dec(back.qty)).div(dec(left.qty)));
    return withTotal({ taxable: part(left.taxable), cgst: part(left.cgst), sgst: part(left.sgst), igst: part(left.igst), cost: part(left.cost) });
  }
  if (dec(back.taxable).gt(dec(left.taxable))) over(index, 'taxable', left.taxable);
  const taxable = roundMoney(back.taxable);
  if (dec(taxable).eq(dec(left.taxable))) {
    return withTotal({ taxable, cgst: roundMoney(left.cgst), sgst: roundMoney(left.sgst), igst: roundMoney(left.igst), cost: roundMoney('0') });
  }
  const capped = (x: DecimalInput, cap: DecimalInput): Money => roundMoney(dec(x).gt(dec(cap)) ? dec(cap) : dec(x));
  const half = roundMoney(dec(taxable).times(dec(gstPercent)).div('200'));
  const whole = roundMoney(dec(taxable).times(dec(gstPercent)).div('100'));
  return withTotal({ taxable, cgst: capped(intraState ? half : '0', left.cgst), sgst: capped(intraState ? half : '0', left.sgst),
    igst: capped(intraState ? '0' : whole, left.igst), cost: roundMoney('0') });
}

/** The setting's month and day, 'MM-DD', as a real date in a year that isn't a leap year. */
export const isMonthDay = (md: string): boolean => isRealDate(`2001-${md}`);

/**
 * The last date a credit note may cut its invoice's output tax (section 34(2), CA-10): the first `monthDay` after the
 * end of the invoice's financial year (31 March), so '11-30' gives 30 November following it.
 * shortcut: the annual return's filing date (the earlier of the two) isn't read; M5-08's filing record adds it.
 */
export function taxDeadline(invoiceDate: string, monthDay: string): string {
  const year = Number(invoiceDate.slice(0, 4));
  const yearEnd = invoiceDate.slice(5) >= '04-01' ? year + 1 : year;
  return `${monthDay > '03-31' ? yearEnd : yearEnd + 1}-${monthDay}`;
}

/** Whether a note dated `noteDate` is past its invoice's deadline, so its tax goes to `late_cn_gst` (F25). */
export const isLate = (noteDate: string, invoiceDate: string, monthDay: string): boolean => noteDate > taxDeadline(invoiceDate, monthDay);

/**
 * What a note applies to its invoice as it posts (F9): as much of its total as the invoice is unpaid; the rest is the
 * customer's, for a counter refund (F26), which may not be more (`exceeds_credit`). Checked at draft, so the maker is
 * told (the RAD-114 note), and again as it posts, under the invoice's lock.
 */
export function refundRoom(total: DecimalInput, unpaid: DecimalInput, refund: DecimalInput | null): { applied: Money } {
  const applied = roundMoney(dec(unpaid).lt(dec(total)) ? unpaid : total);
  const left = roundMoney(dec(total).minus(dec(applied)));
  if (refund !== null && dec(refund).gt(dec(left))) {
    throw new AppError('exceeds_credit', 'The refund is more than is left of the credit note once it settles its invoice',
      [{ path: ['refund', 'amount'], code: 'exceeds_credit', message: `${left} is left to refund` }]);
  }
  return { applied };
}
