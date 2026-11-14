import { expect, it } from 'vitest';
import { ADMIN_PAGES, isCurrent, menuFor, NAV, type NavItem } from './nav.ts';

const items: NavItem[] = [
  { label: 'nav.home', pages: [{ href: '/', label: 'nav.home', perm: null }] },
  { label: 'nav.home', pages: [{ href: '/sales', label: 'nav.home', perm: 'sales:read' }] },
  { label: 'nav.admin', pages: [{ href: '/admin/users', label: 'nav.home', perm: 'users:read' }] },
];

it('shows only the entries the person may use (RC-151)', () => {
  expect(menuFor(items, ['sales:read']).map((e) => e.href)).toEqual(['/', '/sales']);
  expect(menuFor(items, []).map((e) => e.href)).toEqual(['/']);
  expect(menuFor(items, ['sales:read', 'users:read'])).toHaveLength(3);
});

it('never matches a permission by prefix', () => {
  expect(menuFor(items, ['sales:reader', 'users'])).toHaveLength(1);
});

it('every page links within the app', () => {
  expect(NAV.flatMap((i) => i.pages).every((p) => p.href.startsWith('/') && !p.href.startsWith('//'))).toBe(true);
});

it('sends Admin to the first admin page the person may open, whichever key they hold', () => {
  const admin = (permissions: string[]) => menuFor(NAV, permissions).find((e) => e.label === 'nav.admin')?.href;
  expect(admin(['session:read'])).toBeUndefined();
  expect(admin(['users:read', 'roles:read', 'audit:read'])).toBe('/admin/users');
  expect(admin(['roles:read'])).toBe('/admin/roles');
  // The owner (RAD-35): the audit trail alone.
  expect(admin(['audit:read', 'pii:read', 'pay:read'])).toBe('/admin/audit');
});

it('lists every admin page with the key its screen reads', () => {
  expect(ADMIN_PAGES.map((p) => [p.href, p.perm])).toEqual([
    ['/admin/users', 'users:read'], ['/admin/roles', 'roles:read'], ['/admin/permissions', 'roles:read'],
    ['/admin/sessions', 'users:read'], ['/admin/audit', 'audit:read'],
  ]);
});

it('marks Admin current on any admin page, and Home only on /', () => {
  const [home, admin] = menuFor(NAV, ['audit:read']);
  expect(home?.href).toBe('/');
  expect(admin?.href).toBe('/admin/audit');
  expect(['/', '/admin/users', '/admin/audit', '/administer'].map((p) =>
    [home !== undefined && isCurrent(home, p), admin !== undefined && isCurrent(admin, p)]))
    .toEqual([[true, false], [false, true], [false, true], [false, false]]);
});
