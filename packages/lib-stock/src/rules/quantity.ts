// A quantity follows its unit (M2-10, RC-162): a count (Nos, sets, pairs) is whole, and a weight or a length has at
// most its unit's decimals. Quantities are decimal strings on the wire, like money (ADR-001 §7a), so this counts the
// digits after the point that aren't trailing zeros: "1.50" kg is 1.5, and "2.0" Nos is 2.

const QUANTITY = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;

/** Whether `quantity` is a decimal string with no more decimals than `decimals` allows ("1.5" Nos doesn't fit). */
export function quantityFits(quantity: string, decimals: number): boolean {
  const m = QUANTITY.exec(quantity);
  if (m === null) return false;
  return (m[2] ?? '').slice(1).replace(/0+$/, '').length <= decimals;
}
