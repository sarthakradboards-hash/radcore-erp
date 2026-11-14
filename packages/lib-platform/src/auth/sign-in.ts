// The credential step of sign-in (M1-14, ADR-001 §7a, RAD-64). RAD-34's /sign-in route runs it in its transaction,
// then sets the session cookie, or the pending-sign-in cookie for a second factor.
// - Every attempt is counted for the address typed, atomically, before anything is checked (RAD-64); a locked
//   address is refused there, with when to retry.
// - An unknown address, an invited person with no password yet and a disabled account are checked against the dummy
//   hash, so each takes as long as a wrong password, and all three get the same answer and are counted the same way.
// - A success clears the address's count, and stores a fresh hash if the stored one used older parameters.
// Attempts are counted in the shared store, outside this transaction, so a rollback doesn't undo them.
import { normaliseEmail } from '@radcore/lib-common';
import { platformTx, users } from '@radcore/db/platform';
import { eq } from 'drizzle-orm';
import type { Ctx } from '../ctx.ts';
import { AppError } from '../errors.ts';
import type { Lockout } from './lockout.ts';
import type { Passwords } from './passwords.ts';
import type { SecondFactorStatus } from './second-factor-status.ts';

export type SignInResult = { userId: string; next: 'done' | 'second_factor' | 'enrol_second_factor' };

type Deps = { passwords: Passwords; lockout: Lockout; secondFactor: (ctx: Ctx, userId: string) => Promise<SecondFactorStatus> };

const NEXT: Readonly<Record<SecondFactorStatus, SignInResult['next']>> = {
  not_required: 'done', enrolled: 'second_factor', enrolment_required: 'enrol_second_factor',
};
// The same words for an unknown address and a wrong password (ADR-001 §7a).
const WRONG = 'That email address and password don’t match';

export function createSignIn({ passwords, lockout, secondFactor }: Deps) {
  return async (ctx: Ctx, { email, password }: { email: string; password: string }): Promise<SignInResult> => {
    const wait = await lockout.attempt(email);
    if (wait > 0) throw new AppError('account_locked', 'Too many tries for this address. Please wait, or reset your password', [], wait);
    const tx = platformTx(ctx);
    const [user] = await tx.select({ id: users.id, passwordHash: users.passwordHash, status: users.status })
      .from(users).where(eq(users.emailKey, normaliseEmail(email))).limit(1);
    const stored = user?.status === 'active' ? user.passwordHash : null;
    const { ok, rehash } = await passwords.verify(stored, password);
    if (!ok || user === undefined) throw new AppError('invalid_credentials', WRONG);
    await lockout.succeeded(email);
    if (rehash) {
      await tx.update(users).set({ passwordHash: await passwords.hash(password) }).where(eq(users.id, user.id));
    }
    return { userId: user.id, next: NEXT[await secondFactor(ctx, user.id)] };
  };
}
