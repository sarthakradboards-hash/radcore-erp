// RAD-91's contracts: rates read with gst:read and set with gst:write, each naming its notification and a reason.
import { describe, expect, it } from 'vitest';
import { getGstRateInForce, listGstRates, setGstRate } from './contract.ts';

const rate = { hsn: '8711', effectiveFrom: '2025-09-22', rate: '5', source: '9/2025-Central Tax (Rate), Sch I', note: null, reason: 'GST 2.0' };
const ok = (c: { input: { safeParse(v: unknown): { success: boolean } } }, v: unknown) => c.input.safeParse(v).success;

describe('the GST rate contracts', () => {
  it('read with gst:read and set with gst:write', () => {
    expect([listGstRates, getGstRateInForce, setGstRate].map((c) => `${c.method} ${c.path} ${c.perm}`)).toEqual([
      'GET /gst/rates gst:read', 'GET /gst/rates/in-force gst:read', 'PUT /gst/rates gst:write']);
    expect(getGstRateInForce.errors).toEqual(['no_gst_rate']);
  });

  it('take a 2, 4, 6 or 8-digit code, a rate from 0 to 100, its source and a reason', () => {
    expect(['87', '8711', '871160', '87116020', '871', '0'].map((hsn) => ok(setGstRate, { ...rate, hsn }))).toEqual([true, true, true, true, false, false]);
    expect(['0', '5', '18', '40', '12.5', '101', '-1'].map((r) => ok(setGstRate, { ...rate, rate: r }))).toEqual([true, true, true, true, true, false, false]);
    expect([ok(setGstRate, { ...rate, source: ' ' }), ok(setGstRate, { ...rate, reason: undefined }), ok(setGstRate, { ...rate, effectiveFrom: '2025-02-30' })])
      .toEqual([false, false, false]);
  });

  it('look up an item code of 4, 6 or 8 digits on a date', () => {
    expect([ok(getGstRateInForce, { hsn: '87116020', on: '2025-10-01' }), ok(getGstRateInForce, { hsn: '87', on: '2025-10-01' })]).toEqual([true, false]);
  });
});
