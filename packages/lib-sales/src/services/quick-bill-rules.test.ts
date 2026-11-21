import { describe, expect, it } from 'vitest';
import { looksLikeCardNumber } from './quick-bill-rules.ts';

describe('looksLikeCardNumber', () => {
  it('finds a Luhn-valid number of 13 to 19 digits, spaces and dashes ignored', () => {
    // Published test numbers (Visa 16, Amex 15, Visa 13), and a Luhn-valid 19.
    expect(['4111 1111 1111 1111', '3782-822463-10005', '4222222222222', '6011 0009 9013 9424 009'].map(looksLikeCardNumber))
      .toEqual([true, true, true, true]);
  });
  it('lets an approval code through: letters, a failed check digit, or a Luhn-valid 12 or 20 digits', () => {
    expect(['A1B2C3', '123456', '4111 1111 1111 1112', '411111111117', '41111111111111111115'].map(looksLikeCardNumber))
      .toEqual([false, false, false, false, false]);
  });
});
