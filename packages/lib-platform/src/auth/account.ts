// Setting a password (M1-14, ADR-001 §7a, RAD-61, RAD-64): accepting an invite, resetting from an email link, and
// changing your own. The new-password rules (length, the bundled list, Pwned Passwords) ran before the transaction,
// in the handler; these services check only same_as_old, since that needs the stored hash. A link is single-use and
// expires, its token is found by its SHA-256, and an unknown, used or expired link gets one answer. Neither an invite
// nor a reset starts a session: the person signs in afterwards, second factor included (RAD-64 item 2). A reset ends
// every session the person has, and a change all but this one (RAD-34); each records password_changed (RAD-31).
import { createHash } from 'node:crypto';
import { invites, passwordResets, platformTx, users } from '@radcore/db/platform';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Ctx } from '../ctx.ts';
import { AppError } from '../errors.ts';
import { recordSecurityEvent } from '../security-events.ts';
import type { Lockout } from './lockout.ts';
import type { Passwords } from './passwords.ts';
import { endSessionsOf } from './sessions.ts';

type Deps = { passwords: Passwords; lockout: Lockout };

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const linkGone = () => new AppError('link_expired', 'This link has expired or has already been used. Ask for a new one');
const sameAsOld = (field: string) => new AppError('password_rejected', 'Choose a password you haven’t used here',
  [{ path: [field], code: 'same_as_old', message: 'That’s your current password. Choose a new one' }]);

export function createAccount({ passwords, lockout }: Deps) {
  return Object.freeze({
    async acceptInvite(ctx: Ctx, { token, password }: { token: string; password: string }): Promise<Record<string, never>> {
      const tx = platformTx(ctx);
      const [row] = await tx.select({ inviteId: invites.id, userId: users.id }).from(invites)
        .innerJoin(users, eq(users.id, invites.userId))
        .where(and(eq(invites.tokenHash, sha256(token)), isNull(invites.usedAt), gt(invites.expiresAt, new Date()),
          eq(users.status, 'invited')))
        .for('update');
      if (row === undefined) throw linkGone();
      const now = new Date();
      await tx.update(invites).set({ usedAt: now }).where(eq(invites.id, row.inviteId));
      await tx.update(users).set({ passwordHash: await passwords.hash(password), passwordSetAt: now, status: 'active' })
        .where(eq(users.id, row.userId));
      await recordSecurityEvent(ctx, { kind: 'password_changed', detail: { how: 'invite' } }, { userId: row.userId, device: null });
      return {};
    },

    /** Also clears the address's lock, and spends every other reset link the person holds. Ends all their sessions. */
    async resetPassword(ctx: Ctx, { token, password }: { token: string; password: string }): Promise<Record<string, never>> {
      const tx = platformTx(ctx);
      const [row] = await tx.select({ userId: users.id, email: users.email, hash: users.passwordHash }).from(passwordResets)
        .innerJoin(users, eq(users.id, passwordResets.userId))
        .where(and(eq(passwordResets.tokenHash, sha256(token)), isNull(passwordResets.usedAt),
          gt(passwordResets.expiresAt, new Date()), eq(users.status, 'active')))
        .for('update');
      if (row === undefined) throw linkGone();
      if ((await passwords.verify(row.hash, password)).ok) throw sameAsOld('password');
      const now = new Date();
      await tx.update(passwordResets).set({ usedAt: now })
        .where(and(eq(passwordResets.userId, row.userId), isNull(passwordResets.usedAt)));
      await tx.update(users).set({ passwordHash: await passwords.hash(password), passwordSetAt: now }).where(eq(users.id, row.userId));
      await endSessionsOf(ctx, row.userId, 'password_reset');
      await recordSecurityEvent(ctx, { kind: 'password_changed', detail: { how: 'reset' } }, { userId: row.userId, device: null });
      await lockout.succeeded(row.email);
      return {};
    },

    /** Signed in. A wrong current password counts towards the address's lock, like a failed sign-in. */
    async changePassword(ctx: Ctx, { currentPassword, newPassword }: { currentPassword: string; newPassword: string }):
      Promise<{ otherSessionsEnded: number }> {
      if (ctx.principal.kind !== 'user') throw new AppError('forbidden', 'Only a signed-in person can change their password');
      const tx = platformTx(ctx);
      const [user] = await tx.select({ email: users.email, hash: users.passwordHash }).from(users)
        .where(and(eq(users.id, ctx.principal.userId), eq(users.status, 'active'))).for('update');
      if (user === undefined) throw new AppError('signed_out', 'Please sign in again');
      const wait = await lockout.attempt(user.email);
      if (wait > 0) throw new AppError('account_locked', 'Too many tries. Please wait, or reset your password', [], wait);
      if (!(await passwords.verify(user.hash, currentPassword)).ok) {
        throw new AppError('invalid_credentials', 'That isn’t your current password');
      }
      await lockout.succeeded(user.email);
      if (currentPassword.normalize('NFC') === newPassword.normalize('NFC')) throw sameAsOld('newPassword');
      await tx.update(users).set({ passwordHash: await passwords.hash(newPassword), passwordSetAt: new Date() })
        .where(eq(users.id, ctx.principal.userId));
      await recordSecurityEvent(ctx, { kind: 'password_changed', detail: { how: 'change' } },
        { userId: ctx.principal.userId, device: null });
      return { otherSessionsEnded: await endSessionsOf(ctx, ctx.principal.userId, 'password_changed',
        { keep: ctx.principal.sessionId }) };
    },
  });
}
