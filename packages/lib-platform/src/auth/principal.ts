// Who a person is now (RAD-35, M1-17, ADR-001 §6a): their role's keys, each over every record or only their own, read
// fresh from the database on every request and every job, never cached, so a changed role or grant applies at once in
// every process (RC-095). Sessions (RAD-34) and the worker's user jobs (RAD-44 3b) both load a person this way.
import { randomUUID } from 'node:crypto';
import { idString } from '@radcore/lib-common';
import { platformTx, roleGrants, roles, users } from '@radcore/db/platform';
import type { Database } from '@radcore/db/schema';
import { and, eq } from 'drizzle-orm';
import type { Ctx, Principal } from '../ctx.ts';
import { runInTransaction } from '../db/transaction.ts';
import type { LoadPrincipal } from '../jobs.ts';

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
  // Only what the role grants: every role is seeded with My work's keys, and nothing is added here (ADR-001 §6a).
  const grants = await tx.select({ permission: roleGrants.permission, scope: roleGrants.scope })
    .from(roleGrants).where(eq(roleGrants.role, person.role));
  const permissions = grants.map((g) => g.permission).toSorted();
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

/** Whether the person's role asks for the second sign-in factor (D-19, RAD-33). */
export async function roleNeedsSecondFactor(ctx: Ctx, userId: string): Promise<boolean> {
  const [row] = await platformTx(ctx).select({ required: roles.secondFactorRequired }).from(users)
    .innerJoin(roles, eq(roles.key, users.role)).where(eq(users.id, userId)).limit(1);
  return row?.required ?? false;
}
