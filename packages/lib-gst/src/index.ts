// lib-gst's entry (ADR-001 §2): its services, for the api's route file and for the libraries that charge GST.
export { gstRateFor, listRatesPage, putGstRate, rateInForce } from './services/rates.ts';
export { prefixesOf, rowInForce } from './rules/rates.ts';
// A document's line tax and totals, a sale's and a purchase's alike (RAD-136).
export { lineTax, placeOfSupply, toRupee, totalsOf, type LineTax, type Totals } from './rules/tax.ts';
