// Whether a person's sign-in needs a second factor, and whether they have one (D-19, M1-15): what step 1 of sign-in,
// GET /me and the people list answer.
import { platformTx, secondFactors } from '@radcore/db/platform';
import { and, eq, isNotNull } from 'drizzle-orm';
import type { Ctx } from '../ctx.ts';

export type SecondFactorStatus = 'not_required' | 'enrolled' | 'enrolment_required';

// shortcut: every account needs a second factor until roles land (RAD-35), so the rule fails safe (the coordinator,
// 14 Nov 2026). RAD-35 answers it from the person's role: D-19's admin, owner, accounts and HR.
const requiredForEveryone = (): boolean => true;

/** `enrolled` once a factor is confirmed, whatever the role; otherwise whether the role needs one (D-19). */
export async function secondFactorStatus(ctx: Ctx, userId: string): Promise<SecondFactorStatus> {
  const [factor] = await platformTx(ctx).select({ id: secondFactors.id }).from(secondFactors)
    .where(and(eq(secondFactors.userId, userId), isNotNull(secondFactors.confirmedAt))).limit(1);
  if (factor !== undefined) return 'enrolled';
  return requiredForEveryone() ? 'enrolment_required' : 'not_required';
}
