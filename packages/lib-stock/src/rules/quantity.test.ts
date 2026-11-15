// RC-162 (M2-10): a quantity follows its unit. "1.5" Nos doesn't fit; "2.0" Nos and "1.50" kg do.
import { expect, it } from 'vitest';
import { quantityFits } from './quantity.ts';

it('keeps a count whole and a weight to its decimals, ignoring trailing zeros (RC-162)', () => {
  expect(['1', '2.0', '1.5', '0.25'].map((q) => quantityFits(q, 0))).toEqual([true, true, false, false]);
  expect(['1.5', '1.50', '1.505', '1.5050', '-2.125'].map((q) => quantityFits(q, 3))).toEqual([true, true, true, true, true]);
  expect(['1.0001', '01', '1.', '.5', '1e3', '', ' 1'].map((q) => quantityFits(q, 3))).toEqual([false, false, false, false, false, false, false]);
});
