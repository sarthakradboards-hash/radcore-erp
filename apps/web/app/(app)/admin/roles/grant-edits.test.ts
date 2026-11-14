import { expect, it } from 'vitest';
import { flip, withEdits, type GrantEdits } from './grant-edits.ts';

const set = (...keys: string[]) => new Set(keys);
const sorted = (s: Set<string>) => [...s].sort();

it('lays the person\'s ticks and unticks over the saved grants', () => {
  const saved = set('session:read', 'users:read');
  let edits: GrantEdits = new Map();
  edits = flip(saved, edits, 'audit:read');
  edits = flip(saved, edits, 'users:read');
  expect(sorted(withEdits(saved, edits))).toEqual(['audit:read', 'session:read']);
});

it('forgets an edit flipped back to what is saved', () => {
  const saved = set('session:read');
  expect(flip(saved, flip(saved, new Map(), 'audit:read'), 'audit:read').size).toBe(0);
});

it('keeps another admin\'s newer change after a reload, changing only what this person chose (matrix_changed)', () => {
  const before = set('session:read', 'users:read');
  const edits = flip(before, new Map(), 'audit:read'); // this person ticks the audit trail
  const after = set('session:read', 'users:read', 'roles:read'); // meanwhile someone else gave roles:read
  expect(sorted(withEdits(after, edits))).toEqual(['audit:read', 'roles:read', 'session:read', 'users:read']);
  const unticked = flip(before, new Map(), 'users:read'); // or this person unticks people
  expect(sorted(withEdits(set('session:read', 'roles:read'), unticked))).toEqual(['roles:read', 'session:read']);
});
