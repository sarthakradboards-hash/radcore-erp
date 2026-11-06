// RAD-14 proof only: a failing test must turn `ci` red. This branch is never merged.
import { expect, it } from 'vitest';

it('fails on purpose', () => {
  expect(1 + 1).toBe(3);
});
