// RAD-153's reverse-charge rule (ADR-010 §4), without a database.
import { describe, expect, it } from 'vitest';
import { isReverseCharge, type RcmRule } from './reverse-charge.ts';

const rules: RcmRule[] = [
  { prefix: '996791', supplier: 'any', effectiveFrom: '2026-07-01' },
  { prefix: '99852', supplier: 'not_body_corporate', effectiveFrom: '2019-01-01' },
  { prefix: '9988', supplier: 'unregistered', effectiveFrom: '2019-01-01' },
];
const unregistered = { gstin: null, pan: null, overseas: false };
const firm = { gstin: '27AAPFU0939F1ZV', pan: null, overseas: false };
const company = { gstin: '27AAACR5055K1Z5', pan: null, overseas: false };

describe('isReverseCharge', () => {
  it('applies a rule from its own date, not the day before', () => {
    expect([isReverseCharge('996791', firm, '2026-07-01', rules), isReverseCharge('996791', firm, '2026-06-30', rules)]).toEqual([true, false]);
  });
  it('matches the code by prefix, and nothing else', () => {
    expect([isReverseCharge('998521', firm, '2026-07-01', rules), isReverseCharge('9965', firm, '2026-07-01', rules)]).toEqual([true, false]);
  });
  it('reads the supplier condition: unregistered only, or any but a body corporate', () => {
    expect([isReverseCharge('998821', unregistered, '2026-07-01', rules), isReverseCharge('998821', firm, '2026-07-01', rules)]).toEqual([true, false]);
    expect([isReverseCharge('998521', company, '2026-07-01', rules), isReverseCharge('998521', unregistered, '2026-07-01', rules),
      isReverseCharge('998521', { gstin: null, pan: 'AAACR5055K', overseas: false }, '2026-07-01', rules)]).toEqual([false, true, false]);
  });
  it('is always reverse charge from an overseas supplier, whatever the rules say', () => {
    expect(isReverseCharge('998366', { gstin: null, pan: null, overseas: true }, '2026-01-01', [])).toBe(true);
  });
});
