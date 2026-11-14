// Inviting, deactivating and reactivating people (RAD-36, M1-14, M1-18, RC-033), under the same rule as a role change:
// nobody gives a role, or acts on someone in one, whose keys they don't all hold, and only an admin does it for admin.
// Nobody deactivates themselves or the last admin. Deactivating ends every session and spends every open invite and
// reset link, so a disabled person can't get back in by any route. Each change is audited through the users trigger,
// and a reason the contract asks for is kept with its audit rows by the handler.
import { normaliseEmail } from '@radcore/lib-common';
import { invites, passwordResets, platformTx, roles, users } from '@radcore/db/platform';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import type { deactivateUser, inviteUser, reactivateUser, resendInvite } from '../contract.ts';
import type { Ctx } from '../ctx.ts';
import { AppError } from '../errors.ts';
import { INVITE_EMAIL } from './invite-email.ts';
import { callerOf, keysByRole, mayGive } from './roles-admin.ts';
import { endSessionsOf } from './sessions.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;

const ADMIN = 'admin';
const notGrantable = () => new AppError('role_not_grantable', 'You can only act on a role whose permissions you hold yourself');

/** POST /admin/users (users:write): a new person, invited by email; they choose their own password (M1-14). */
export async function invitePerson(ctx: Ctx, { email, displayName, role }: In<typeof inviteUser>): Promise<Out<typeof inviteUser>> {
  const caller = await callerOf(ctx);
  const tx = platformTx(ctx);
  const [known] = await tx.select({ key: roles.key }).from(roles).where(eq(roles.key, role)).limit(1);
  if (known === undefined) {
    throw new AppError('invalid_input', 'Choose a role from the list', [{ path: ['role'], code: 'unknown_role', message: 'Not a role' }]);
  }
  if (!mayGive(caller, role, (await keysByRole(tx)).get(role) ?? [])) throw notGrantable();
  const address = normaliseEmail(email);
  const [taken] = await tx.select({ id: users.id }).from(users).where(eq(users.emailKey, address)).limit(1);
  if (taken !== undefined) throw new AppError('email_taken', 'Someone already has this address');
  const [person] = await tx.insert(users).values({ email: address, displayName, role, roleSince: new Date() })
    .returning({ id: users.id });
  const id = person?.id ?? '';
  await ctx.jobs.send(INVITE_EMAIL, { userId: id });
  return { id };
}

/** POST /admin/users/:id/invite (users:write): a new link for someone still invited; the old one stops working. */
export async function resendPersonInvite(ctx: Ctx, { id }: In<typeof resendInvite>): Promise<Out<typeof resendInvite>> {
  const [person] = await platformTx(ctx).select({ status: users.status }).from(users).where(eq(users.id, id)).limit(1);
  if (person === undefined) throw new AppError('not_found', 'There is no such person');
  if (person.status !== 'invited') throw new AppError('not_invited', 'This person has already set up their account');
  await ctx.jobs.send(INVITE_EMAIL, { userId: id });
  return {};
}

/** POST /admin/users/:id/deactivate (users:write): no sign-in, no session, no open link. */
export async function deactivatePerson(ctx: Ctx, { id }: In<typeof deactivateUser>): Promise<Out<typeof deactivateUser>> {
  if (ctx.principal.kind === 'user' && ctx.principal.userId === id) {
    throw new AppError('own_account', 'Nobody deactivates their own account');
  }
  const tx = platformTx(ctx);
  // As a role change: the active admins are locked first, in one order, and the caller is read after the lock.
  const admins = await tx.select({ id: users.id }).from(users).where(and(eq(users.role, ADMIN), eq(users.status, 'active')))
    .orderBy(asc(users.id)).for('update');
  const caller = await callerOf(ctx);
  const [target] = await tx.select({ role: users.role, status: users.status }).from(users).where(eq(users.id, id)).limit(1)
    .for('update');
  if (target === undefined) throw new AppError('not_found', 'There is no such person');
  if (!mayGive(caller, target.role, (await keysByRole(tx)).get(target.role) ?? [])) throw notGrantable();
  if (target.status === 'disabled') throw new AppError('already_disabled', 'This person is already deactivated');
  if (target.role === ADMIN && target.status === 'active' && admins.filter((a) => a.id !== id).length === 0) {
    throw new AppError('last_admin', 'Someone has to stay an admin: give another person the admin role first');
  }
  const now = new Date();
  await tx.update(users).set({ status: 'disabled' }).where(eq(users.id, id));
  await tx.update(invites).set({ usedAt: now }).where(and(eq(invites.userId, id), isNull(invites.usedAt)));
  await tx.update(passwordResets).set({ usedAt: now }).where(and(eq(passwordResets.userId, id), isNull(passwordResets.usedAt)));
  return { sessionsEnded: await endSessionsOf(ctx, id, 'deactivated') };
}

/** POST /admin/users/:id/reactivate (users:write): back to active, or to invited if they never set a password. An
 * invited person gets no new link here; resend the invite for that. */
export async function reactivatePerson(ctx: Ctx, { id }: In<typeof reactivateUser>): Promise<Out<typeof reactivateUser>> {
  const caller = await callerOf(ctx);
  const tx = platformTx(ctx);
  const [target] = await tx.select({ role: users.role, status: users.status, hash: users.passwordHash }).from(users)
    .where(eq(users.id, id)).limit(1).for('update');
  if (target === undefined) throw new AppError('not_found', 'There is no such person');
  if (!mayGive(caller, target.role, (await keysByRole(tx)).get(target.role) ?? [])) throw notGrantable();
  if (target.status !== 'disabled') throw new AppError('not_disabled', 'This person isn’t deactivated');
  const status = target.hash === null ? 'invited' : 'active';
  await tx.update(users).set({ status }).where(eq(users.id, id));
  return { status };
}
