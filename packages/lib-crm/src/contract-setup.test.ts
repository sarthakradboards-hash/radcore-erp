// RAD-110's ad spend contract (e2e-2 on #355): an amount that isn't money is a validation error, the handler's
// invalid_input, never a refine that throws (a 500).
import { readInput } from '@radcore/lib-common';
import { describe, expect, it } from 'vitest';
import { recordAdSpend } from './contract-setup.ts';

const spend = { campaignId: '3f2b8c9e-1d4a-4f6b-9c2e-7a1b5d3e9f01', fromDate: '2026-11-01', toDate: '2026-11-15', amount: '1500.00', note: null };
const read = (body: unknown) => readInput(recordAdSpend, { params: {}, body });

describe('the ad spend contract', () => {
  it('answers invalid_input on the amount for an empty, unparsable or zero amount, and takes a real one', () => {
    for (const amount of ['', 'abc', '0.00']) {
      const r = read({ ...spend, amount });
      expect(r.ok ? 'ok' : [r.error.code, r.error.issues.some((i) => i.path[0] === 'amount')]).toEqual(['invalid_input', true]);
    }
    expect(read(spend).ok).toBe(true);
  });
});
