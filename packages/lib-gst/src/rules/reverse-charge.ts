// Reverse charge (M5-03, RAD-153; ADR-010 §4; RC-057, CA-04, CA-06): whether a purchase line's tax is ours to pay, not
// the supplier's. Pure, so its unit tests reach every branch.

/** Which suppliers a rule applies to: those with no GSTIN, any, or any but a body corporate. */
export const RCM_SUPPLIERS = ['unregistered', 'any', 'not_body_corporate'] as const;
export type RcmSupplier = (typeof RCM_SUPPLIERS)[number];
export type RcmRule = { prefix: string; supplier: RcmSupplier; effectiveFrom: string };
export type RcmParty = { gstin: string | null; pan: string | null; overseas: boolean };

/** A company's PAN has C as its fourth letter. shortcut: an LLP's PAN (F, as a firm's) reads as not a body corporate,
 * so the strict reading owes the tax; upgrade when CA-06 says how to tell one from a firm. */
const bodyCorporate = (p: RcmParty): boolean => (p.pan ?? p.gstin?.slice(2, 12) ?? '').charAt(3) === 'C';

const fits = (rule: RcmSupplier, p: RcmParty): boolean =>
  rule === 'any' || (rule === 'unregistered' ? p.gstin === null : !bodyCorporate(p));

/** Whether a line with this SAC (or HSN), from this supplier, on the supplier's invoice date, is reverse charge: always
 * for an overseas supplier (an import of services), else when a rule in force on that date covers its code and the
 * supplier. A rule is never withdrawn, only corrected, so any one started on or before the date counts. */
export const isReverseCharge = (code: string, party: RcmParty, on: string, rules: readonly RcmRule[]): boolean =>
  party.overseas || rules.some((r) => code.startsWith(r.prefix) && r.effectiveFrom <= on && fits(r.supplier, party));
