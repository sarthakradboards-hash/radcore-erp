import { expect, it } from 'vitest';
import { refundFor } from './refund-choice.ts';

it('sends no refund for none, what is left for all, and the typed amount for part', () => {
  expect(refundFor('none', '5000.00', '', '')).toBeUndefined();
  expect(refundFor('full', '5000.00', '', 'acc')).toEqual({ amount: '5000.00', accountId: 'acc' });
  expect(refundFor('part', '5000.00', '1200', 'acc')).toEqual({ amount: '1200', accountId: 'acc' });
});
