// Roles, the permission matrix, and a person's role (M1-18, RAD-36, RC-033, RC-095). Nobody gives themselves more
// power:
// - only an admin gives or takes away the admin role, and nobody changes their own role;
// - nobody gives a role, or takes one away, unless they hold every key it holds (the auditor on #139), so no role
//   passes on, or takes away, keys the caller doesn't hold;
// - the admin role isn't edited (it holds every key), nor the caller's own role;
// - nobody grants or removes a key they don't hold;
// - no role loses the signed-in basics, and a key kept for named roles goes to no other (D-20: pay).
// Every key is read fresh on each request and job (RAD-35), so a change applies at once in every process, and each one
// is audited through the roles, role_grants and users triggers, each row pointing at the typed reason, which the
// handler keeps first (change-reasons.ts).
import { createHash } from 'node:crypto';
import { platformTx, roleGrants, roles, roleTemplates, users } from '@radcore/db/platform';
import { and, asc, count, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import type { getPermissionMatrix, listRoles, setRolePermissions, setUserRole } from '../contract.ts';
import type { Ctx } from '../ctx.ts';
import { AppError } from '../errors.ts';
import { PERMISSIONS, SIGNED_IN_BASICS } from '../permissions.ts';
import { principalFor } from './principal.ts';
import { afterGrantsChanged } from './role-rules.ts';
import { endSessionsOf } from './sessions.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;
export type Tx = ReturnType<typeof platformTx>;

export const ADMIN = 'admin';
export const CATALOG = new Map(PERMISSIONS.map((p) => [p.key, p]));

/** The signed-in caller, with their role and keys read now, in this transaction, rather than taken from the
 * request's principal: a change in between (another admin demoting them) counts. */
export async function callerOf(ctx: Ctx): Promise<{ userId: string; role: string; permissions: readonly string[] }> {
  if (ctx.principal.kind !== 'user') throw new AppError('forbidden', 'Only a signed-in person can change roles');
  const { userId } = ctx.principal;
  const me = await principalFor(ctx, userId);
  if (me?.kind !== 'user' || me.role === undefined) throw new AppError('signed_out', 'Please sign in');
  return { userId, role: me.role, permissions: me.permissions };
}

/** Each role's keys. */
async function keysByRole(tx: Tx): Promise<Map<string, string[]>> {
  const byRole = new Map<string, string[]>();
  for (const g of await tx.select({ role: roleGrants.role, permission: roleGrants.permission }).from(roleGrants)) {
    byRole.set(g.role, [...(byRole.get(g.role) ?? []), g.permission]);
  }
  return byRole;
}

/** Whether the caller may give this role to someone, or take it away: only an admin for admin, and only someone who
 * holds every key the role holds, so nobody passes on a key they don't have. */
const mayGive = (caller: { role: string; permissions: readonly string[] }, role: string, keys: readonly string[]) =>
  (role !== ADMIN || caller.role === ADMIN) && keys.every((k) => caller.permissions.includes(k));

/** The matrix's version: the SHA-256 of every grant. Any write changes it, so a stale editor is caught. */
export async function matrixVersion(tx: Tx): Promise<string> {
  const rows = await tx.select({ role: roleGrants.role, permission: roleGrants.permission, scope: roleGrants.scope })
    .from(roleGrants).orderBy(asc(roleGrants.role), asc(roleGrants.permission));
  return createHash('sha256').update(rows.map((r) => `${r.role} ${r.permission} ${r.scope}`).join('\n')).digest('hex');
}

const keyIssues = (grants: readonly string[], bad: readonly string[], code: string, message: (k: string) => string) =>
  grants.flatMap((k, i) => (bad.includes(k) ? [{ path: ['grants', i], code, message: message(k) }] : []));

/** GET /admin/roles (roles:read): every role, with how many people hold it and whether the caller may give it. */
export async function listRolesFor(ctx: Ctx): Promise<Out<typeof listRoles>> {
  const caller = await callerOf(ctx);
  const tx = platformTx(ctx);
  const rows = await tx.select({ key: roles.key, name: roles.name, description: roles.description,
    secondFactorRequired: roles.secondFactorRequired }).from(roles).orderBy(asc(roles.name));
  const held = await tx.select({ role: users.role, n: count() }).from(users)
    .where(inArray(users.status, ['active', 'invited'])).groupBy(users.role);
  const people = new Map(held.map((h) => [h.role, h.n]));
  const keys = await keysByRole(tx);
  const builtIn = new Set((await tx.select({ role: roleTemplates.role }).from(roleTemplates)).map((t) => t.role));
  return { roles: rows.map((r) => ({ ...r, userCount: people.get(r.key) ?? 0, grantable: mayGive(caller, r.key, keys.get(r.key) ?? []),
    builtIn: builtIn.has(r.key) })) };
}

/** GET /admin/permissions (roles:read): every key, every role's grants, and the version a change must name. */
export async function permissionMatrix(ctx: Ctx): Promise<Out<typeof getPermissionMatrix>> {
  const caller = await callerOf(ctx);
  const tx = platformTx(ctx);
  const rows = await tx.select({ key: roles.key, name: roles.name }).from(roles).orderBy(asc(roles.name));
  const grants = await tx.select({ role: roleGrants.role, permission: roleGrants.permission }).from(roleGrants);
  return {
    version: await matrixVersion(tx),
    permissions: PERMISSIONS.map(({ key, module, label }) => ({ key, module, label })),
    roles: rows.map((r) => ({ key: r.key, name: r.name, editable: r.key !== ADMIN && r.key !== caller.role,
      grants: grants.filter((g) => g.role === r.key).map((g) => g.permission).toSorted() })),
  };
}

/** PUT /admin/roles/:key/permissions (roles:write): one role's grants, replaced. A key it keeps keeps its scope; a
 * key it gains reaches every record. */
export async function setRoleGrants(ctx: Ctx, { key, grants, version }: In<typeof setRolePermissions>):
  Promise<Out<typeof setRolePermissions>> {
  const caller = await callerOf(ctx);
  const tx = platformTx(ctx);
  // The role's row is locked, so two changes to one role take turns, and the second sees the first's version.
  const [role] = await tx.select({ key: roles.key }).from(roles).where(eq(roles.key, key)).limit(1).for('update');
  if (role === undefined) throw new AppError('not_found', 'There is no such role');
  if (key === ADMIN) throw new AppError('role_not_editable', 'The admin role holds every permission and can’t be changed');
  if (key === caller.role) throw new AppError('role_not_editable', 'Nobody changes what their own role may do');
  if ((await matrixVersion(tx)) !== version) {
    throw new AppError('matrix_changed', 'Someone else changed the permissions. Reload them and try again');
  }
  const unknown = grants.filter((k) => !CATALOG.has(k));
  if (unknown.length > 0) {
    throw new AppError('unknown_permission', 'Some of these aren’t permissions', keyIssues(grants, unknown, 'unknown', (k) => `${k} isn’t a permission`));
  }
  const had = new Map((await tx.select({ permission: roleGrants.permission, scope: roleGrants.scope }).from(roleGrants)
    .where(eq(roleGrants.role, key))).map((g) => [g.permission, g.scope]));
  const added = grants.filter((k) => !had.has(k));
  const removed = [...had.keys()].filter((k) => !grants.includes(k));
  const notHeld = added.filter((k) => !caller.permissions.includes(k));
  if (notHeld.length > 0) {
    throw new AppError('permission_not_held', 'You can only give a permission you hold yourself',
      keyIssues(grants, notHeld, 'not_held', (k) => `You don’t hold ${k}`));
  }
  // Nor take one away: a key the caller lacks belongs to a stronger role's business (the auditor on #139).
  const notHeldRemoved = removed.filter((k) => !caller.permissions.includes(k));
  if (notHeldRemoved.length > 0) {
    throw new AppError('permission_not_held', 'You can only take away a permission you hold yourself',
      notHeldRemoved.map((k) => ({ path: ['grants'], code: 'not_held', message: `You don’t hold ${k}` })));
  }
  const basics = removed.filter((k) => SIGNED_IN_BASICS.includes(k));
  if (basics.length > 0) {
    throw new AppError('basics_required', `Every role keeps ${basics.join(', ')}: without it nobody can use their own account`,
      basics.map((k) => ({ path: ['grants'], code: 'basic', message: `${k} can’t be taken away` })));
  }
  const reserved = added.filter((k) => !(CATALOG.get(k)?.onlyRoles ?? [key]).includes(key));
  if (reserved.length > 0) {
    throw new AppError('permission_not_for_role', 'Some of these are kept for other roles',
      keyIssues(grants, reserved, 'reserved', (k) => `Only ${CATALOG.get(k)?.onlyRoles?.join(' and ') ?? ''} may hold ${k}`));
  }
  if (removed.length > 0) await tx.delete(roleGrants).where(and(eq(roleGrants.role, key), inArray(roleGrants.permission, removed)));
  if (added.length > 0) await tx.insert(roleGrants).values(added.map((permission) => ({ role: key, permission, scope: 'all' })));
  // A key needing the second factor turns it on for the role, and a shrinking role's people sign in again (RAD-83).
  await afterGrantsChanged(ctx, key, { shrank: removed.length > 0 });
  return { version: await matrixVersion(tx) };
}

/** PUT /admin/users/:id/role (users:write): someone else's role. It ends their sessions, so the new role's keys and
 * second-factor rule (D-19) apply from their next sign-in. */
export async function changeUserRole(ctx: Ctx, { id, role }: In<typeof setUserRole>): Promise<Out<typeof setUserRole>> {
  if (ctx.principal.kind === 'user' && ctx.principal.userId === id) {
    throw new AppError('own_account', 'Nobody changes their own role');
  }
  const tx = platformTx(ctx);
  // The active admins are locked first, in one order, so two admins demoting each other at once take turns, and the
  // second finds it's no longer an admin. The caller's role is read after the lock.
  const admins = await tx.select({ id: users.id }).from(users).where(and(eq(users.role, ADMIN), eq(users.status, 'active')))
    .orderBy(asc(users.id)).for('update');
  const caller = await callerOf(ctx);
  const [target] = await tx.select({ role: users.role }).from(users).where(eq(users.id, id)).limit(1).for('update');
  if (target === undefined) throw new AppError('not_found', 'There is no such person');
  const [known] = await tx.select({ key: roles.key }).from(roles).where(eq(roles.key, role)).limit(1);
  if (known === undefined) {
    throw new AppError('invalid_input', 'Choose a role from the list', [{ path: ['role'], code: 'unknown_role', message: 'Not a role' }]);
  }
  if ((role === ADMIN || target.role === ADMIN) && caller.role !== ADMIN) {
    throw new AppError('role_not_grantable', 'Only an admin gives or takes away the admin role');
  }
  // Both roles' keys must be the caller's own: giving a role passes its keys on, and taking one away removes them.
  const keys = await keysByRole(tx);
  if (!mayGive(caller, role, keys.get(role) ?? []) || !mayGive(caller, target.role, keys.get(target.role) ?? [])) {
    throw new AppError('role_not_grantable', 'You can only give or take away a role whose permissions you hold yourself');
  }
  if (target.role === role) return { sessionsEnded: 0 };
  if (target.role === ADMIN && admins.filter((a) => a.id !== id).length === 0) {
    throw new AppError('last_admin', 'Someone has to stay an admin: give another person the admin role first');
  }
  await tx.update(users).set({ role, roleSince: new Date() }).where(eq(users.id, id));
  return { sessionsEnded: await endSessionsOf(ctx, id, 'role_changed') };
}
