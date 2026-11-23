// RAD-95 (M2-07, ADR-006 §7, RC-063): the books check's comparison, on figures made up for it. The trial balance
// balances; Stock in Hand equals the stock ledger for every item and place, either side missing counting as zero; an
// empty place holds no value; and a place's batches add up to its quantity. Healthy books answer no problems.
import { describe, expect, it } from 'vitest';
import { booksProblems, type BooksFigures } from './books.ts';

const A = '3f2b8c9e-1d4a-4f6b-9c2e-7a1b5d3e9f01';
const STORES = '8c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const DEMO = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const healthy: BooksFigures = {
  trial: { debit: '1200.00', credit: '1200.00' },
  books: [{ itemId: A, locationId: STORES, value: '1000.00' }, { itemId: A, locationId: DEMO, value: '200.00' }],
  ledger: [{ itemId: A, locationId: STORES, qty: '5', value: '1000.00' }, { itemId: A, locationId: DEMO, qty: '1', value: '200.00' }],
  current: [{ itemId: A, locationId: STORES, qty: '5', value: '1000.00' }, { itemId: A, locationId: DEMO, qty: '1', value: '200.00' }],
  batches: [{ itemId: A, locationId: STORES, qty: '5' }, { itemId: A, locationId: DEMO, qty: '1' }],
  grni: { books: '62000.00', lines: [{ itemId: A, receipt: 'GRN/26-27/00001', accrued: '186000.00', open: '62000.00' },
    { itemId: A, receipt: 'GRN/26-27/00002', accrued: '500.00', open: '0.00' }] },
};
const checks = (f: Partial<BooksFigures>) => booksProblems({ ...healthy, ...f }).map((p) => [p.check, p.locationId]);

describe('the books check’s comparison', () => {
  it('finds nothing wrong with books that agree', () => {
    expect(booksProblems(healthy)).toEqual([]);
    expect(booksProblems({ trial: { debit: '0', credit: '0.00' }, books: [], ledger: [], current: [], batches: [], grni: { books: '0', lines: [] } })).toEqual([]);
  });

  it('finds debits that differ from credits', () => {
    expect(checks({ trial: { debit: '1200.00', credit: '1199.99' } })).toEqual([['trial_balance', null]]);
  });

  it('finds Stock in Hand that differs from the stock ledger at an item and place, either side missing', () => {
    expect(checks({ books: [{ itemId: A, locationId: STORES, value: '1000.00' }, { itemId: A, locationId: DEMO, value: '200.01' }] }))
      .toEqual([['stock_value', DEMO]]);
    expect(checks({ books: [{ itemId: A, locationId: STORES, value: '1000.00' }] })).toEqual([['stock_value', DEMO]]);
    expect(checks({ ledger: [{ itemId: A, locationId: STORES, qty: '5', value: '1000.00' }] })).toEqual([['stock_value', DEMO]]);
    // Equal amounts written differently agree.
    expect(checks({ books: [{ itemId: A, locationId: STORES, value: '1000' }, { itemId: A, locationId: DEMO, value: '200.0' }] })).toEqual([]);
  });

  it('finds a place that holds value with nothing in it, now', () => {
    expect(checks({ current: [{ itemId: A, locationId: STORES, qty: '5', value: '1000.00' }, { itemId: A, locationId: DEMO, qty: '0', value: '0.01' }],
      batches: [{ itemId: A, locationId: STORES, qty: '5' }] })).toEqual([['empty_place_value', DEMO]]);
  });

  it('finds batches that don’t add up to the quantity at a place, now', () => {
    expect(checks({ batches: [{ itemId: A, locationId: STORES, qty: '4' }, { itemId: A, locationId: DEMO, qty: '1' }] }))
      .toEqual([['batches', STORES]]);
    expect(checks({ batches: [{ itemId: A, locationId: STORES, qty: '5' }] })).toEqual([['batches', DEMO]]);
  });

  it('finds Goods Received Not Billed whose open receipt lines don’t add up to the books (ADR-006 §7)', () => {
    expect(checks({ grni: { books: '62000.01', lines: healthy.grni.lines } })).toEqual([['grni', null]]);
    expect(checks({ grni: { books: '0', lines: [] } })).toEqual([]);
  });

  it('finds a receipt line cleared past what it accrued, or left with more open than it accrued', () => {
    const line = (open: string) => ({ itemId: A, receipt: 'GRN/26-27/00003', accrued: '100.00', open });
    expect(checks({ grni: { books: '-0.01', lines: [line('-0.01')] } })).toEqual([['grni_line', null]]);
    expect(checks({ grni: { books: '100.01', lines: [line('100.01')] } })).toEqual([['grni_line', null]]);
    expect(checks({ grni: { books: '100', lines: [line('100.00')] } })).toEqual([]);
  });

  it('says what it found in words a person can act on', () => {
    const [problem] = booksProblems({ ...healthy, books: [{ itemId: A, locationId: STORES, value: '1000.00' }] });
    expect(problem).toEqual({ check: 'stock_value', itemId: A, locationId: DEMO,
      message: 'Stock in Hand shows 0.00 for this item and place, the stock ledger 200.00' });
    expect(booksProblems({ ...healthy, grni: { books: '62000.00', lines: [{ itemId: A, receipt: 'GRN/26-27/00001', accrued: '100.00',
      open: '-5' }] } }).map((p) => p.message)).toEqual([
      'A line of GRN/26-27/00001 accrued 100.00 to Goods Received Not Billed, but bills and returns have cleared it to -5.00',
      'Goods Received Not Billed shows 62000.00, but the receipt lines left to bill come to -5.00']);
  });
});
