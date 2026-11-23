// An invoice's figures and rules (M3-09, RAD-113; ADR-007 §4, §7; ADR-006 §6, F6, F7; ADR-005 §2): each line's taxable
// value and tax, split by the place of supply, the totals with the round-off to the rupee, when an unregistered buyer
// must be named (Rule 46, CA-43), and how late an invoice may follow its deliveries (CA-09). The services call these
// with what they read; they're pure, and their unit tests reach every branch, so Stryker can judge them (RAD-96).
import { addDays, dec, type DecimalInput } from '@radcore/lib-common';
import { AppError } from '@radcore/lib-platform';

// A sale's line tax, place of supply, rounding to the rupee and totals are lib-gst's (rules/tax.ts), where a purchase's
// are worked out too (ADR-008 §5, RAD-136); re-exported here, so every lib-sales caller is unchanged.
export { lineTax, placeOfSupply, toRupee, totalsOf, type LineTax, type Totals } from '@radcore/lib-gst';

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
