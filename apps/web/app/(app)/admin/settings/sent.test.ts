import { expect, it } from 'vitest';
import { sent } from './sent.ts';

const integer = { input: { kind: 'integer' } } as const;

it('sends an integer box as a number, and a blank or non-numeric one as typed so the server refuses it on the field', () => {
  expect(sent(integer, '30')).toBe(30);
  expect(sent(integer, '')).toBe('');
  expect(sent(integer, '  ')).toBe('  ');
  expect(sent(integer, 'abc')).toBe('abc');
});

it('leaves other kinds as typed', () => {
  expect(sent({ input: { kind: 'text' } }, '30')).toBe('30');
  expect(sent({ input: { kind: 'yes_no' } }, true)).toBe(true);
});
