// RAD-98's contracts: drafts written with prices:write, approved with prices:approve, rates and limits checked on the
// way in.
import { describe, expect, it } from 'vitest';
import { priceListApproval, putPriceListRates, setDiscountLimit } from './contract.ts';

const id = '3f2b8c9e-1d4a-4f6b-9c2e-7a1b5d3e9f01';
const item = (n: number) => `3f2b8c9e-1d4a-4f6b-9c2e-${String(n).padStart(12, '0')}`;
const ok = (c: { input: { safeParse(v: unknown): { success: boolean } } }, v: unknown) => c.input.safeParse(v).success;

describe('the price list contracts', () => {
  it('approves price lists under prices:approve, apart from the key that drafts them', () => {
    expect([priceListApproval.listPending, priceListApproval.decide].map((c) => `${c.method} ${c.path} ${c.perm}`)).toEqual([
      'GET /approvals/price-list prices:approve', 'POST /approvals/price-list/:id/decision prices:approve']);
    expect(putPriceListRates.perm).toBe('prices:write');
  });

  it('takes 1 to 500 rates of up to 6 places, each item once, and null to take one out', () => {
    expect([
      { id, rates: [{ itemId: item(1), rate: '0.375' }, { itemId: item(2), rate: null }] },
      { id, rates: [] },
      { id, rates: [{ itemId: item(1), rate: '1' }, { itemId: item(1), rate: '2' }] },
      { id, rates: [{ itemId: item(1), rate: '1.1234567' }] },
      { id, rates: [{ itemId: item(1), rate: '-1' }] },
      { id, rates: Array.from({ length: 501 }, (_, n) => ({ itemId: item(n), rate: '1' })) },
    ].map((v) => ok(putPriceListRates, v))).toEqual([true, false, false, false, false, false]);
  });

  it('sets a limit of 0 to 100% for a role or the default, with a reason', () => {
    expect([
      { role: 'sales', maxPercent: '7.5', reason: 'Diwali' },
      { role: null, maxPercent: null, reason: 'Back to none' },
      { role: 'sales', maxPercent: '100.5', reason: 'x' },
      { role: 'Sales!', maxPercent: '1', reason: 'x' },
      { role: 'sales', maxPercent: '1' },
    ].map((v) => ok(setDiscountLimit, v))).toEqual([true, true, false, false, false]);
  });
});
