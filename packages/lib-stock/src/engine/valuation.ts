// The stock engine's arithmetic (ADR-006 §4; RAD-93, moved here unchanged for RAD-96, RC-069): a location's position,
// the lowest running quantity a back-dated issue may take, an issue's value at the average or, beyond what's on hand in
// negative-stock mode, at the estimate, and the revaluation a receipt into negative stock makes. No database, so its
// unit tests reach every branch and Stryker can judge them in CI; stock.ts reads the rows and the estimate.
import { dec, roundMoney, roundRate, type Money, type Quantity, type Rate } from '@radcore/lib-common';
import { AppError } from '@radcore/lib-platform';

/** An item's movements at a location, summed by business date and direction (stock.ts's byDate). */
export type DateRow = { readonly date: string; readonly direction: string; readonly qty: string | null; readonly value: string | null };
/** A location's position: its quantity and value now. */
export type Position = { readonly qty: ReturnType<typeof dec>; readonly value: ReturnType<typeof dec> };

type Summed = Pick<DateRow, 'direction' | 'qty' | 'value'>;
const signedQty = (r: Summed) => (r.direction === 'in' ? dec(r.qty ?? '0') : r.direction === 'out' ? dec(r.qty ?? '0').neg() : dec('0'));
const signedValue = (r: Summed) => (r.direction === 'out' ? dec(r.value ?? '0').neg() : dec(r.value ?? '0'));

/** The position now: quantity and value, the sums of every movement, in posting order (§4). */
export function position(rows: readonly Summed[]): Position {
  return {
    qty: rows.reduce((s, r) => s.plus(signedQty(r)), dec('0')),
    value: rows.reduce((s, r) => s.plus(signedValue(r)), dec('0')),
  };
}

/** The lowest running quantity from `from` onward, in business-date order (§4): a back-dated issue may take no more,
 * so it can't make a later day negative. */
export function lowestFrom(rows: readonly DateRow[], from: string) {
  const nets = new Map<string, ReturnType<typeof dec>>();
  for (const r of rows) nets.set(r.date, (nets.get(r.date) ?? dec('0')).plus(signedQty(r)));
  let run = dec('0');
  let low: ReturnType<typeof dec> | undefined;
  for (const [date, net] of nets) {
    if (date > from && low === undefined) low = run; // the level on `from` itself, with nothing dated that day
    run = run.plus(net);
    if (date >= from) low = low === undefined || run.lt(low) ? run : low;
  }
  return low ?? run;
}

/** A delivery beyond what's on hand, in negative-stock mode (§4, F15): what's there at its value, the rest at the
 * estimate (`rate`, the location's last `in` rate). With no estimate it's refused. */
export function estimatedIssue(on: Position, qty: Quantity, rate: string | undefined): Money {
  const q = dec(qty);
  if (rate === undefined) {
    throw new AppError('no_estimate', 'There’s no rate to estimate the stock not yet received',
      [{ path: ['qty'], code: 'no_estimate', message: `Only ${on.qty.toFixed()} on hand, no earlier receipt here and no purchase price` }]);
  }
  const held = on.qty.gt(0) ? on.qty : dec('0');
  return roundMoney((on.qty.gt(0) ? on.value : dec('0')).plus(q.minus(held).times(dec(rate))));
}

/** An issue at the average (§4): all of what's on hand when it empties the location, else round(V × q / Q, 2). It
 * takes no more than `low`, the quantity it may take from `date` on. */
export function averageIssue(on: Position, qty: Quantity, low: ReturnType<typeof dec>, date: string): Money {
  const q = dec(qty);
  if (q.gt(low)) {
    throw new AppError('not_enough_stock', 'There isn’t that much of this item here',
      [{ path: ['qty'], code: 'short', message: `Only ${low.toFixed()} on hand from ${date} on` }]);
  }
  return q.eq(on.qty) ? roundMoney(on.value) : roundMoney(on.value.times(q).div(on.qty));
}

/** A receipt into negative stock (§4, F15): the revaluation that leaves the units still missing at their estimate, or
 * the units now on hand at the receipt's rate. Zero when the location wasn't below zero. */
export function revaluation(before: Position, qty: Quantity, rate: Rate, value: Money): Money {
  if (!before.qty.lt(0)) return roundMoney('0');
  const after = before.qty.plus(dec(qty));
  const target = after.lte(0) ? roundMoney(before.value.times(after).div(before.qty)) : roundMoney(after.times(dec(rate)));
  return roundMoney(dec(target).minus(before.value.plus(dec(value))));
}

/** The average cost of what's on hand (ADR-006 §4; the architect on RAD-111): ΣV / ΣQ over the positions holding
 * stock, to a rate's 6 places, or null when none does. One position is its own V / Q, and none at Q ≤ 0. */
export function averageOf(positions: readonly Position[]): Rate | null {
  const held = positions.filter((p) => p.qty.gt(0));
  if (held.length === 0) return null;
  const qty = held.reduce((s, p) => s.plus(p.qty), dec('0'));
  const value = held.reduce((s, p) => s.plus(p.value), dec('0'));
  return roundRate(value.div(qty));
}
