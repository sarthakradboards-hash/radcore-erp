import { expect, it } from 'vitest';
import { shownOption } from './picked-field.tsx';

const a = { id: 'a', name: 'Item A' };
const b = { id: 'b', name: 'Item B' };

it('names the record the line holds, so removing the line before it leaves it named right (auditor-3 on #278)', () => {
  // Two lines, A then B. Remove line 1: B's box now sits at index 0, still holding value b. The lookup for the value gives B.
  expect(shownOption(null, b, 'b')).toBe(b);
});

it('names a fresh pick while the value is its id, and the value’s record once the value is something else', () => {
  expect(shownOption(b, a, 'b')).toBe(b);
  expect(shownOption(b, a, 'a')).toBe(a); // a stale pick never outranks the value
  expect(shownOption(null, null, '')).toBeNull(); // a blank line names nothing
});
