// The main menu (RC-151): each entry names the permission its screen needs, and a person sees only the entries they
// hold, so nobody is sent to a screen they can't use. The server still checks every request; this only hides.
// Admin (RAD-57) and each module's screens add their entries here as they land.
import type { PermissionKey } from '@radcore/lib-common';
import type { MessageKey } from '../../lib/i18n/index.ts';

export type NavItem = { href: string; label: MessageKey; perm: PermissionKey | null };

export const NAV: readonly NavItem[] = [
  { href: '/', label: 'nav.home', perm: null },
];

export const visibleNav = (items: readonly NavItem[], permissions: readonly string[]): NavItem[] =>
  items.filter((i) => i.perm === null || permissions.includes(i.perm));
