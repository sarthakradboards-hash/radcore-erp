// The password-reset request and its email (M1-14, ADR-001 §7a, RAD-68). The request answers the same, in the same
// time, for any address: it only queues the email job through the outbox, so a rolled-back request queues nothing.
// The worker looks the address up and emails a one-time link only if an active account has it, at most once per
// address in a short window. The job's payload holds a typed address, so it is deleted as soon as it completes.
// The email goes out after the job's transaction commits (ADR-001 §8), and a second transaction records it as sent;
// run again with the same job id, the job finds its own sent link and sends nothing more.
import { createHash, randomBytes } from 'node:crypto';
import { normaliseEmail } from '@radcore/lib-common';
import { passwordResets, platformTx, users } from '@radcore/db/platform';
import { and, eq, gt } from 'drizzle-orm';
import { z } from 'zod';
import type { Ctx } from '../ctx.ts';
import { defineJob, type JobContract, type JobDefinition } from '../jobs.ts';
import type { Mailer } from '../mail.ts';

export const PASSWORD_RESET_EMAIL: JobContract<{ email: string }> = {
  name: 'platform.password-reset-email',
  principal: { kind: 'system', name: 'password-reset', permissions: [] },
  input: z.object({ email: z.string().max(254) }),
  deleteOnComplete: true,
};
const LINK_SECONDS = 60 * 60;
/** At most one reset email per address in this many seconds, so the form can't flood an inbox (ADR-001 §7a). */
const WINDOW_SECONDS = 10 * 60;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const secondsFromNow = (s: number) => new Date(Date.now() + s * 1000);

export async function requestPasswordReset(ctx: Ctx, { email }: { email: string }): Promise<Record<string, never>> {
  await ctx.jobs.send(PASSWORD_RESET_EMAIL, { email: normaliseEmail(email) });
  return {};
}

type ToSend = { to: string; token: string; jobId: string } | null;

/** The worker's job: built at start with the mailer and PUBLIC_ORIGIN, for the links. */
export function passwordResetEmailJob({ mailer, publicOrigin }: { mailer: Mailer; publicOrigin: string }): JobDefinition {
  return defineJob(PASSWORD_RESET_EMAIL, async (ctx, { email }, { jobId }): Promise<ToSend> => {
    const tx = platformTx(ctx);
    const [earlier] = await tx.select({ id: passwordResets.id, sentAt: passwordResets.sentAt }).from(passwordResets)
      .where(eq(passwordResets.jobId, jobId)).for('update');
    if (earlier?.sentAt !== null && earlier?.sentAt !== undefined) return null;
    // A link this job minted but never mailed (its send failed): spent, and replaced below.
    if (earlier !== undefined) {
      await tx.update(passwordResets).set({ usedAt: new Date(), jobId: null }).where(eq(passwordResets.id, earlier.id));
    }
    const [user] = await tx.select({ id: users.id, email: users.email }).from(users)
      .where(and(eq(users.emailKey, normaliseEmail(email)), eq(users.status, 'active'))).limit(1);
    if (user === undefined) return null;
    const [recent] = await tx.select({ id: passwordResets.id }).from(passwordResets)
      .where(and(eq(passwordResets.userId, user.id), gt(passwordResets.sentAt, secondsFromNow(-WINDOW_SECONDS)))).limit(1);
    if (recent !== undefined) return null;
    const token = randomBytes(32).toString('base64url');
    await tx.insert(passwordResets).values({ userId: user.id, tokenHash: sha256(token), expiresAt: secondsFromNow(LINK_SECONDS), jobId });
    return { to: user.email, token, jobId };
  }, async (toSend, again) => {
    if (toSend === null) return;
    // The token is in the fragment, which browsers never send to a server (ADR-001 §7a). Neither mailer logs this text.
    await mailer.send({ to: toSend.to, subject: 'Reset your RadCore password', text: [
      'Someone asked to reset the password for this address. If it was you, open this link within an hour:',
      '', `${publicOrigin}/password-reset/new#token=${toSend.token}`, '',
      'If it wasn’t you, ignore this email: your password stays as it is.'].join('\n') });
    await again(async (ctx) => {
      await platformTx(ctx).update(passwordResets).set({ sentAt: new Date() }).where(eq(passwordResets.jobId, toSend.jobId));
    });
  });
}
