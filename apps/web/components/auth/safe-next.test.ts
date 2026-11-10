// RC-097: a crafted next link after sign-in must never send the person to another site.
import { expect, it } from 'vitest';
import { safeNext } from './safe-next.ts';

const ORIGIN = 'https://erp.example.in';

it.each([
  ['/sales/invoices', '/sales/invoices'],
  ['/sales/invoices?status=open#top', '/sales/invoices?status=open#top'],
  ['/a/../b', '/b'],
  ['/%2F%2Fevil.example', '/%2F%2Fevil.example'], // stays a path on this site
])('keeps the same-site path %s', (next, expected) => {
  expect(safeNext(next, ORIGIN)).toBe(expected);
});

it.each([
  'https://evil.example/', 'http://erp.example.in.evil.example/', '//evil.example', '///evil.example',
  '/\\evil.example', '\\\\evil.example', '/\t/evil.example', '/\n/evil.example', 'javascript:alert(1)',
  'evil.example', ' /sales', '', null, undefined, '/sign-in', '/sign-in/second-factor',
  // Dot segments that collapse to "//host" only after parsing (auditor on #87).
  '/..//evil.example', '/.//evil.example', '/a/..//evil.example', '/%2e%2e//evil.example',
])('sends %j home', (next) => {
  expect(safeNext(next, ORIGIN)).toBe('/');
});
