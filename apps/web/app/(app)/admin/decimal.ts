// Stored decimals as a person reads them (RAD-99). The API sends rates, prices and percentages at their column's places
// ("1250.500000"); the screens drop the zeros the column adds (e2e on #199 and #230). Exact: decimal.js, never a float.
import { dec } from '@radcore/lib-common';

/** A percentage or other plain figure as written: "5.000000" reads 5, "2.500000" reads 2.5. */
export const asWritten = (x: string): string => dec(x).toFixed();

/** A price: rupees and paise always ("85.50", "2450.00"), and more places only when they hold something ("12.345"). */
export function asPrice(x: string): string {
  const d = dec(x);
  return d.toFixed(Math.max(2, d.decimalPlaces()));
}
