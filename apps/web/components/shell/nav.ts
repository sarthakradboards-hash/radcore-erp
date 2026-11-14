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
] as const satisfies readonly NavPage[];

export const NAV: readonly NavItem[] = [
  { label: 'nav.home', pages: [{ href: '/', label: 'nav.home', perm: null }] },
  // The owner holds audit:read alone (RAD-35), so Admin opens on the audit trail for them.
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
