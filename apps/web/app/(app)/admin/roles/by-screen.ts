// The permission editor's groups (RAD-83, Sarthak 14 Nov: screens follow permissions). Each screen is opened by its read
// key (the menu's own list, components/shell/nav.ts), so ticking that key is how a role gets the screen; the same
// resource's other keys (users:read opens People, users:write acts there) sit with it. Screens sharing a key are one
// group. Keys no screen opens yet (files, personal data) follow in the server's module groups.
import type { MessageKey } from '../../../../lib/i18n/index.ts';
import { NAV, type NavPage } from '../../../../components/shell/nav.ts';

export type Permission = { key: string; module: string; label: string };
export type Group = {
  /** The screens this group's view key opens, in menu order; empty for a module group. */
  screens: MessageKey[];
  /** The module's name, for a group of keys no screen opens. */
  module?: string;
  /** The key that opens the screens, first; then the rest. */
  permissions: Permission[];
};

const resource = (key: string) => key.slice(0, key.indexOf(':'));

export function byScreen(permissions: readonly Permission[], pages: readonly NavPage[] = NAV.flatMap((i) => i.pages)): Group[] {
  const groups: Group[] = [];
  const placed = new Set<string>();
  for (const page of pages) {
    if (page.perm === null) continue;
    const same = groups.find((g) => g.permissions[0]?.key === page.perm);
    if (same !== undefined) { same.screens.push(page.label); continue; }
    const view = permissions.find((p) => p.key === page.perm);
    if (view === undefined) continue;
    const rest = permissions.filter((p) => p.key !== view.key && resource(p.key) === resource(view.key) && !placed.has(p.key));
    for (const p of [view, ...rest]) placed.add(p.key);
    groups.push({ screens: [page.label], permissions: [view, ...rest] });
  }
  for (const p of permissions) {
    if (placed.has(p.key)) continue;
    const last = groups.at(-1);
    if (last?.module === p.module) last.permissions.push(p);
    else groups.push({ screens: [], module: p.module, permissions: [p] });
  }
  return groups;
}
