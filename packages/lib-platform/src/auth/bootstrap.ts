// The first admin (M1-14, ADR-004 §3, RC-021). A one-off command, run by the deploy job, invites SEED_ADMIN_EMAIL to
// set a password: nobody chooses or sees it, and nothing is printed or logged but a masked address. It runs as the
// runtime login, as system:seed. The permanent bootstrap record makes the invite once ever; until someone accepts
// it, `--reissue` spends the old link and mails a new one, only to the address first invited. Once an admin exists,
// the command does nothing. The email goes out after the transaction commits (ADR-001 §8), then is marked sent.
import { createHash, randomBytes } from 'node:crypto';
import { emailString, normaliseEmail } from '@radcore/lib-common';
import { bootstrap, invites, platformTx, users } from '@radcore/db/platform';
import type { Database } from '@radcore/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import type { Principal } from '../ctx.ts';
import { loadConfig } from '../config.ts';
import { createDatabase, createPool } from '../db/client.ts';
import { runInTransaction } from '../db/transaction.ts';
import type { Logger } from '../log.ts';
import { mailerFor, maskEmail, type Mailer } from '../mail.ts';
import { assignRole } from './roles.ts';

export type BootstrapOutcome = 'invited' | 'reissued' | 'already_bootstrapped' | 'admin_exists';

type Options = {
  /** SEED_ADMIN_EMAIL. */
  email: string;
  reissue: boolean;
  mailer: Mailer;
  /** PUBLIC_ORIGIN, for the link. */
  publicOrigin: string;
};

const SEED: Principal = Object.freeze({ kind: 'system', name: 'seed', permissions: Object.freeze([]) });
const write = { readOnly: false, isolation: 'read committed' } as const;
const INVITE_DAYS = 7;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

type Minted = { outcome: 'invited' | 'reissued'; to: string; token: string; inviteId: string };

export async function bootstrapAdmin(db: Database, { email, reissue, mailer, publicOrigin }: Options):
  Promise<{ outcome: BootstrapOutcome; to: string | null }> {
  const seed = normaliseEmail(email);
  const minted = await runInTransaction(db, write, SEED, 'bootstrap-admin', async (ctx): Promise<Minted | BootstrapOutcome> => {
    const tx = platformTx(ctx);
    // The record can't be locked (the runtime login has no UPDATE on it), and its key stops a second first run; the
    // user's row is locked instead, so two re-issues queue.
    const [first] = await tx.select({ userId: bootstrap.userId }).from(bootstrap).limit(1);
    const [record] = first === undefined ? [] : await tx.select({ userId: users.id, email: users.email, status: users.status })
      .from(users).where(eq(users.id, first.userId)).for('update');
    let userId: string;
    let outcome: Minted['outcome'];
    if (record === undefined) {
      const [user] = await tx.insert(users).values({ email: seed, displayName: 'Administrator' }).returning({ id: users.id });
      userId = user?.id ?? '';
      await tx.insert(bootstrap).values({ key: 'first_admin', userId });
      // Always the admin role, in the same transaction as the invite: no caller can make a first admin without it (RC-021).
      await assignRole(ctx, userId, 'admin');
      outcome = 'invited';
    } else if (record.status !== 'invited') {
      return 'admin_exists';
    } else if (!reissue) {
      return 'already_bootstrapped';
    } else {
      if (normaliseEmail(record.email) !== seed) {
        throw new Error('A re-issued first-admin invite goes only to the address first invited: SEED_ADMIN_EMAIL has changed');
      }
      userId = record.userId;
      await tx.update(invites).set({ usedAt: new Date() }).where(and(eq(invites.userId, userId), isNull(invites.usedAt)));
      outcome = 'reissued';
    }
    const token = randomBytes(32).toString('base64url');
    const [invite] = await tx.insert(invites).values({ userId, tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000) }).returning({ id: invites.id });
    return { outcome, to: seed, token, inviteId: invite?.id ?? '' };
  });
  if (typeof minted === 'string') return { outcome: minted, to: null };
  // The token is in the fragment, which browsers never send to a server (ADR-001 §7a). Neither mailer logs this text.
  await mailer.send({ to: minted.to, subject: 'Set up your RadCore account', text: [
    'You’re the first administrator of RadCore. Choose your password within a week by opening this link:',
    '', `${publicOrigin}/invite#token=${minted.token}`, ''].join('\n') });
  await runInTransaction(db, write, SEED, 'bootstrap-admin', async (ctx) => {
    await platformTx(ctx).update(invites).set({ sentAt: new Date() }).where(eq(invites.id, minted.inviteId));
  });
  return { outcome: minted.outcome, to: maskEmail(minted.to) };
}

/**
 * The bootstrap-admin command (apps/api), as the deploy job runs it once through SSM: the api's settings checked,
 * SEED_ADMIN_EMAIL read from Parameter Store, the invite sent, and one line back that names only a masked address.
 */
export async function runBootstrapAdmin(env: Record<string, string | undefined>, log: Logger, { reissue }: { reissue: boolean }):
  Promise<string> {
  const config = loadConfig(env, 'api');
  const seed = emailString().safeParse(env['SEED_ADMIN_EMAIL']);
  if (!seed.success) throw new Error('SEED_ADMIN_EMAIL is not set to an email address');
  const pool = createPool(config.database, log);
  try {
    const { outcome, to } = await bootstrapAdmin(createDatabase(pool), { email: seed.data, reissue, mailer: mailerFor(config, log),
      publicOrigin: config.publicOrigin });
    return to === null ? `first admin: ${outcome}, nothing sent` : `first admin: ${outcome}, invite sent to ${to}`;
  } finally {
    await pool.end();
  }
}
