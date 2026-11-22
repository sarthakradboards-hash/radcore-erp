// The main menu (RC-151): each entry lists the pages it can lead to and the permission each one needs. A person sees
// an entry only when they may open at least one of its pages, and it takes them to the first such page, so nobody is
// sent to a screen they can't use. The server still checks every request; this only hides.
// Each module's screens add their entries here as they land.
import type { PermissionKey } from '@radcore/lib-common';
import type { MessageKey } from '../../lib/i18n/index.ts';

export type NavPage = { href: string; label: MessageKey; perm: PermissionKey | null };
/** `section`: a path prefix whose pages all count as this entry (the admin area's pages). */
export type NavItem = { label: MessageKey; pages: readonly NavPage[]; section?: string };
/** An entry as one person sees it: where it takes them. */
export type MenuEntry = { href: string; label: MessageKey; section?: string };

/** The admin area's pages, in the order Admin tries them (RAD-57; keys as RAD-35 grants them). */
export const ADMIN_PAGES = [
  { href: '/admin/users', label: 'admin.nav.users', perm: 'users:read' },
  { href: '/admin/roles', label: 'admin.nav.roles', perm: 'roles:read' },
  { href: '/admin/permissions', label: 'admin.nav.permissions', perm: 'roles:read' },
  { href: '/admin/sessions', label: 'admin.nav.sessions', perm: 'users:read' },
  { href: '/admin/audit', label: 'admin.nav.audit', perm: 'audit:read' },
  { href: '/admin/company', label: 'admin.nav.company', perm: 'company:read' },
  { href: '/admin/locations', label: 'admin.nav.locations', perm: 'locations:read' },
  { href: '/admin/items', label: 'admin.nav.items', perm: 'items:read' },
  { href: '/admin/gst-rates', label: 'admin.nav.gst', perm: 'gst:read' },
  { href: '/admin/parties', label: 'admin.nav.parties', perm: 'parties:read' },
  { href: '/admin/price-lists', label: 'admin.nav.prices', perm: 'prices:read' },
  { href: '/admin/price-approvals', label: 'admin.nav.priceApprovals', perm: 'prices:approve' },
  { href: '/admin/discount-limits', label: 'admin.nav.discounts', perm: 'prices:read' },
  { href: '/admin/settings', label: 'admin.nav.settings', perm: 'settings:read' },
  { href: '/admin/number-series', label: 'admin.nav.series', perm: 'settings:read' },
] as const satisfies readonly NavPage[];

/** The accounts area's pages (RAD-100): the journal first, as accounts staff read it most. */
export const ACCOUNTS_PAGES = [
  { href: '/accounts/journal', label: 'books.nav.journal', perm: 'journal:read' },
  { href: '/accounts/chart', label: 'books.nav.chart', perm: 'journal:read' },
] as const satisfies readonly NavPage[];

/** The sales area's pages (RAD-125): quotes first, as an order usually starts from one. */
export const SALES_PAGES = [
  { href: '/sales/quotes', label: 'sales.nav.quotes', perm: 'sales:read' },
  { href: '/sales/orders', label: 'sales.nav.orders', perm: 'sales:read' },
  { href: '/sales/deliveries', label: 'sales.nav.deliveries', perm: 'sales:read' },
  { href: '/sales/delivery-returns', label: 'sales.nav.returns', perm: 'sales:read' },
  { href: '/sales/invoices', label: 'sales.nav.invoices', perm: 'sales:read' },
  { href: '/sales/credit-notes', label: 'sales.nav.credits', perm: 'sales:read' },
  { href: '/sales/quick-bill', label: 'sales.nav.quick', perm: 'invoices:write' },
  { href: '/sales/test-rides', label: 'sales.nav.rides', perm: 'bookings:read' },
  { href: '/sales/bookings', label: 'sales.nav.bookings', perm: 'bookings:read' },
  // Whoever may decide an override, or a credit note: one page, offered under either key (the section menu lists it once).
  { href: '/sales/approvals', label: 'sales.nav.approvals', perm: 'sales:override' },
  { href: '/sales/approvals', label: 'sales.nav.approvals', perm: 'credit_notes:approve' },
] as const satisfies readonly NavPage[];

/** The CRM area's pages (RAD-122): leads first, as the sales team works them most. */
export const CRM_PAGES = [
  { href: '/crm/leads', label: 'crm.nav.leads', perm: 'leads:read' },
  { href: '/crm/lists', label: 'crm.nav.lists', perm: 'leads:setup' },
  { href: '/crm/sources', label: 'crm.nav.sources', perm: 'leads:setup' },
  { href: '/crm/set-aside', label: 'crm.nav.setAside', perm: 'leads:setup' },
] as const satisfies readonly NavPage[];

/** The stock area's pages (RAD-144): counts first, as stores work them most; the queue for those who approve. */
export const STOCK_PAGES = [
  { href: '/stock/counts', label: 'stock.nav.counts', perm: 'stock:read' },
  { href: '/stock/adjustments', label: 'stock.nav.adjustments', perm: 'stock:read' },
  { href: '/stock/approvals', label: 'stock.nav.approvals', perm: 'stock:approve' },
] as const satisfies readonly NavPage[];

export const NAV: readonly NavItem[] = [
  { label: 'nav.home', pages: [{ href: '/', label: 'nav.home', perm: null }] },
  // The owner holds audit:read alone (RAD-35), so Admin opens on the audit trail for them.
  { label: 'nav.sales', pages: SALES_PAGES, section: '/sales' },
  { label: 'nav.crm', pages: CRM_PAGES, section: '/crm' },
  { label: 'nav.stock', pages: STOCK_PAGES, section: '/stock' },
  { label: 'nav.accounts', pages: ACCOUNTS_PAGES, section: '/accounts' },
  { label: 'nav.admin', pages: ADMIN_PAGES, section: '/admin' },
];

/** May this person open the page? */
export const allowed = (page: NavPage, permissions: readonly string[]): boolean =>
  page.perm === null || permissions.includes(page.perm);

/** The menu one person sees: each entry they can use at all, pointing at the first of its pages they may open. */
export function menuFor(items: readonly NavItem[], permissions: readonly string[]): MenuEntry[] {
  return items.flatMap((item) => {
    const page = item.pages.find((p) => allowed(p, permissions));
    if (page === undefined) return [];
    return [{ href: page.href, label: item.label, ...(item.section === undefined ? {} : { section: item.section }) }];
  });
}

/** Whether the screen at `path` belongs to this entry: its own page, or any page in its section. */
export const isCurrent = (entry: MenuEntry, path: string): boolean =>
  path === entry.href || (entry.section !== undefined && path.startsWith(`${entry.section}/`));
