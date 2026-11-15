// Which GST rate row applies (M2-12, RC-115), as pure rules: no database, clock or I/O (E3).

/** An item's HSN and every shorter code a rate row may be written for: "87116020" → its chapter "87", heading "8711",
 * sub-heading "871160" and itself. */
export function prefixesOf(hsn: string): string[] {
  return [2, 4, 6, 8].filter((n) => n <= hsn.length).map((n) => hsn.slice(0, n));
}

/** Of the rows in force on a date (each started on or before it), the newest start wins, whatever its code's length:
 * v1 let an older long code beat a newer short one (RC-115). A longer code breaks a tie on the same start. */
export function rowInForce<R extends { hsn: string; effectiveFrom: string }>(rows: readonly R[]): R | undefined {
  let best: R | undefined;
  for (const r of rows) {
    if (best === undefined || r.effectiveFrom > best.effectiveFrom
      || (r.effectiveFrom === best.effectiveFrom && r.hsn.length > best.hsn.length)) best = r;
  }
  return best;
}
