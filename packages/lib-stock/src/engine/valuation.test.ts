// RAD-96 (RC-069): the stock engine's arithmetic without a database, so Stryker can judge it in CI. The figures are
// ADR-006 §8's where it has them (F14, F15 and its variants) and RAD-93's back-dated case; each refusal pins its code,
// its message and its field's message, since a changed message is a change no other test would notice.
import { AppError } from '@radcore/lib-platform';
import { dec, moneyString, quantityString, unitPriceString, type Money } from '@radcore/lib-common';
import { describe, expect, it } from 'vitest';
import { averageIssue, averageOf, estimatedIssue, lowestFrom, position, revaluation, type DateRow } from './valuation.ts';

const q = (s: string) => quantityString().parse(s);
const r = (s: string) => unitPriceString().parse(s);
const m = (s: string): Money => moneyString({ signed: true }).parse(s);
const at = (qty: string, value: string) => ({ qty: dec(qty), value: dec(value) });
const row = (date: string, direction: string, qty: string | null, value: string | null): DateRow => ({ date, direction, qty, value });
/** What a call refuses with, as `code: message / field message`, or its answer. */
const outcome = (fn: () => unknown): unknown => {
  try {
    return fn();
  } catch (e) {
    if (e instanceof AppError) return `${e.code}: ${e.message} / ${e.issues.map((i) => `${i.path.join('.')} ${i.code} ${i.message}`).join('; ')}`;
    throw e;
  }
};

describe('position', () => {
  it('adds ins, takes away outs, counts a revalue in value only, and reads a missing sum as zero', () => {
    const p = position([row('2026-11-10', 'in', '7', '1400'), row('2026-11-11', 'out', '1', '200'),
      row('2026-11-12', 'revalue', '0', '-120'), row('2026-11-13', 'in', null, null)]);
    expect([p.qty.toFixed(), p.value.toFixed()]).toEqual(['6', '1080']);
    const empty = position([]);
    expect([empty.qty.toFixed(), empty.value.toFixed()]).toEqual(['0', '0']);
    const outOnly = position([row('2026-11-10', 'out', null, null), row('2026-11-11', 'out', '2', '50')]);
    expect([outOnly.qty.toFixed(), outOnly.value.toFixed()]).toEqual(['-2', '-50']);
    // A revalue moves no units whatever its quantity reads (the table holds it at 0).
    const revalued = position([row('2026-11-10', 'revalue', '2', '30')]);
    expect([revalued.qty.toFixed(), revalued.value.toFixed()]).toEqual(['0', '30']);
  });
});

describe('lowestFrom', () => {
  // RAD-93's case: 5 in on the 10th, 4 out on the 12th, 10 in on the 13th (one day's rows summed first).
  const rows = [row('2026-11-10', 'in', '5', '500'), row('2026-11-12', 'out', '4', '400'), row('2026-11-13', 'in', '6', '600'),
    row('2026-11-13', 'in', '4', '400'), row('2026-11-13', 'revalue', '0', '9')];
  it('is the lowest level from the date onward, counting the level on the day itself', () => {
    expect(lowestFrom(rows, '2026-11-11').toFixed()).toBe('1');
    expect(lowestFrom(rows, '2026-11-12').toFixed()).toBe('1');
    expect(lowestFrom(rows, '2026-11-10').toFixed()).toBe('1');
    expect(lowestFrom(rows, '2026-11-13').toFixed()).toBe('11');
  });
  it('is the level before everything for a date before every row, and the level now for one after', () => {
    expect(lowestFrom(rows, '2026-11-01').toFixed()).toBe('0');
    expect(lowestFrom(rows, '2026-11-30').toFixed()).toBe('11');
    expect(lowestFrom([], '2026-11-30').toFixed()).toBe('0');
  });
  it('takes a later, lower level over an earlier one, and keeps the first of two equal', () => {
    const dip = [row('2026-11-10', 'in', '5', '5'), row('2026-11-11', 'out', '2', '2'), row('2026-11-12', 'out', '3', '3'),
      row('2026-11-13', 'in', '3', '3')];
    expect(lowestFrom(dip, '2026-11-10').toFixed()).toBe('0');
    expect(lowestFrom(dip, '2026-11-13').toFixed()).toBe('3');
  });
});

describe('estimatedIssue', () => {
  it("takes what's there at its value and the rest at the estimate (F15)", () => {
    expect(estimatedIssue(at('7', '1400'), q('10'), '200')).toBe('2000.00');
    expect(estimatedIssue(at('-3', '-600'), q('2'), '200')).toBe('400.00');
    expect(estimatedIssue(at('0', '0'), q('3'), '33.333333')).toBe('100.00');
    expect(estimatedIssue(at('1', '0.01'), q('2'), '0.005')).toBe('0.02');
  });
  it('refuses with no rate to estimate by', () => {
    expect(outcome(() => estimatedIssue(at('7', '1400'), q('10'), undefined)))
      .toBe('no_estimate: There’s no rate to estimate the stock not yet received / qty no_estimate Only 7 on hand, no earlier receipt here and no purchase price');
  });
});

describe('averageIssue', () => {
  it('takes round(V × q / Q, 2), half up, and all of V when it empties the location (F14)', () => {
    expect(averageIssue(at('7', '1400'), q('1'), dec('7'), '2026-11-15')).toBe('200.00');
    expect(averageIssue(at('3', '100'), q('1'), dec('3'), '2026-11-15')).toBe('33.33');
    expect(averageIssue(at('2', '0.05'), q('1'), dec('2'), '2026-11-15')).toBe('0.03');
    expect(averageIssue(at('9', '1899.99'), q('9'), dec('9'), '2026-11-15')).toBe('1899.99');
  });
  it('takes no more than it may from its date on, but up to that exactly', () => {
    expect(averageIssue(at('15', '1500'), q('1'), dec('1'), '2026-11-11')).toBe('100.00');
    expect(outcome(() => averageIssue(at('15', '1500'), q('2'), dec('1'), '2026-11-11')))
      .toBe('not_enough_stock: There isn’t that much of this item here / qty short Only 1 on hand from 2026-11-11 on');
  });
});

describe('revaluation', () => {
  // F15: Showroom at −3 and −600.00 after the sale; a receipt at 240.00.
  const sold = at('-3', '-600');
  it('leaves the units on hand at the receipt’s rate, or the units still missing at their estimate (F15)', () => {
    expect(revaluation(sold, q('5'), r('240'), m('1200'))).toBe('-120.00');
    expect(revaluation(sold, q('3'), r('240'), m('720'))).toBe('-120.00');
    expect(revaluation(sold, q('2'), r('240'), m('480'))).toBe('-80.00');
    expect(revaluation(sold, q('2'), r('100'), m('200'))).toBe('200.00');
    expect(revaluation(at('-3', '-100'), q('1'), r('10'), m('10'))).toBe('23.33');
  });
  it('is nothing when the location was not below zero', () => {
    expect(revaluation(at('0', '0'), q('5'), r('240'), m('1200'))).toBe('0.00');
    expect(revaluation(at('2', '480'), q('5'), r('240'), m('1200'))).toBe('0.00');
    expect(revaluation(at('2', '400'), q('5'), r('240'), m('1200'))).toBe('0.00');
  });
});

describe('averageOf', () => {
  it("is one place's V / Q, to a rate's 6 places (F13: Stores 3 at 183,750.00)", () => {
    expect(averageOf([at('3', '183750')])).toBe('61250.000000');
    expect(averageOf([at('3', '100')])).toBe('33.333333');
    expect(averageOf([at('3', '200')])).toBe('66.666667');
  });
  it('is ΣV / ΣQ over the places holding stock, leaving out any at zero or below', () => {
    expect(averageOf([at('2', '200'), at('1', '130')])).toBe('110.000000');
    expect(averageOf([at('2', '200'), at('0', '0'), at('-1', '-130'), at('0', '50')])).toBe('100.000000');
  });
  it('is null when nothing is on hand', () => {
    expect(averageOf([])).toBeNull();
    expect(averageOf([at('0', '0')])).toBeNull();
    expect(averageOf([at('-3', '-600')])).toBeNull();
  });
});
