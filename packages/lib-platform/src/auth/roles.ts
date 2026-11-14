// Roles (RAD-35, M1-17; the plan's page 4): each person has one, and a role holds permission keys, each over every
// record or only the person's own. Who a person is now is principal.ts.
import { platformTx, roles, users } from '@radcore/db/platform';
import { eq } from 'drizzle-orm';
import type { Ctx } from '../ctx.ts';
import { AppError } from '../errors.ts';
import { endSessionsOf } from './sessions.ts';

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
