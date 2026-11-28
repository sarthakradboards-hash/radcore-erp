import { expect, it } from 'vitest';
import { ACCOUNTS_PAGES, ADMIN_PAGES, allowed, currentHref, isCurrent, menuFor, NAV, PURCHASES_PAGES, SALES_PAGES, type NavItem } from './nav.ts';

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
    ['/admin/sessions', 'users:read'], ['/admin/audit', 'audit:read'], ['/admin/company', 'company:read'],
    ['/admin/locations', 'locations:read'], ['/admin/items', 'items:read'],
    ['/admin/gst-rates', 'gst:read'], ['/admin/rcm-rules', 'gst:read'], ['/admin/parties', 'parties:read'],
    ['/admin/price-lists', 'prices:read'], ['/admin/price-approvals', 'prices:approve'],
    ['/admin/discount-limits', 'prices:read'], ['/admin/po-limits', 'purchasing:read'],
    ['/admin/settings', 'settings:read'], ['/admin/number-series', 'settings:read'],
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

it('shows Accounts on journal:read, opening the journal, and marks it current on its pages only (RAD-100)', () => {
  expect(ACCOUNTS_PAGES.map((p) => [p.href, p.perm])).toEqual([['/accounts/journal', 'journal:read'], ['/accounts/chart', 'journal:read'], ['/accounts/collect', 'receivables:read'],
    ['/accounts/payments', 'payments:read'], ['/accounts/bank', 'bank:read'], ['/accounts/bank/reconciliation', 'bank:read'], ['/accounts/transfers', 'payments:read'], ['/accounts/period', 'books:lock'],
    ['/accounts/period/approvals', 'books:unlock'], ['/accounts/expense-categories', 'journal:read'], ['/accounts/gst/gstr1', 'gst:returns']]);
  const accounts = menuFor(NAV, ['journal:read']).find((e) => e.label === 'nav.accounts');
  expect(accounts?.href).toBe('/accounts/journal');
  expect(menuFor(NAV, ['users:read']).some((e) => e.label === 'nav.accounts')).toBe(false);
  expect(['/accounts/chart', '/accounts/journal/new', '/account/sessions'].map((p) => accounts !== undefined && isCurrent(accounts, p)))
    .toEqual([true, true, false]);
});

it('shows Sales on sales:read, opening quotes, and marks it current on its pages only (RAD-125)', () => {
  expect(SALES_PAGES.map((p) => [p.href, p.perm])).toEqual([['/sales/quotes', 'sales:read'], ['/sales/orders', 'sales:read'], ['/sales/deliveries', 'sales:read'],
    ['/sales/delivery-returns', 'sales:read'], ['/sales/invoices', 'sales:read'], ['/sales/credit-notes', 'sales:read'],
    ['/sales/quick-bill', 'invoices:write'], ['/sales/test-rides', 'bookings:read'], ['/sales/bookings', 'bookings:read'],
    ['/sales/approvals', 'sales:override'], ['/sales/approvals', 'credit_notes:approve']]);
  const sales = menuFor(NAV, ['sales:read']).find((e) => e.label === 'nav.sales');
  expect(sales?.href).toBe('/sales/quotes');
  expect(menuFor(NAV, ['journal:read']).some((e) => e.label === 'nav.sales')).toBe(false);
  expect(['/sales/orders/abc', '/sales/quotes/new', '/accounts/journal'].map((p) => sales !== undefined && isCurrent(sales, p)))
    .toEqual([true, true, false]);
});

it('shows Purchases on purchasing:read, opening the orders, with the goods receipts among its pages and current on them (RAD-143)', () => {
  expect(PURCHASES_PAGES.map((p) => [p.href, p.perm])).toEqual([['/purchases/orders', 'purchasing:read'], ['/purchases/receipts', 'purchasing:read'],
    ['/purchases/bills', 'purchasing:read'], ['/purchases/returns', 'purchasing:read'], ['/purchases/approvals', 'purchasing:approve'], ['/purchases/bills/approvals', 'bills:approve']]);
  // Someone who only approves bills is taken straight to their queue.
  expect(menuFor(NAV, ['bills:approve']).find((e) => e.label === 'nav.purchases')?.href).toBe('/purchases/bills/approvals');
  const purchases = menuFor(NAV, ['purchasing:read']).find((e) => e.label === 'nav.purchases');
  expect(purchases?.href).toBe('/purchases/orders');
  expect(menuFor(NAV, ['sales:read']).some((e) => e.label === 'nav.purchases')).toBe(false);
  expect(['/purchases/receipts/new', '/purchases/orders', '/sales/orders'].map((p) => purchases !== undefined && isCurrent(purchases, p))).toEqual([true, true, false]);
});

it('marks only the closest page of a section as current (e2e-2 on #470)', () => {
  const hrefs = ['/accounts/bank', '/accounts/bank/reconciliation', '/accounts/journal'];
  expect(currentHref(hrefs, '/accounts/bank/reconciliation')).toBe('/accounts/bank/reconciliation');
  expect(currentHref(hrefs, '/accounts/journal/abc')).toBe('/accounts/journal');
  expect(currentHref(hrefs.slice(0, 1), '/accounts/bank/reconciliation')).toBe('/accounts/bank');
  expect(currentHref(hrefs, '/accounts/banking')).toBeUndefined();
});

it('offers expense categories only with both of its keys (e2e-playwright on #466)', () => {
  const page = ACCOUNTS_PAGES.find((p) => p.href === '/accounts/expense-categories');
  expect(page !== undefined && allowed(page, ['journal:read'])).toBe(false);
  expect(page !== undefined && allowed(page, ['journal:read', 'expenses:read'])).toBe(true);
});

it('offers the bank page only with both of its keys (e2e-2 on #439)', () => {
  const bank = ACCOUNTS_PAGES.find((p) => p.href === '/accounts/bank');
  expect(bank !== undefined && allowed(bank, ['bank:read'])).toBe(false);
  expect(bank !== undefined && allowed(bank, ['bank:read', 'money_accounts:read'])).toBe(true);
});
