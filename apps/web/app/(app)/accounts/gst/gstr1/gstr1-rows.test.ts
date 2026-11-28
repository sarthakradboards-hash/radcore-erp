import { expect, it } from 'vitest';
import { byRate, lastMonth } from './gstr1-rows.ts';

const item = (rate: string) => ({ rate, taxable: '100.00' });

it('makes a row per rate, the document on its first row only', () => {
  const rows = byRate([
    { number: 'INV/1', date: '2026-10-02', items: [item('5'), item('18')] },
    { number: 'INV/2', date: '2026-10-03', items: [item('18')] },
  ]);
  expect(rows.map((r) => [r.doc.number, r.item?.rate, r.first])).toEqual([['INV/1', '5', true], ['INV/1', '18', false], ['INV/2', '18', true]]);
  expect(new Set(rows.map((r) => r.key)).size).toBe(3);
});

it('keeps a document with no items as one row', () => {
  expect(byRate([{ number: null, date: '2026-10-02', items: [] }])).toEqual([{ key: '0--2026-10-02', doc: { number: null, date: '2026-10-02', items: [] }, item: null, first: true }]);
});

it('takes last month, across a year end', () => {
  expect(lastMonth('2026-11-27')).toBe('2026-10');
  expect(lastMonth('2027-01-05')).toBe('2026-12');
});
