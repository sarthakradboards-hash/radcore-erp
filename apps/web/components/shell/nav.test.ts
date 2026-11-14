import { expect, it } from 'vitest';
import { isCurrent, NAV, visibleNav, type NavItem } from './nav.ts';

const items: NavItem[] = [
  { href: '/', label: 'nav.home', perm: null },
  { href: '/sales', label: 'nav.home', perm: 'sales:read' },
  { href: '/admin/users', label: 'nav.home', perm: 'users:read' },
];

it("shows only the entries whose permission the person holds (RC-151)", () => {
  expect(visibleNav(items, ['sales:read']).map((i) => i.href)).toEqual(['/', '/sales']);
  expect(visibleNav(items, []).map((i) => i.href)).toEqual(['/']);
  expect(visibleNav(items, ['sales:read', 'users:read'])).toHaveLength(3);
});

it('never matches a permission by prefix', () => {
  expect(visibleNav(items, ['sales:reader', 'users'])).toHaveLength(1);
});

it('every entry links within the app', () => {
  expect(NAV.every((i) => i.href.startsWith('/') && !i.href.startsWith('//'))).toBe(true);
});

it('marks the admin entry current on any admin page, and Home only on /', () => {
  const home: NavItem = { href: '/', label: 'nav.home', perm: null };
  const admin: NavItem = { href: '/admin/users', label: 'nav.admin', perm: 'users:read', section: '/admin' };
  expect(['/', '/admin/users', '/admin/audit', '/administer'].map((p) => [isCurrent(home, p), isCurrent(admin, p)]))
    .toEqual([[true, false], [false, true], [false, true], [false, false]]);
});

it('shows the admin entry only to a person who may read people', () => {
  expect(visibleNav(NAV, ['session:read']).map((i) => i.href)).toEqual(['/']);
  expect(visibleNav(NAV, ['session:read', 'users:read']).map((i) => i.href)).toEqual(['/', '/admin/users']);
});
