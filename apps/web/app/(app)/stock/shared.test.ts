// RAD-144: serials typed one a line, and a found unit's chassis number after a comma.
import { expect, it } from 'vitest';
import { serialsFromText, unitsFromText } from './shared.tsx';

it('reads one serial a line, leaving blank lines and spaces out', () => {
  expect(serialsFromText('SN1\n\n  SN2  \n')).toEqual(['SN1', 'SN2']);
  expect(serialsFromText('')).toEqual([]);
});

it('reads a found unit as its serial and, after a comma, its chassis number', () => {
  expect(unitsFromText('SN1, CH-9\nSN2\n  \nSN3 ,  ')).toEqual([
    { serialNo: 'SN1', chassisNo: 'CH-9' }, { serialNo: 'SN2', chassisNo: null }, { serialNo: 'SN3', chassisNo: null },
  ]);
});
