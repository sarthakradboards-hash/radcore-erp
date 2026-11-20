// The sales documents' rules, from what the services read (ADR-007 §1, §4; M3-08, RAD-112): which status moves each allows, and
// the bounds on a document's date (RC-111). The services call these with what they read; their unit tests reach every
// branch, so Stryker can judge them.
import { dec, roundMoney, roundRate, type DecimalInput, type Money, type Rate, type SalesOrderStatus, type SalesQuoteStatus } from '@radcore/lib-common';
import { AppError } from '@radcore/lib-platform';

/** The moves each document's service makes (ADR-007 §1). Quotes and orders post nothing, so a CHECK holds the values
 * and these the moves; a posted document's moves are the database's (state_transitions). */
export const QUOTE_MOVES: Readonly<Record<string, readonly SalesQuoteStatus[]>> = {
  draft: ['sent'], sent: ['accepted', 'declined', 'expired'], accepted: [], declined: [], expired: [],
};
export const ORDER_MOVES: Readonly<Record<string, readonly SalesOrderStatus[]>> = {
  draft: ['confirmed'], confirmed: ['closed', 'cancelled'], closed: [], cancelled: [],
};

/** Refuses a move its document doesn't allow: `wrong_status`, naming where it stands. */
export function mayMove(kind: 'quote' | 'order', from: string, to: string): void {
  const moves = kind === 'quote' ? QUOTE_MOVES : ORDER_MOVES;
  if (moves[from]?.includes(to as never) !== true) {
    throw new AppError('wrong_status', `This ${kind} is ${from}, so it can’t be ${to}`);
  }
}

/** Refuses a change to a document that's no longer a draft: `wrong_status`. A confirmed order's lines may change too,
 * through the checks again (§1), so `alsoConfirmed` lets an order through. */
export function mayEdit(kind: 'quote' | 'order', status: string, alsoConfirmed = false): void {
  if (status === 'draft' || (alsoConfirmed && status === 'confirmed')) return;
  throw new AppError('wrong_status', `This ${kind} is ${status}, so it can’t be changed`);
}

/** A document's date bounds (§4): not after today (India's date), and not before the document it comes from. */
export function checkDate(date: string, today: string, source?: { date: string; what: string }): void {
  if (date > today) {
    throw new AppError('date_in_future', 'A document can’t be dated after today',
      [{ path: ['businessDate'], code: 'in_future', message: `Today is ${today}` }]);
  }
  if (source !== undefined && date < source.date) {
    throw new AppError('date_before_source', `It can’t be dated before its ${source.what}`,
      [{ path: ['businessDate'], code: 'before_source', message: `Its ${source.what} is dated ${source.date}` }]);
  }
}

/** A line's rate after its discount, per unit, before GST: what the price check compares with the item's cost (the
 * architect on RAD-111), to a rate's 6 places. */
export const netRate = (rate: DecimalInput, discountPercent: DecimalInput): Rate =>
  roundRate(dec(rate).times(dec('100').minus(dec(discountPercent))).div('100'));

/** One line's taxable value, round(qty × rate less discount, 2), and its GST, round(taxable × rate / 100, 2): what an
 * order totals, and what a delivery line sells for. */
export function lineValues(l: { qty: DecimalInput; rate: DecimalInput; discountPercent: DecimalInput; gstPercent: DecimalInput }):
  { taxable: Money; gst: Money } {
  const taxable = roundMoney(dec(l.qty).times(dec(l.rate)).times(dec('100').minus(dec(l.discountPercent))).div('100'));
  return { taxable, gst: roundMoney(dec(taxable).times(dec(l.gstPercent)).div('100')) };
}

/** What a document's lines come to with GST, each line's figures rounded first. The credit check adds it to what the
 * party owes (M3-07). */
export function totalWithGst(lines: readonly { qty: DecimalInput; rate: DecimalInput; discountPercent: DecimalInput; gstPercent: DecimalInput }[]): Money {
  return roundMoney(lines.reduce((sum, l) => {
    const v = lineValues(l);
    return sum.plus(dec(v.taxable)).plus(dec(v.gst));
  }, dec('0')));
}
