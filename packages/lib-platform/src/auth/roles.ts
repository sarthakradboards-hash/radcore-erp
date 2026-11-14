// Roles (RAD-35, M1-17; the plan's page 4): each person has one, and a role holds permission keys, each over every
// record or only the person's own. Who a person is now is principal.ts.
import { platformTx, roles, users } from '@radcore/db/platform';
import { eq } from 'drizzle-orm';
import type { Ctx } from '../ctx.ts';
import { AppError } from '../errors.ts';
import { endSessionsOf } from './sessions.ts';

/**
 * Gives a person a role, and ends their sessions (`role_changed`, RAD-34) so they sign in again under it. The rules on
 * who may give which role, and that nobody changes their own, are RAD-36's service; this is the step it and the first
 * admin's bootstrap share.
 */
export async function assignRole(ctx: Ctx, userId: string, role: string): Promise<void> {
  const tx = platformTx(ctx);
  const [known] = await tx.select({ key: roles.key }).from(roles).where(eq(roles.key, role)).limit(1);
  if (known === undefined) throw new AppError('not_found', 'There is no such role');
  // role_since says when they gained it, which the approval rules read (the architect on RAD-35).
  const changed = await tx.update(users).set({ role, roleSince: new Date() }).where(eq(users.id, userId)).returning({ id: users.id });
  if (changed.length === 0) throw new AppError('not_found', 'There is no such person');
  await endSessionsOf(ctx, userId, 'role_changed');
}
