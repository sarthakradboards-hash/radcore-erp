// Whether a person's sign-in needs a second factor, and whether they have one (D-19, M1-15): what step 1 of sign-in,
// GET /me and the people list answer.
import { platformTx, secondFactors } from '@radcore/db/platform';
import { and, eq, isNotNull } from 'drizzle-orm';
import type { Ctx } from '../ctx.ts';
import { roleNeedsSecondFactor } from './principal.ts';

export type SecondFactorStatus = 'not_required' | 'enrolled' | 'enrolment_required';

/** `enrolled` once a factor is confirmed, whatever the role; otherwise whether the role needs one (D-19). */
export async function secondFactorStatus(ctx: Ctx, userId: string): Promise<SecondFactorStatus> {
  const [factor] = await platformTx(ctx).select({ id: secondFactors.id }).from(secondFactors)
    .where(and(eq(secondFactors.userId, userId), isNotNull(secondFactors.confirmedAt))).limit(1);
  if (factor !== undefined) return 'enrolled';
  // From the person's role (RAD-35): D-19's admin, owner, accounts and HR need one.
  return await roleNeedsSecondFactor(ctx, userId) ? 'enrolment_required' : 'not_required';
}
