import { describe, expect, it } from 'vitest';
import {
  amountInWords, dec, fitsUnit, formatMoney, formatNumber, lineAmount, moneyString, quantityString, rateString,
  roundMoney, roundQty, roundRate, sum,
} from './index.ts';

describe('RC-008: rates keep more than 2 decimals', () => {
  it('accepts a rate of 0.375 and keeps it exactly', () => {
    expect(rateString().safeParse('0.375').success).toBe(true);
    expect(roundRate('0.375')).toBe('0.375000');
    expect(rateString().safeParse('0.123456').success).toBe(true);
    expect(rateString().safeParse('0.1234567').success).toBe(false);
  });

  it('bills a PO for 100,000 at 0.375 as 37,500.00 (GL-027)', () => {
    expect(lineAmount('100000', '0.375')).toBe('37500.00');
  });

  it('rounds a foreign unit price once per line, not once per unit', () => {
    // 3 units at 0.335: per-unit rounding would give 3 x 0.34 = 1.02; once per line gives 1.005 -> 1.01.
    expect(lineAmount('3', '0.335')).toBe('1.01');
  });
});

describe('RC-215: money maths is decimal, not floating point', () => {
  it('adds 0.1 and 0.2 to exactly 0.30', () => {
    expect(roundMoney(sum(['0.1', '0.2']))).toBe('0.30');
    expect(0.1 + 0.2).not.toBe(0.3); // the float behaviour this replaces
  });

  it('settles a journal "Out by" exactly', () => {
    const debits = sum(['1000.10', '2000.20', '3000.30']);
    const credits = sum(['6000.60']);
    expect(roundMoney(debits.minus(credits))).toBe('0.00');
  });

  it('works past the 2^53 limit of a JavaScript number', () => {
    expect(roundMoney(sum(['9007199254740993.01', '0.01']))).toBe('9007199254740993.02');
  });
});

describe('rounding rules', () => {
  it.each([
    ['2.345', '2.35'], ['2.344', '2.34'], ['-2.345', '-2.35'], ['-0.001', '0.00'], ['1.005', '1.01'], ['7', '7.00'],
  ])('money %s -> %s (half-up, away from zero)', (x, want) => expect(roundMoney(x)).toBe(want));

  it('rounds a quantity to its unit', () => {
    expect(roundQty('1.2345', 3)).toBe('1.235');
    expect(roundQty('2.5', 0)).toBe('3');
    expect(() => roundQty('1', 4)).toThrow(RangeError);
    expect(fitsUnit('1.5', 0)).toBe(false);
    expect(fitsUnit('1.500', 1)).toBe(true);
    expect(fitsUnit('1.25', 2)).toBe(true);
  });

  it.each(['1e5', '0x10', 'Infinity', 'NaN', ' 1', '1.', '.5', '', '1,000'])('refuses "%s" as a number', (x) => {
    expect(() => dec(x)).toThrow(RangeError);
  });
});

describe('wire schemas', () => {
  it.each([
    ['1250.50', true], ['0', true], ['1250.505', false], ['1e3', false], ['12.', false], ['-5.00', false],
    ['1234567890123456.00', true], ['12345678901234567.00', false],
  ])('money "%s" is %s', (x, ok) => expect(moneyString().safeParse(x).success).toBe(ok));

  it('allows a negative amount only where the field is signed', () => {
    expect(moneyString({ signed: true }).safeParse('-0.40').success).toBe(true);
    expect(quantityString().safeParse('-1').success).toBe(false);
    expect(quantityString().safeParse('1.125').success).toBe(true);
    expect(quantityString().safeParse('1.1255').success).toBe(false);
  });

  it('refuses a number where a string is expected', () => {
    expect(moneyString().safeParse(1250.5).success).toBe(false);
  });
});

describe('display, en-IN', () => {
  it('groups in lakh and crore', () => {
    expect(formatMoney('12500000.5')).toBe('₹1,25,00,000.50');
    expect(formatMoney('-1250.5')).toBe('-₹1,250.50');
    expect(formatNumber('100000.375', 3)).toBe('1,00,000.375');
    expect(formatNumber('12', 0)).toBe('12');
  });

  it('formats exactly beyond float precision', () => {
    expect(formatMoney('12345678901234567.89')).toBe('₹12,34,56,78,90,12,34,567.89');
    expect(formatNumber(dec('0.1').plus('0.2'), 2)).toBe('0.30');
  });

  it('refuses a malformed string', () => {
    expect(() => formatMoney('1e5')).toThrow(RangeError);
    expect(() => formatNumber('1', 7)).toThrow(RangeError);
  });

  it('writes the amount in words', () => {
    expect(amountInWords('125000.50')).toBe('One Lakh Twenty Five Thousand Rupees And Fifty Paise Only');
    expect(amountInWords('10000000')).toBe('One Crore Rupees Only');
  });
});
