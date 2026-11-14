import { expect, it } from 'vitest';
import { byScreen, type Permission } from './by-screen.ts';

const p = (key: string, module: string): Permission => ({ key, module, label: key });
// The server's order: by module, then by key (lib-platform's permissions.ts).
const PERMS = [
  p('session:read', 'My work'), p('users:read', 'Admin'), p('users:write', 'Admin'), p('roles:read', 'Admin'),
  p('roles:write', 'Admin'), p('audit:read', 'Admin'), p('pii:read', 'Personal data'), p('pay:read', 'Personal data'),
  p('photo_files:read', 'Files'), p('photo_files:write', 'Files'),
];
const shape = (perms: readonly Permission[]) =>
  byScreen(perms).map((g) => [g.screens.length > 0 ? g.screens : g.module, g.permissions.map((x) => x.key)]);

it('groups by the screen each read key opens, its other keys with it, then the rest by module', () => {
  expect(shape(PERMS)).toEqual([
    [['admin.nav.users', 'admin.nav.sessions'], ['users:read', 'users:write']],
    [['admin.nav.roles', 'admin.nav.permissions'], ['roles:read', 'roles:write']],
    [['admin.nav.audit'], ['audit:read']],
    ['My work', ['session:read']],
    ['Personal data', ['pii:read', 'pay:read']],
    ['Files', ['photo_files:read', 'photo_files:write']],
  ]);
});

it('places every key exactly once', () => {
  const keys = byScreen(PERMS).flatMap((g) => g.permissions.map((x) => x.key));
  expect([...keys].sort()).toEqual(PERMS.map((x) => x.key).sort());
});

it('skips a screen whose key the server no longer lists', () => {
  expect(shape(PERMS.filter((x) => x.key !== 'audit:read')).map(([s]) => s)).not.toContainEqual(['admin.nav.audit']);
});
