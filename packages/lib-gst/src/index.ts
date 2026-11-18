// lib-gst's entry (ADR-001 §2): its services, for the api's route file and for the libraries that charge GST.
export { gstRateFor, listRatesPage, putGstRate, rateInForce } from './services/rates.ts';
export { prefixesOf, rowInForce } from './rules/rates.ts';
