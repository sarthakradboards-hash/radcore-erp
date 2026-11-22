import { describe, expect, it } from 'vitest';
import { coveredBy, type ApprovedThrough } from './checks.ts';

// What a held quick bill's approved order override lets its delivery and invoice through on (the architect on RAD-115).
describe('coveredBy', () => {
  const through: ApprovedThrough = { orderId: 'o', kinds: ['over_limit'], after: '1000.00' };
  const result = (codes: string[], after: string) => ({ issues: codes.map((code) => ({ code })), credit: { after } }) as never;
  it('passes issues of an approved kind with no more owed than then', () => {
    expect([coveredBy(through, result([], '0.00')), coveredBy(through, result(['over_limit'], '1000.00')),
      coveredBy(through, result(['over_limit'], '999.99'))]).toEqual([true, true, true]);
  });
  it('refuses a new kind of issue, or more owed than was approved', () => {
    expect([coveredBy(through, result(['overdue'], '500.00')), coveredBy(through, result(['over_limit', 'overdue'], '500.00')),
      coveredBy(through, result(['over_limit'], '1000.01'))]).toEqual([false, false, false]);
  });
});
