// RAD-96 (RC-069): the journal's arithmetic without a database, so Stryker can judge it in CI. Each case pins a code
// and its message, since a changed message is a change no other test would notice.
import { AppError } from '@radcore/lib-platform';
import { moneyString, type Money } from '@radcore/lib-common';
import { describe, expect, it } from 'vitest';
import { balancedAmounts, lineAmounts, swapSides, type Sides } from './posting.ts';

const m = (x: string): Money => moneyString({ signed: true }).parse(x);
/** What a call refuses with, as `code: message`, or 'ok'. */
const refusal = (fn: () => unknown): string => {
  try {
    fn();
    return 'ok';
  } catch (e) {
    if (e instanceof AppError) return `${e.code}: ${e.message}`;
    throw e;
  }
};
const BOTH = 'invalid_line: Each line is a debit or a credit above zero, not both';
const NEGATIVE = 'invalid_line: A debit or credit is never below zero';

describe('lineAmounts', () => {
  it('rounds the one side given to money and fills the other with 0.00', () => {
    expect(lineAmounts({ debit: m('100.5') })).toEqual({ debit: '100.50', credit: '0.00' });
    expect(lineAmounts({ credit: m('0.01') })).toEqual({ debit: '0.00', credit: '0.01' });
  });

  it('refuses a line with both sides, neither, a zero side, or a side below zero', () => {
    expect([
      refusal(() => lineAmounts({ debit: m('1'), credit: m('1') })),
      refusal(() => lineAmounts({})),
      refusal(() => lineAmounts({ debit: m('0') })),
      refusal(() => lineAmounts({ debit: m('0'), credit: m('0') })),
      refusal(() => lineAmounts({ debit: m('-5'), credit: m('5') })),
      refusal(() => lineAmounts({ debit: m('5'), credit: m('-5') })),
      refusal(() => lineAmounts({ debit: m('-5') })),
    ]).toEqual([BOTH, BOTH, BOTH, BOTH, NEGATIVE, NEGATIVE, BOTH]);
  });
});

describe('balancedAmounts', () => {
  const dr = (x: string): Sides => ({ debit: m(x) });
  const cr = (x: string): Sides => ({ credit: m(x) });

  it('answers each line’s amounts when the debits equal the credits', () => {
    expect(balancedAmounts([dr('70'), dr('30.25'), cr('100.25')])).toEqual([
      { debit: '70.00', credit: '0.00' }, { debit: '30.25', credit: '0.00' }, { debit: '0.00', credit: '100.25' }]);
  });

  it('refuses an entry of fewer than two lines, or one whose sides differ by even a paisa', () => {
    expect([
      refusal(() => balancedAmounts([])),
      refusal(() => balancedAmounts([dr('1')])),
      refusal(() => balancedAmounts([dr('100'), cr('99.99')])),
      refusal(() => balancedAmounts([dr('100'), cr('100.01')])),
      refusal(() => balancedAmounts([dr('100'), cr('100')])),
    ]).toEqual(['unbalanced: An entry has two lines or more', 'unbalanced: An entry has two lines or more',
      'unbalanced: The debits and credits differ', 'unbalanced: The debits and credits differ', 'ok']);
  });

  it('checks each line before the balance', () => {
    expect(refusal(() => balancedAmounts([dr('1'), { debit: m('1'), credit: m('1') }]))).toBe(BOTH);
  });
});

describe('swapSides', () => {
  it('makes the credit the debit and the debit the credit, rounded to money', () => {
    expect(swapSides({ debit: '250.5', credit: '0' })).toEqual({ debit: '0.00', credit: '250.50' });
    expect(swapSides({ debit: '0', credit: '12' })).toEqual({ debit: '12.00', credit: '0.00' });
  });
});
