// The main menu (RC-151): each entry names the permission its screen needs, and a person sees only the entries they
// hold, so nobody is sent to a screen they can't use. The server still checks every request; this only hides.
// Admin (RAD-57) and each module's screens add their entries here as they land.
import type { PermissionKey } from '@radcore/lib-common';
import type { MessageKey } from '../../lib/i18n/index.ts';

/** `section`: a path prefix whose pages all count as this entry (the admin area's five pages). */
export type NavItem = { href: string; label: MessageKey; perm: PermissionKey | null; section?: string };

export const NAV: readonly NavItem[] = [
  { href: '/', label: 'nav.home', perm: null },
  { href: '/admin/users', label: 'nav.admin', perm: 'users:read', section: '/admin' },
];

export const visibleNav = (items: readonly NavItem[], permissions: readonly string[]): NavItem[] =>
  items.filter((i) => i.perm === null || permissions.includes(i.perm));

/** Whether the screen at `path` belongs to this entry: its own page, or any page in its section. */
export const isCurrent = (item: NavItem, path: string): boolean =>
  path === item.href || (item.section !== undefined && path.startsWith(`${item.section}/`));
