import { expect, it } from 'vitest';
import { NAV, visibleNav, type NavItem } from './nav.ts';

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
