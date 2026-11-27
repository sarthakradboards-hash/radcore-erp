// lib-gst's routes (ADR-001 §6): declarations only. GST rates by date (RAD-91), reverse-charge rules (RAD-153).
import { listRatesPage, listRcmRulesAll, putGstRate, putRcmRule, rateInForce } from '@radcore/lib-gst';
import { getGstRateInForce, listGstRates, listRcmRules, setGstRate, setRcmRule } from '@radcore/lib-gst/contract';
import { defineRoute } from '@radcore/lib-platform';

export default [
  defineRoute(listGstRates, listRatesPage),
  defineRoute(getGstRateInForce, rateInForce),
  defineRoute(setGstRate, putGstRate),
  defineRoute(listRcmRules, listRcmRulesAll),
  defineRoute(setRcmRule, putRcmRule),
];
