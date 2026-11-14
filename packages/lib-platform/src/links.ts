// Public links (RAD-41, ADR-001 §6a, RC-047): a link lets whoever holds it do one action on one record, until it
// expires or is revoked, and nothing else. Its token is 32 random bytes, shown once to the service that made it, which
// puts it in the link's URL fragment (ADR-001 §7a: browsers never send a fragment to a server or in Referer). Only the
// token's SHA-256 is stored, and nothing else ever holds the token: other tables and the audit trail name the link by
// its id (`link:<id>`).
import { createHash, randomBytes } from 'node:crypto';
import { platformTx, publicLinks } from '@radcore/db/platform';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { principalId, type Ctx, type Principal } from './ctx.ts';
import { AppError } from './errors.ts';
import { defineSetting } from './settings.ts';

/** The longest a link may last, in days: every link expires within it (RAD-41). */
export const linkMaxDays = defineSetting('platform.link_max_days', z.number().int().min(1).max(365), 30);

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
/** `<module>.<what>`, as public_links' CHECK has it: `sales.invoice_view`. */
const ACTION = /^(platform|hr|gst|ops|accounts|crm|stock|payroll|purchasing|sales|service)\.[a-z][a-z0-9_]*$/;

export type NewLink = {
  /** The one thing the link lets its holder do, as its route contract names it. */
  action: string;
  /** The one record it lets them do it to. */
  recordId: string;
  /** When it stops working. Every link expires, within the `platform.link_max_days` setting (30 days). */
  expiresAt: Date;
  /** How many times it can be used; left out, any number until it expires. */
  uses?: number;
};

/**
 * Makes a link, in the caller's transaction, and returns its id and its token. The token is returned this once and
 * stored nowhere: the caller builds the URL with `linkUrl` and sends it. Only a person or a job makes a link; a link's
 * holder can't make another.
 */
export async function createLink(ctx: Ctx, link: NewLink): Promise<{ id: string; token: string }> {
  if (ctx.principal.kind === 'link') throw new AppError('forbidden', 'A link can\'t make another link');
  if (!ACTION.test(link.action)) throw new TypeError(`${link.action}: not a link action (<module>.<what>)`);
  const now = Date.now();
  if (!(link.expiresAt.getTime() > now)) throw new TypeError('a link must expire in the future');
  const maxDays = ctx.settings.get(linkMaxDays);
  if (link.expiresAt.getTime() > now + maxDays * 86_400_000) {
    throw new TypeError(`a link can last at most ${maxDays} days (platform.link_max_days)`);
  }
  if (link.uses !== undefined && !(Number.isInteger(link.uses) && link.uses >= 1)) {
    throw new TypeError('a link\'s uses must be a whole number of at least 1');
  }
  const token = randomBytes(32).toString('base64url');
  const [row] = await platformTx(ctx).insert(publicLinks).values({ action: link.action, recordId: link.recordId,
    tokenHash: sha256(token), expiresAt: link.expiresAt, usesLeft: link.uses ?? null }).returning({ id: publicLinks.id });
  if (row === undefined) throw new Error('the link was not stored');
  return { id: row.id, token };
}

/** The address of a link's page with its token in the fragment, never the path or the query (ADR-001 §7a). */
export const linkUrl = (origin: string, path: string, token: string): string => `${origin}${path}#token=${token}`;

/** Stops a link working, now. Revoking one already revoked changes nothing; an unknown id is not_found. */
export async function revokeLink(ctx: Ctx, id: string): Promise<void> {
  const tx = platformTx(ctx);
  const [found] = await tx.select({ revokedAt: publicLinks.revokedAt }).from(publicLinks).where(eq(publicLinks.id, id));
  if (found === undefined) throw new AppError('not_found', 'Not found');
  if (found.revokedAt !== null) return;
  await tx.update(publicLinks).set({ revokedAt: new Date(), revokedBy: principalId(ctx.principal) })
    .where(and(eq(publicLinks.id, id), isNull(publicLinks.revokedAt)));
}

/** A record's links for one action, newest first, for a screen that lists and revokes them. Never a token. */
export async function listLinks(ctx: Ctx, action: string, recordId: string) {
  const rows = await platformTx(ctx).select({ id: publicLinks.id, expiresAt: publicLinks.expiresAt,
    usesLeft: publicLinks.usesLeft, revokedAt: publicLinks.revokedAt, createdAt: publicLinks.createdAt,
    createdBy: publicLinks.createdBy })
    .from(publicLinks).where(and(eq(publicLinks.action, action), eq(publicLinks.recordId, recordId)))
    .orderBy(publicLinks.createdAt);
  return rows.reverse();
}

/**
 * The principal a token gives, for this action: only a link whose token hashes to it, made for exactly this action,
 * unrevoked, unexpired and with a use left. Anything else is null, whatever the reason, so the answer says nothing
 * about which links exist (one not_found for all).
 */
export async function linkPrincipal(ctx: Ctx, token: string, action: string): Promise<Principal | null> {
  const [link] = await platformTx(ctx).select({ id: publicLinks.id, recordId: publicLinks.recordId,
    usesLeft: publicLinks.usesLeft })
    .from(publicLinks).where(and(eq(publicLinks.tokenHash, sha256(token)), eq(publicLinks.action, action),
      isNull(publicLinks.revokedAt), gt(publicLinks.expiresAt, new Date())));
  if (link === undefined || link.usesLeft === 0) return null;
  return Object.freeze({ kind: 'link', linkId: link.id, action, recordId: link.recordId, permissions: Object.freeze([]) });
}

/**
 * Uses up one of a link's uses, in the transaction of the work it allows, so the use and the work commit together.
 * Refused (not_found, like any dead link) when none is left, including when two requests race for the last one. A link
 * with any number of uses is left as it is.
 */
export async function useLink(ctx: Ctx): Promise<void> {
  if (ctx.principal.kind !== 'link') throw new TypeError('useLink needs a link principal');
  const tx = platformTx(ctx);
  const [link] = await tx.select({ usesLeft: publicLinks.usesLeft }).from(publicLinks)
    .where(eq(publicLinks.id, ctx.principal.linkId)).for('update');
  if (link === undefined || link.usesLeft === 0) throw new AppError('not_found', 'Not found');
  if (link.usesLeft === null) return;
  await tx.update(publicLinks).set({ usesLeft: link.usesLeft - 1 }).where(eq(publicLinks.id, ctx.principal.linkId));
}
