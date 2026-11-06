import { expect, it } from 'vitest';
import { factory } from './index.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const party = factory((f) => ({ id: f.id, name: `Party ${f.tag}`, gstin: null as string | null }));

it('builds a record with a fresh UUID and a unique tag', () => {
  const p = party();
  expect(p.id).toMatch(UUID);
  expect(p.name).toMatch(/^Party [0-9a-f]{16}$/);
  expect(p.gstin).toBeNull();
});

it('never repeats an id or tag, so tests share none', () => {
  const built = Array.from({ length: 1000 }, () => party());
  expect(new Set(built.map((p) => p.id)).size).toBe(1000);
  expect(new Set(built.map((p) => p.name)).size).toBe(1000);
});

it('lets the caller override any field, and the rest stay fresh', () => {
  const p = party({ name: 'Acme Traders', gstin: '29ABCDE1234F1Z5' });
  expect(p).toEqual({ id: expect.stringMatching(UUID), name: 'Acme Traders', gstin: '29ABCDE1234F1Z5' });
  expect(party({ name: 'Acme Traders' }).id).not.toBe(p.id);
});

it('calls build once per record, so no record shares an object with another', () => {
  const withLines = factory((f) => ({ id: f.id, lines: [] as string[] }));
  const a = withLines();
  a.lines.push('x');
  expect(withLines().lines).toEqual([]);
});
