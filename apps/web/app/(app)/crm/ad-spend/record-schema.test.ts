// RAD-122: the ad spend dialog's Amount is refused in the screen's words, never thrown on (auditor-3 on #355).
import { expect, it } from 'vitest';
import { recordSchema } from './record-schema.ts';

const base = { on: 'campaign', campaignId: '0193b1c2-3d4e-7f80-9a1b-2c3d4e5f6a70', sourceId: '', fromDate: '2026-11-01', toDate: '2026-11-23', note: '' };
const amountErrors = (amount: string) => {
  const r = recordSchema.safeParse({ ...base, amount });
  return r.success ? [] : r.error.issues.filter((i) => i.path[0] === 'amount').map((i) => i.message);
};

it('refuses an empty or non-numeric amount without throwing', () => {
  expect(amountErrors('')).toEqual(['Enter what was spent.']);
  expect(amountErrors('abc')).not.toEqual([]);
});

it('sends 0 on to the contract, which says to enter what was spent', () => {
  expect(amountErrors('0')).toEqual(['Enter what was spent']);
});

it('takes a real amount', () => {
  expect(recordSchema.safeParse({ ...base, amount: '1250.50' }).success).toBe(true);
});
