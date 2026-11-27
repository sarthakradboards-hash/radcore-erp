// lib-gst's entry (ADR-001 §2): its services, for the api's route file and for the libraries that charge GST.
export { gstRateFor, listRatesPage, putGstRate, rateInForce } from './services/rates.ts';
export { prefixesOf, rowInForce } from './rules/rates.ts';
// A document's line tax and totals, a sale's and a purchase's alike (RAD-136).
export { lineTax, placeOfSupply, toRupee, totalsOf, type LineTax, type Totals } from './rules/tax.ts';
// Input credit (RAD-139, ADR-009 §2): the one rule bills and expenses call, and the setting it reads.
export { inputCredit, supplierKind, type Credit, type NoCredit, type SupplierKind } from './rules/credit.ts';
export { CREDIT_FROM, creditFrom } from './services/credit.ts';

// This library's settings, for apps/api's catalogue (RAD-132, ADR-001 §8c).
import type { SettingDef } from '@radcore/lib-platform';
import { CREDIT_FROM } from './services/credit.ts';
export const settings: readonly SettingDef<unknown>[] = [CREDIT_FROM];
