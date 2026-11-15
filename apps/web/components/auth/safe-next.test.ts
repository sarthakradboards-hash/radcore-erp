// RC-097: a crafted next link after sign-in must never send the person to another site.
import { expect, it } from 'vitest';
import { safeNext, signInHref } from './safe-next.ts';

const ORIGIN = 'https://erp.example.in';

it.each([
  ['/sales/invoices', '/sales/invoices'],
  ['/sales/invoices?status=open#top', '/sales/invoices?status=open#top'],
  ['/a/../b', '/b'],
  ['/%2F%2Fevil.example', '/%2F%2Fevil.example'], // stays a path on this site
  ['/%5C/evil.example', '/%5C/evil.example'], // an encoded backslash is a character, not a separator
])('keeps the same-site path %s', (next, expected) => {
  expect(safeNext(next, ORIGIN)).toBe(expected);
});

it.each([
  'https://evil.example/', 'http://erp.example.in.evil.example/', '//evil.example', '///evil.example',
  '/\\evil.example', '\\\\evil.example', '/\t/evil.example', '/\n/evil.example', 'javascript:alert(1)',
  'evil.example', ' /sales', '', null, undefined, '/sign-in', '/sign-in/second-factor',
  // Dot segments that collapse to "//host" only after parsing (auditor on #87).
  '/..//evil.example', '/.//evil.example', '/a/..//evil.example', '/%2e%2e//evil.example',
  // Mixed slashes (coordinator on #87).
  '/\\/evil.example', '//\\evil.example', '/./\\evil.example',
])('sends %j home', (next) => {
  expect(safeNext(next, ORIGIN)).toBe('/');
});

it('sends someone not signed in to sign-in with the page they asked for (RAD-55)', () => {
  expect(signInHref('/admin/users?status=invited')).toBe('/sign-in?next=%2Fadmin%2Fusers%3Fstatus%3Dinvited');
  expect(signInHref('/')).toBe('/sign-in');
  expect(signInHref(null)).toBe('/sign-in');
});

it.each(['//evil.example', 'https://evil.example/', '/..//evil.example', '/\\evil.example', '/sign-in'])(
  'never puts the off-site or looping next %j in the sign-in link', (asked) => {
    expect(signInHref(asked)).toBe('/sign-in');
  });

it('a sign-in link made from a path round-trips through the sign-in page’s own check', () => {
  const next = new URL(signInHref('/sales/invoices?q=a b'), 'https://erp.example.in').searchParams.get('next');
  expect(safeNext(next, 'https://erp.example.in')).toBe('/sales/invoices?q=a%20b');
});
