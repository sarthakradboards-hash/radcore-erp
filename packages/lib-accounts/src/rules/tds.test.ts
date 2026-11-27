// RAD-158's TDS sum (ADR-009 §4, §10), without a database. F29: section "contractor, individual" at 1%, single limit
// 30,000.00, yearly limit 1,00,000.00, no-PAN rate 20%.
import { describe, expect, it } from 'vitest';
import { tdsFor, tdsRound, type TdsBooking, type TdsRate } from './tds.ts';
import { dec } from '@radcore/lib-common';

const contractor: TdsRate = { rate: '1', rateNoPan: '20', singleLimit: '30000', yearlyLimit: '100000', limitKind: 'whole' };
const book = (base: string, earlier: TdsBooking[], deducted: string, o: { rate?: TdsRate; noPan?: boolean; payable?: string } = {}) =>
  tdsFor({ base, rate: o.rate ?? contractor, noPan: o.noPan ?? false, earlier, deducted, payable: o.payable ?? base });

describe('tdsFor', () => {
  it('F29: no TDS under both limits; the bill crossing the yearly limit catches up the year; the next deducts the rest', () => {
    expect(book('25000', [], '0').amount).toBe('0.00');
    expect(book('28000', [{ base: '25000', rate: '1' }], '0').amount).toBe('0.00');
    const june = book('50000', [{ base: '25000', rate: '1' }, { base: '28000', rate: '1' }], '0');
    expect(june).toEqual({ rate: '1', noPanRate: false, amount: '1030.00' });
    expect(book('10000', [{ base: '25000', rate: '1' }, { base: '28000', rate: '1' }, { base: '50000', rate: '1' }], '1030').amount).toBe('100.00');
  });
  it('F29’s variant: with no PAN each booking records 20%, so June deducts 20,600.00', () => {
    const june = book('50000', [{ base: '25000', rate: '20' }, { base: '28000', rate: '20' }], '0', { noPan: true });
    expect(june).toEqual({ rate: '20', noPanRate: true, amount: '20600.00' });
  });
  it('deducts a single bill over the single limit, under the yearly one, at this booking’s rate alone', () => {
    expect(book('31000', [], '0').amount).toBe('310.00');
  });
  it('an excess row taxes only the year’s base over the limit', () => {
    const excess: TdsRate = { rate: '0.1', rateNoPan: '5', singleLimit: null, yearlyLimit: '5000000', limitKind: 'excess' };
    expect(book('1000000', [{ base: '4500000', rate: '0.1' }], '0', { rate: excess }).amount).toBe('500.00');
    expect(book('1000000', [{ base: '4500000', rate: '0.1' }, { base: '1000000', rate: '0.1' }], '500', { rate: excess }).amount).toBe('1000.00');
  });
  it('keeps earlier bookings at the rate they recorded when a later rate row applies', () => {
    const july: TdsRate = { ...contractor, rate: '2' };
    expect(book('50000', [{ base: '25000', rate: '1' }, { base: '28000', rate: '1' }], '0', { rate: july }))
      .toEqual({ rate: '2', noPanRate: false, amount: '1530.00' });
  });
  it('never refunds below zero when a PAN arrives mid-year, and never deducts past the amount payable', () => {
    // Deducted at 20% before the PAN came; at 1% now the year's sum is less than what's deducted.
    expect(book('10000', [{ base: '25000', rate: '1' }, { base: '28000', rate: '1' }, { base: '50000', rate: '1' }], '20600').amount).toBe('0.00');
    expect(book('50000', [{ base: '25000', rate: '20' }, { base: '28000', rate: '20' }], '0', { noPan: true, payable: '5000' }).amount)
      .toBe('5000.00');
    expect(book('50000', [], '0', { noPan: true, payable: '5000.60' }).amount).toBe('5000.00');
  });
  it('deducts every booking of a section with no limits', () => {
    expect(book('1000', [], '0', { rate: { rate: '10', rateNoPan: '20', singleLimit: null, yearlyLimit: null, limitKind: 'whole' } }).amount)
      .toBe('100.00');
  });
  it('rounds to the rupee, half up (CA-21)', () => {
    expect(tdsRound(dec('100.50'))).toBe('101.00');
    expect(tdsRound(dec('100.49'))).toBe('100.00');
  });
});
