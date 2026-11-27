// Input credit (M4-04, RAD-139; ADR-009 §2; RC-014, RC-058; CA-04, CA-05): whether a purchase line's input GST is
// claimed, the one rule bills and expenses both call. Pure, so its unit tests reach every branch (RAD-96).
import { dec, roundMoney, type Money } from '@radcore/lib-common';

/** A supplier's kind for credit (CA-04), from the columns parties have: no GSTIN is unregistered. */
export type SupplierKind = 'regular' | 'composition' | 'unregistered';
/** Why a line claims nothing: the supplier's kind isn't in `gst.credit_from`, its category's credit is blocked
 * (section 17(5)), or its tax heads don't fit the supplier's state. */
export type NoCredit = 'supplier_kind' | 'blocked' | 'state';
export type Credit = { cgst: Money; sgst: Money; igst: Money; reason: NoCredit | null };

export const supplierKind = (p: { gstin: string | null; composition: boolean }): SupplierKind =>
  (p.gstin === null ? 'unregistered' : p.composition ? 'composition' : 'regular');

/** A line's credit: all its tax by head, or none and why. CGST and SGST are claimed only from a supplier in the
 * company's state, IGST only from one in another (ADR-009 §2, F28), so a head that doesn't fit gives none at all. A
 * reverse-charge line's tax is the one we owe, and its supplier's kind is passed over (ADR-010 §4). */
export function inputCredit(l: { tax: { cgst: Money; sgst: Money; igst: Money }; kind: SupplierKind; creditFrom: readonly SupplierKind[];
  blocked: boolean; intraState: boolean; reverseCharge?: boolean }): Credit {
  const none = (reason: NoCredit): Credit => ({ cgst: roundMoney('0'), sgst: roundMoney('0'), igst: roundMoney('0'), reason });
  if (l.reverseCharge !== true && !l.creditFrom.includes(l.kind)) return none('supplier_kind');
  if (l.blocked) return none('blocked');
  const wrong = l.intraState ? dec(l.tax.igst) : dec(l.tax.cgst).plus(dec(l.tax.sgst));
  if (!wrong.isZero()) return none('state');
  return { cgst: l.tax.cgst, sgst: l.tax.sgst, igst: l.tax.igst, reason: null };
}
