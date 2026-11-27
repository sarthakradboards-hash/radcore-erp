// How much TDS a booking deducts (M5-10, RAD-158; ADR-009 §4; CA-18 to CA-21, F29): for one payee and section in one
// financial year, from the year's earlier bookings as each recorded itself. Pure, so its unit tests reach every branch
// (RAD-96); the service reads the rows and the rate in force and writes what this answers.
import { dec, roundMoney, type Decimal, type Money } from '@radcore/lib-common';

/** A section's rate in force on the booking's date (a `tds_rates` row). */
export type TdsRate = { rate: string; rateNoPan: string; singleLimit: string | null; yearlyLimit: string | null; limitKind: 'whole' | 'excess' };
/** One of the year's bookings for this payee and section, net of reversals: its base and the rate it recorded. */
export type TdsBooking = { base: string; rate: string };

/** To the nearest rupee, half up (CA-21), the one rounding TDS takes. */
export const tdsRound = (x: Decimal): Money => roundMoney(x.toDecimalPlaces(0));

/**
 * This booking's deduction (ADR-009 §4):
 * - over the yearly limit, the year's base so far with this booking: each booking at the rate it recorded, on its base
 *   (for `excess`, only its part above the limit), less what's already deducted, never below zero, so the booking that
 *   crosses the limit catches up the earlier ones (F29) and a later rate or PAN change doesn't reprice them;
 * - otherwise, this booking alone over the single limit: this booking at its rate;
 * - a section with neither limit deducts every booking;
 * - never more than the booking's amount payable.
 * The rate this booking records is the no-PAN rate when the payee has no operative PAN (CA-20), judged now.
 */
export function tdsFor(b: { base: string; rate: TdsRate; noPan: boolean; earlier: readonly TdsBooking[]; deducted: string; payable: string }):
  { rate: string; noPanRate: boolean; amount: Money } {
  const rate = b.noPan ? b.rate.rateNoPan : b.rate.rate;
  const at = (base: Decimal, r: string) => base.times(dec(r)).div(100);
  const all: TdsBooking[] = [...b.earlier, { base: b.base, rate }];
  const yearBase = all.reduce((s, x) => s.plus(dec(x.base)), dec('0'));
  const { yearlyLimit, singleLimit } = b.rate;
  let due: Decimal;
  if (yearlyLimit !== null && yearBase.gt(dec(yearlyLimit))) {
    const limit = dec(yearlyLimit);
    let before = dec('0');
    let sum = dec('0');
    for (const x of all) {
      const after = before.plus(dec(x.base));
      // The part of this booking above the limit, for `excess`; all of it, for `whole`.
      const part = b.rate.limitKind === 'whole' ? dec(x.base) : after.minus(before.gt(limit) ? before : limit);
      if (part.gt(0)) sum = sum.plus(at(part, x.rate));
      before = after;
    }
    due = dec(tdsRound(sum)).minus(dec(b.deducted));
  } else if (singleLimit !== null && dec(b.base).gt(dec(singleLimit))) {
    due = dec(tdsRound(at(dec(b.base), rate)));
  } else if (yearlyLimit === null && singleLimit === null) {
    due = dec(tdsRound(at(dec(b.base), rate)));
  } else {
    due = dec('0');
  }
  const capped = due.lt(0) ? dec('0') : due.gt(dec(b.payable)) ? dec(b.payable) : due;
  return { rate, noPanRate: b.noPan, amount: roundMoney(capped) };
}
