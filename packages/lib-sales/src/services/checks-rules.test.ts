// RAD-111's checks arithmetic (RC-061, RC-131), pinned at each boundary so a mutant has nowhere to hide.
import { describe, expect, it } from 'vitest';
import { costResult, creditResult, discountPercent, issuesOf, noListRate, overDiscount, type CreditFigures } from './checks-rules.ts';

const base: CreditFigures = { limit: '100000', outstanding: '30000', notInvoiced: '10000', adds: '60000', creditDays: 30, oldestUnpaid: null,
  on: '2026-04-30' };

describe('creditResult', () => {
  it('adds the sale to what the party owes, and is over only past the limit, not at it', () => {
    expect(creditResult(base)).toEqual({ after: '100000.00', overLimit: false, overdue: false });
    expect(creditResult({ ...base, adds: '60000.01' })).toMatchObject({ after: '100000.01', overLimit: true });
    // No limit set is no credit (Sarthak on RAD-111): any amount owed is over, nothing owed isn't.
    expect(creditResult({ ...base, limit: null, outstanding: '0', notInvoiced: '0', adds: '0.01' }).overLimit).toBe(true);
    expect(creditResult({ ...base, limit: null, outstanding: '0', notInvoiced: '0', adds: '0' }).overLimit).toBe(false);
    expect(creditResult({ ...base, limit: '0', outstanding: '0', notInvoiced: '0', adds: '0.01' }).overLimit).toBe(true);
    // Delivered and not yet invoiced counts as owed, alone too.
    expect(creditResult({ ...base, outstanding: '0', notInvoiced: '40000.01' })).toMatchObject({ after: '100000.01', overLimit: true });
  });

  it('is overdue once the oldest unpaid bill is past its days, not on its last day', () => {
    expect(creditResult({ ...base, oldestUnpaid: '2026-03-31' }).overdue).toBe(false); // due on 30 Apr, the sale's day
    expect(creditResult({ ...base, oldestUnpaid: '2026-03-30' }).overdue).toBe(true); // due on 29 Apr
    // 0 days (the default setting): a bill is due the day it's made, so any older one is overdue, and one made today isn't.
    expect([creditResult({ ...base, creditDays: 0, oldestUnpaid: '2026-04-29' }).overdue,
      creditResult({ ...base, creditDays: 0, oldestUnpaid: '2026-04-30' }).overdue]).toEqual([true, false]);
    expect(creditResult({ ...base, oldestUnpaid: null, creditDays: 0 }).overdue).toBe(false);
  });
});

describe('costResult', () => {
  it('is below cost only under the cost, and unknown, never a pass, without one', () => {
    expect([costResult('99.99', '100'), costResult('100', '100'), costResult('100.01', '100'), costResult('100', null)])
      .toEqual(['below_cost', 'ok', 'ok', 'cost_unknown']);
  });
});

describe('discountPercent', () => {
  it('measures the cut off the list rate, to 6 places, and none without a list rate or at it or above', () => {
    expect([discountPercent('1000', '900'), discountPercent('3', '2'), discountPercent('1000', '1000'),
      discountPercent('1000', '1100'), discountPercent(null, '5'), discountPercent('0', '0')])
      .toEqual(['10.000000', '33.333333', '0.000000', '0.000000', '0.000000', '0.000000']);
  });
});

describe('overDiscount', () => {
  it('is over only below list × (1 − limit), exactly, where the rounded percent would say otherwise', () => {
    expect([overDiscount('1000', '900', '10'), overDiscount('1000', '899.99', '10'), overDiscount('1000', '1000', '0'),
      overDiscount('1000', '999.99', '0'), overDiscount(null, '1', '0'), overDiscount('1000', '1100', '0')])
      .toEqual([false, true, false, true, false, false]);
    // 1/3 off a list of 3 is 33.3333333…%: a limit of 33.333333 (the rounded percent) is just short, so it's over.
    expect([overDiscount('3', '2', '33.333333'), discountPercent('3', '2')]).toEqual([true, '33.333333']);
  });
});

describe('noListRate', () => {
  // The architect's #256: a priced line with no list rate needs approval; a line with no price set isn't judged.
  it('is a priced line with no list rate, and nothing else', () => {
    expect([noListRate('10', null), noListRate('10', '12'), noListRate(null, null), noListRate(null, '12')]).toEqual([true, false, false, false]);
  });
});

describe('issuesOf', () => {
  it('names the credit issues first, then each line’s, by its index', () => {
    expect(issuesOf({ overLimit: true, overdue: true }, [
      { cost: 'ok', noListRate: false, overDiscount: false }, { cost: 'below_cost', noListRate: false, overDiscount: true },
      { cost: 'cost_unknown', noListRate: true, overDiscount: false }]))
      .toEqual([{ code: 'over_limit' }, { code: 'overdue' }, { code: 'below_cost', line: 1 }, { code: 'over_discount', line: 1 },
        { code: 'cost_unknown', line: 2 }, { code: 'no_list_rate', line: 2 }]);
    expect(issuesOf({ overLimit: false, overdue: false }, [{ cost: 'ok', noListRate: false, overDiscount: false }])).toEqual([]);
  });
});
