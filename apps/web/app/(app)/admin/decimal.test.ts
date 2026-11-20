import { expect, it } from 'vitest';
import { asPrice, asWritten } from './decimal.ts';

it('reads a percentage as written, dropping only the zeros the column adds', () => {
  expect(['5.000000', '2.500000', '18', '100', '0.250000', '0.000000'].map(asWritten)).toEqual(['5', '2.5', '18', '100', '0.25', '0']);
});

it('reads a price with paise always, and more places only when they hold something (e2e on #230)', () => {
  expect(['1250.500000', '85.500000', '2450.000000', '12.345000', '0.000000', '7', '1234567.891234'].map(asPrice))
    .toEqual(['1250.50', '85.50', '2450.00', '12.345', '0.00', '7.00', '1234567.891234']);
});
