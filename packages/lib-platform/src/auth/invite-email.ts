// The invite email (M1-14, RAD-36, ADR-001 §7a, §8): an admin's invite or resend queues this job through the outbox,
// so a rolled-back invite queues nothing. The job mints a one-time link for a person still invited, spending any link
// they had, and emails it after its transaction commits; a second transaction records it as sent. Run again with the
// same job id, it finds its own sent link and sends nothing more. The payload is the person's id, never their address.
import { createHash, randomBytes } from 'node:crypto';
import { idString } from '@radcore/lib-common';
import { invites, platformTx, users } from '@radcore/db/platform';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { defineJob, type JobContract, type JobDefinition } from '../jobs.ts';
import type { Mailer } from '../mail.ts';

export const INVITE_EMAIL: JobContract<{ userId: string }> = {
  name: 'platform.invite-email',
  principal: { kind: 'system', name: 'invites', permissions: [] },
  input: z.object({ userId: idString() }),
};
/** An invite lasts a week, as the first admin's does (ADR-004 §3). */
const INVITE_DAYS = 7;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

type ToSend = { to: string; token: string; jobId: string } | null;

/** The worker's job: built at start with the mailer and PUBLIC_ORIGIN, for the link. */
export function inviteEmailJob({ mailer, publicOrigin }: { mailer: Mailer; publicOrigin: string }): JobDefinition {
  return defineJob(INVITE_EMAIL, async (ctx, { userId }, { jobId }): Promise<ToSend> => {
    const tx = platformTx(ctx);
    const [earlier] = await tx.select({ id: invites.id, sentAt: invites.sentAt }).from(invites).where(eq(invites.jobId, jobId))
      .for('update');
    if (earlier?.sentAt !== null && earlier?.sentAt !== undefined) return null;
    // Only someone still invited gets a link: accepted, or deactivated since, gets nothing.
    const [person] = await tx.select({ email: users.email }).from(users)
      .where(and(eq(users.id, userId), eq(users.status, 'invited'))).limit(1).for('update');
    if (person === undefined) return null;
    // Every link the person had stops working, this job's unsent one included: only the newest invite opens.
    await tx.update(invites).set({ usedAt: new Date(), jobId: null }).where(and(eq(invites.userId, userId), isNull(invites.usedAt)));
    const token = randomBytes(32).toString('base64url');
    await tx.insert(invites).values({ userId, tokenHash: sha256(token), jobId,
      expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000) });
    return { to: person.email, token, jobId };
  }, { afterCommit: async (toSend, again) => {
    if (toSend === null) return;
    // The token is in the fragment, which browsers never send to a server (ADR-001 §7a). Neither mailer logs this text.
    await mailer.send({ to: toSend.to, subject: 'You’re invited to RadCore', text: [
      'You’ve been given an account on RadCore. Choose your password within a week by opening this link:',
      '', `${publicOrigin}/invite#token=${toSend.token}`, ''].join('\n') });
    await again(async (ctx) => {
      await platformTx(ctx).update(invites).set({ sentAt: new Date() }).where(eq(invites.jobId, toSend.jobId));
    });
  } });
}
