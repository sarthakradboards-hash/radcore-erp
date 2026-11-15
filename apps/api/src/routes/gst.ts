// lib-gst's routes (ADR-001 §6): declarations only. GST rates by date (RAD-91).
import { listRatesPage, putGstRate, rateInForce } from '@radcore/lib-gst';
import { getGstRateInForce, listGstRates, setGstRate } from '@radcore/lib-gst/contract';
import { defineRoute } from '@radcore/lib-platform';

export default [
  defineRoute(listGstRates, listRatesPage),
  defineRoute(getGstRateInForce, rateInForce),
  defineRoute(setGstRate, putGstRate),
];
