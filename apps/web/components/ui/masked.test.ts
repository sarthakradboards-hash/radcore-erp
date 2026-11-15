import { expect, it } from 'vitest';
import { maskedLabel } from './masked.tsx';

it('reads a whole mask as "Hidden", and a last-4 mask with its last 4 (the architect on RAD-40)', () => {
  expect(maskedLabel({ masked: '••••••' })).toBe('Hidden');
  expect(maskedLabel({ masked: '••••••3210' })).toBe('Hidden, ends 3210');
});
