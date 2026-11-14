// Roles and who a person is now (RAD-35, M1-17, ADR-001 §6a; the plan's page 4). Each person has one role, and a role
// holds permission keys, each over every record or only the person's own. A principal is read fresh from the database
// on every request and every job, never cached, so a changed role or grant applies at once in every process (RC-095).
import { randomUUID } from 'node:crypto';
import { idString } from '@radcore/lib-common';
import { platformTx, roleGrants, roles, users } from '@radcore/db/platform';
import type { Database } from '@radcore/db/schema';
import { and, eq } from 'drizzle-orm';
import type { Ctx, Principal } from '../ctx.ts';
import { runInTransaction } from '../db/transaction.ts';
import { AppError } from '../errors.ts';
import type { LoadPrincipal } from '../jobs.ts';
import { endSessionsOf } from './sessions.ts';

/** Every person holds this whatever their role: their own account and sessions, the start of My work. */
const MY_WORK: readonly string[] = Object.freeze(['session:read']);
const LOADER: Principal = Object.freeze({ kind: 'system', name: 'principal-loader', permissions: Object.freeze([]) });
const READ = { readOnly: true, isolation: 'read committed' } as const;

/**
 * The principal for an active person, as their role is now: its keys, and which of them reach only their own records.
 * Null for an unknown or inactive person. `sessionId` is the sign-in session the request came with.
 */
export async function principalFor(ctx: Ctx, userId: string, sessionId?: string): Promise<Principal | null> {
  const tx = platformTx(ctx);
  const [person] = await tx.select({ role: users.role }).from(users)
    .where(and(eq(users.id, userId), eq(users.status, 'active'))).limit(1);
  if (person === undefined) return null;
  const grants = person.role === null ? [] : await tx.select({ permission: roleGrants.permission, scope: roleGrants.scope })
    .from(roleGrants).where(eq(roleGrants.role, person.role));
  const permissions = [...new Set([...MY_WORK, ...grants.map((g) => g.permission)])].toSorted();
  const ownScope = grants.filter((g) => g.scope === 'own').map((g) => g.permission).toSorted();
  return Object.freeze({
    kind: 'user', userId, ...(sessionId === undefined ? {} : { sessionId }), role: person.role,
    permissions: Object.freeze(permissions), ownScope: Object.freeze(ownScope),
  });
}

/**
 * The worker's loader for a job queued by a person (ADR-001 §6a, RAD-44 3b): `user:<id>` as that person is now, so a
 * revoked permission fails the job. Anything else, or a person gone or inactive, is null.
 */
export const loadPrincipal = (db: Database): LoadPrincipal => async (by) => {
  const id = by.startsWith('user:') ? by.slice('user:'.length) : '';
  if (!idString().safeParse(id).success) return null;
  return runInTransaction(db, READ, LOADER, randomUUID(), (ctx) => principalFor(ctx, id));
};

/** Whether the person's role asks for the second sign-in factor (D-19, RAD-33); a person with no role yet doesn't. */
export async function roleNeedsSecondFactor(ctx: Ctx, userId: string): Promise<boolean> {
  const [row] = await platformTx(ctx).select({ required: roles.secondFactorRequired }).from(users)
    .innerJoin(roles, eq(roles.key, users.role)).where(eq(users.id, userId)).limit(1);
  return row?.required ?? false;
}

/**
 * Gives a person a role, and ends their sessions (`role_changed`, RAD-34) so they sign in again under it. The rules on
 * who may give which role, and that nobody changes their own, are RAD-36's service; this is the step it and the first
 * admin's bootstrap share.
 */
export async function assignRole(ctx: Ctx, userId: string, role: string): Promise<void> {
  const tx = platformTx(ctx);
  const [known] = await tx.select({ key: roles.key }).from(roles).where(eq(roles.key, role)).limit(1);
  if (known === undefined) throw new AppError('not_found', 'There is no such role');
  const changed = await tx.update(users).set({ role }).where(eq(users.id, userId)).returning({ id: users.id });
  if (changed.length === 0) throw new AppError('not_found', 'There is no such person');
  await endSessionsOf(ctx, userId, 'role_changed');
}
