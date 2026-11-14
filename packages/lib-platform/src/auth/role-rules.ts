// What follows any change to a role's grants (RAD-83; the architect on RAD-83): a role that now holds a key needing the
// second sign-in factor has its own setting turned on, recorded as part of the change, and the people holding a role
// whose power grew in that way, or shrank, sign in again under it. Every role-editing service ends with this.
import { platformTx, roleGrants, roles, users } from '@radcore/db/platform';
import { and, eq, inArray } from 'drizzle-orm';
import type { Ctx } from '../ctx.ts';
import { SECOND_FACTOR_KEYS } from '../permissions.ts';
import { endSessionsOf } from './sessions.ts';

/** Turns the role's second-factor setting on if it holds a key that needs it; answers whether it turned on. It is
 * never turned off here: a built-in role keeps D-19's setting, and a custom one keeps it once set. */
async function requireSecondFactorIfNeeded(ctx: Ctx, role: string): Promise<boolean> {
  const tx = platformTx(ctx);
  const [held] = await tx.select({ permission: roleGrants.permission }).from(roleGrants)
    .where(and(eq(roleGrants.role, role), inArray(roleGrants.permission, [...SECOND_FACTOR_KEYS]))).limit(1);
  if (held === undefined) return false;
  const turned = await tx.update(roles).set({ secondFactorRequired: true })
    .where(and(eq(roles.key, role), eq(roles.secondFactorRequired, false))).returning({ key: roles.key });
  return turned.length > 0;
}

/**
 * After `role`'s grants changed: the second-factor setting follows its keys, and when that turned on, or the role lost
 * keys (`shrank`), everyone holding it signs in again (`role_changed`), so the change applies to them at once, second
 * factor included. Answers how many sessions ended.
 */
export async function afterGrantsChanged(ctx: Ctx, role: string, { shrank }: { shrank: boolean }): Promise<number> {
  const turnedOn = await requireSecondFactorIfNeeded(ctx, role);
  if (!turnedOn && !shrank) return 0;
  const holders = await platformTx(ctx).select({ id: users.id }).from(users).where(eq(users.role, role));
  let ended = 0;
  for (const h of holders) ended += await endSessionsOf(ctx, h.id, 'role_changed');
  return ended;
}
