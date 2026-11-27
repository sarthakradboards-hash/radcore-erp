import { expect, it } from 'vitest';
import { readUnlock, yearAction, type Year } from './years.ts';

const closed = { id: '00000000-0000-4000-8000-000000000001', at: '2026-05-01T10:00:00.000Z', by: { id: 'u', displayName: 'A' } } as unknown as Year['closed'];
const year = (start: string, isClosed = false): Year => ({ start, label: start.slice(0, 4), closed: isClosed ? closed : null });

it('offers a close only for the earliest open year that has ended, and a reopen only for the latest closed one', () => {
  const years = [year('2027-04-01'), year('2026-04-01'), year('2025-04-01', true), year('2024-04-01', true)];
  const today = '2027-05-10';
  expect(years.map((y) => yearAction(years, y.start, today))).toEqual([null, 'close', 'reopen', null]);
  // A year still running offers nothing, even when it's the earliest open one.
  expect(yearAction(years, '2026-04-01', '2027-03-31')).toBeNull();
  expect(yearAction([year('2026-04-01')], '2026-04-01', '2027-04-01')).toBe('close');
});

it('reads an unlock request from its version, and nothing from a version of another shape', () => {
  const v = { kind: 'reopen_year', through: '2026-12-31', reason: 'Late invoice', lockedThrough: '2027-03-31' };
  expect(readUnlock(v)).toEqual(v);
  expect(readUnlock({ ...v, lockedThrough: null })?.lockedThrough).toBeNull();
  expect(readUnlock({ ...v, kind: 'other' })).toBeNull();
  expect(readUnlock(null)).toBeNull();
});
