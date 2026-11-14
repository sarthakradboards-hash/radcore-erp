// Custom roles, and the built-in roles as templates (RAD-83; the architect on RAD-83, ADR-001 §6a). Admin and owner
// (roles:write) create a role, blank or copied from another, rename it, and delete it while nobody holds it; a built-in
// role is reset to the grants it shipped with. The rules are setRolePermissions' (roles-admin.ts): nobody gives or takes
// away a key they don't hold, a key kept for named roles goes to no other, the admin role and the caller's own aren't
// edited. A role's second-factor setting follows its keys (role-rules.ts). Every write is audited through the roles,
// role_grants and users triggers, pointing at the typed reason the handler keeps first.
import { platformTx, roleGrants, roles, roleTemplates, users } from '@radcore/db/platform';
import { and, count, eq, inArray, like } from 'drizzle-orm';
import type { z } from 'zod';
import type { createRole, deleteRole, resetRole, updateRole } from '../contract.ts';
import type { Ctx } from '../ctx.ts';
import { AppError } from '../errors.ts';
import { SIGNED_IN_BASICS } from '../permissions.ts';
import { afterGrantsChanged } from './role-rules.ts';
import { ADMIN, CATALOG, callerOf, matrixVersion, setRoleGrants, type Tx } from './roles-admin.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;

/** A key made from the name: lower-case letters and `_`, as ck_roles_key allows. A name with no Latin letters (हिसाब)
 * gets `role`. */
export function keyFromName(name: string): string {
  // Accents dropped first (é → e), then every other run of characters becomes one `_`.
  const base = name.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^a-z]+/g, '_').replace(/^_+|_+$/g, '')
    .slice(0, 29).replace(/_+$/, '');
  return base.length >= 2 ? base : 'role';
}

/** The first of `base`, `base_b` … `base_z` no role has. */
async function freeKey(tx: Tx, base: string): Promise<string> {
  const taken = new Set((await tx.select({ key: roles.key }).from(roles).where(like(roles.key, `${base}%`))).map((r) => r.key));
  // shortcut: 26 keys per name stem, enough for one business; past that, a number would need ck_roles_key widened.
  const key = [base, ...'bcdefghijklmnopqrstuvwxyz'].map((c, i) => (i === 0 ? base : `${base}_${c}`)).find((k) => !taken.has(k));
  if (key === undefined) throw new AppError('name_taken', 'Too many roles have names like this one: choose a different name');
  return key;
}

/** ux_roles_name_key's refusal, as name_taken: two roles never share a name, whatever the case or spacing. */
async function sameNameRefused<T>(write: Promise<T>): Promise<T> {
  try {
    return await write;
  } catch (e) {
    const pg = (e as { cause?: { constraint?: string } }).cause;
    if (pg?.constraint === 'ux_roles_name_key') {
      throw new AppError('name_taken', 'Another role already has this name', [{ path: ['name'], code: 'taken', message: 'Choose another name' }]);
    }
    throw e;
  }
}

/** The role's row, locked, so two changes to one role take turns. */
async function lockedRole(tx: Tx, key: string) {
  const [role] = await tx.select({ key: roles.key }).from(roles).where(eq(roles.key, key)).limit(1).for('update');
  if (role === undefined) throw new AppError('not_found', 'There is no such role');
  return role;
}

const isBuiltIn = async (tx: Tx, key: string) =>
  (await tx.select({ role: roleTemplates.role }).from(roleTemplates).where(eq(roleTemplates.role, key)).limit(1)).length > 0;

/** POST /admin/roles: a blank role, holding only the signed-in basics, or a copy of another's grants and scopes. */
export async function createCustomRole(ctx: Ctx, { name, description, copyFrom }: In<typeof createRole>): Promise<Out<typeof createRole>> {
  const caller = await callerOf(ctx);
  const tx = platformTx(ctx);
  let grants = SIGNED_IN_BASICS.map((permission) => ({ permission, scope: 'all' }));
  if (copyFrom !== undefined) {
    await lockedRole(tx, copyFrom);
    grants = await tx.select({ permission: roleGrants.permission, scope: roleGrants.scope }).from(roleGrants).where(eq(roleGrants.role, copyFrom));
    // A copy passes its keys on, so each must be the caller's own, and none kept for the roles it was copied from.
    const notHeld = grants.filter((g) => !caller.permissions.includes(g.permission));
    if (notHeld.length > 0) {
      throw new AppError('permission_not_held', 'You can only copy a role whose permissions you hold yourself',
        notHeld.map((g) => ({ path: ['copyFrom'], code: 'not_held', message: `You don’t hold ${g.permission}` })));
    }
    const reserved = grants.filter((g) => CATALOG.get(g.permission)?.onlyRoles !== undefined);
    if (reserved.length > 0) {
      throw new AppError('permission_not_for_role', 'This role holds permissions kept for named roles, so it can’t be copied',
        reserved.map((g) => ({ path: ['copyFrom'], code: 'reserved', message: `Only ${CATALOG.get(g.permission)?.onlyRoles?.join(' and ') ?? ''} may hold ${g.permission}` })));
    }
  }
  const key = await freeKey(tx, keyFromName(name));
  // A copy never takes the original's second-factor setting: it's worked out from the copy's own keys.
  await sameNameRefused(tx.insert(roles).values({ key, name, description }));
  if (grants.length > 0) await tx.insert(roleGrants).values(grants.map((g) => ({ role: key, ...g })));
  await afterGrantsChanged(ctx, key, { shrank: false });
  return { key };
}

/** PATCH /admin/roles/:key: a role's name or description. Its key never changes. */
export async function renameRole(ctx: Ctx, { key, name, description }: In<typeof updateRole>): Promise<Out<typeof updateRole>> {
  const caller = await callerOf(ctx);
  const tx = platformTx(ctx);
  await lockedRole(tx, key);
  if (key === ADMIN) throw new AppError('role_not_editable', 'The admin role can’t be changed');
  if (key === caller.role) throw new AppError('role_not_editable', 'Nobody changes their own role');
  if (name === undefined && description === undefined) return {};
  await sameNameRefused(tx.update(roles).set({ ...(name === undefined ? {} : { name }), ...(description === undefined ? {} : { description }) })
    .where(eq(roles.key, key)));
  return {};
}

/** POST /admin/roles/:key/delete: a custom role nobody holds, with its grants. */
export async function deleteCustomRole(ctx: Ctx, { key }: In<typeof deleteRole>): Promise<Out<typeof deleteRole>> {
  await callerOf(ctx);
  const tx = platformTx(ctx);
  await lockedRole(tx, key);
  if (await isBuiltIn(tx, key)) throw new AppError('role_not_deletable', 'This is one of the built-in roles: reset it instead');
  // Anyone holding it, deactivated people included: users.role keeps them pointing at it (and its FK refuses anyway).
  const [held] = await tx.select({ n: count() }).from(users).where(eq(users.role, key));
  const n = held?.n ?? 0;
  if (n > 0) {
    throw new AppError('role_in_use', `${n} ${n === 1 ? 'person holds' : 'people hold'} this role: give them another role first`,
      [{ path: ['key'], code: 'in_use', message: String(n) }]);
  }
  await tx.delete(roleGrants).where(eq(roleGrants.role, key));
  await tx.delete(roles).where(eq(roles.key, key));
  return {};
}

/** POST /admin/roles/:key/reset: a built-in role's grants and scopes back to its template, as one change. */
export async function resetRoleToTemplate(ctx: Ctx, { key, version, reason }: In<typeof resetRole>): Promise<Out<typeof resetRole>> {
  const caller = await callerOf(ctx);
  const tx = platformTx(ctx);
  await lockedRole(tx, key);
  const template = await tx.select({ permission: roleTemplates.permission, scope: roleTemplates.scope }).from(roleTemplates)
    .where(eq(roleTemplates.role, key));
  if (template.length === 0) throw new AppError('not_a_template', 'A role you made has no template to go back to');
  // The keys, under setRolePermissions' rules; then each kept key's scope, which is also a key's reach, so it's the
  // caller's to change only when they hold the key.
  await setRoleGrants(ctx, { key, grants: template.map((t) => t.permission), version, reason });
  const now = new Map((await tx.select({ permission: roleGrants.permission, scope: roleGrants.scope }).from(roleGrants)
    .where(eq(roleGrants.role, key))).map((g) => [g.permission, g.scope]));
  const rescoped = template.filter((t) => now.get(t.permission) !== t.scope);
  const notHeld = rescoped.filter((t) => !caller.permissions.includes(t.permission));
  if (notHeld.length > 0) {
    throw new AppError('permission_not_held', 'You can only change the reach of a permission you hold yourself',
      notHeld.map((t) => ({ path: ['grants'], code: 'not_held', message: `You don’t hold ${t.permission}` })));
  }
  for (const s of ['all', 'own']) {
    const keys = rescoped.filter((t) => t.scope === s).map((t) => t.permission);
    if (keys.length > 0) await tx.update(roleGrants).set({ scope: s }).where(and(eq(roleGrants.role, key), inArray(roleGrants.permission, keys)));
  }
  // Narrowing a key's reach takes power away, so its holders sign in again.
  if (rescoped.some((t) => t.scope === 'own')) await afterGrantsChanged(ctx, key, { shrank: true });
  return { version: await matrixVersion(tx) };
}
