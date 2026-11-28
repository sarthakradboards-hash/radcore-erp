// lib-gst's entry (ADR-001 §2): its services, for the api's route file and for the libraries that charge GST.
export { gstRateFor, listRatesPage, putGstRate, rateInForce } from './services/rates.ts';
export { prefixesOf, rowInForce } from './rules/rates.ts';
// A document's line tax and totals, a sale's and a purchase's alike (RAD-136).
export { lineTax, placeOfSupply, toRupee, totalsOf, type LineTax, type Totals } from './rules/tax.ts';
// Input credit (RAD-139, ADR-009 §2): the one rule bills and expenses call, and the setting it reads.
export { inputCredit, supplierKind, type Credit, type NoCredit, type SupplierKind } from './rules/credit.ts';
export { CREDIT_FROM, creditFrom } from './services/credit.ts';
// Reverse charge (RAD-153, ADR-010 §4): the rule purchases call, and its rules by date.
export { isReverseCharge, type RcmParty, type RcmRule } from './rules/reverse-charge.ts';
export { listRcmRulesAll, putRcmRule, rcmRulesOn } from './services/rcm-rules.ts';
// GSTR-1's settings (RAD-154, ADR-010 §3).
export { B2CL_LIMIT, gstr1Of, HSN_DIGITS } from './services/returns.ts';

// This library's settings, for apps/api's catalogue (RAD-132, ADR-001 §8c).
import type { SettingDef } from '@radcore/lib-platform';
import { CREDIT_FROM } from './services/credit.ts';
import { B2CL_LIMIT, HSN_DIGITS } from './services/returns.ts';
export const settings: readonly SettingDef<unknown>[] = [CREDIT_FROM, B2CL_LIMIT, HSN_DIGITS];
