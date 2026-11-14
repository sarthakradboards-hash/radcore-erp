// Sign-in sessions (M1-16, RAD-34, ADR-001 §7a, RC-091). A session is a random token in the person's cookie
// (HttpOnly, SameSite=Lax, Path=/, and on https `__Host-` and Secure: sessionCookieFor); only its SHA-256 is stored. It signs nobody
// in after 30 minutes without a request or 12 hours after sign-in, whichever comes first (Sarthak, 11 Nov 2026), or
// once it's ended: by sign-out, by the person from their sessions list, by an admin, or by a password, role or status
// change. Each end is one session_ended security event per session; a sign-in is sign_in (ADR-005 §7c).
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { idString, normaliseEmail } from '@radcore/lib-common';
import { after, platformTx, sessions, users } from '@radcore/db/platform';
import type { Database } from '@radcore/db/schema';
import { and, desc, eq, gt, isNull, ne, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { endMySession, endSession, endUserSessions, getMe, listMySessions, listSessions, signIn } from '../contract.ts';
import type { Ctx, Principal, SessionCookie } from '../ctx.ts';
import { runInTransaction } from '../db/transaction.ts';
import { AppError, RecordedRefusal } from '../errors.ts';
import { decodeCursor, encodeCursor, isoMoment, momentKey } from '../lists.ts';
import { recordSecurityEvent } from '../security-events.ts';
import { principalFor } from './principal.ts';
import type { SignInResult } from './sign-in.ts';

export const SESSION_IDLE_SECONDS = 30 * 60;
export const SESSION_ABSOLUTE_SECONDS = 12 * 60 * 60;
export type EndedReason = 'sign_out' | 'admin' | 'password_changed' | 'password_reset' | 'role_changed' | 'deactivated';

const LOOKUP: Principal = Object.freeze({ kind: 'system', name: 'session', permissions: Object.freeze([]) });
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
// The idle expiry moves at most once a minute, so a burst of requests writes the row once.
const TOUCH_AFTER_MS = 60_000;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const live = (now: Date) => and(isNull(sessions.endedAt), gt(sessions.idleExpiresAt, now), gt(sessions.absoluteExpiresAt, now));
const idleUntil = (now: Date, absolute: Date) => new Date(Math.min(now.getTime() + SESSION_IDLE_SECONDS * 1000, absolute.getTime()));
const signedOut = () => new AppError('signed_out', 'Please sign in');

// Most specific first: Edge and Opera also say Chrome, Chrome also says Safari, Android also says Linux.
const BROWSERS: readonly (readonly [RegExp, string])[] = [[/Edg(e|A|iOS)?\//, 'Edge'], [/OPR\//, 'Opera'],
  [/Firefox\/|FxiOS/, 'Firefox'], [/Chrome\/|CriOS/, 'Chrome'], [/Safari\//, 'Safari']];
const SYSTEMS: readonly (readonly [RegExp, string])[] = [[/Android/, 'Android'], [/iPhone|iPad|iPod/, 'iOS'],
  [/Windows/, 'Windows'], [/CrOS/, 'ChromeOS'], [/Macintosh|Mac OS X/, 'macOS'], [/Linux/, 'Linux']];

/** "Chrome on Android" from a User-Agent header: what the sessions list shows, never an address (ADR-001 §7a). */
export function deviceOf(userAgent: string | undefined): string {
  const ua = userAgent ?? '';
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1];
  const system = SYSTEMS.find(([re]) => re.test(ua))?.[1];
  if (browser !== undefined && system !== undefined) return `${browser} on ${system}`;
  return browser ?? system ?? 'Unknown device';
}

export type SessionCookieKind = {
  readonly name: string;
  readonly secure: boolean;
  /** The session token in a Cookie header, or null. */
  tokenIn(header: string | undefined): string | null;
};

/**
 * The session cookie for this PUBLIC_ORIGIN. A deployed origin is https (config insists), and there it's
 * `__Host-radcore_session`, Secure. Over plain http, which only development and CI use, it's `radcore_session` and
 * not Secure: WebKit stores a Secure cookie from http://127.0.0.1 but never sends it back (checked 11 Nov 2026 with
 * Playwright's WebKit; Chromium and Firefox do send it), so Safari could never stay signed in during development.
 */
export function sessionCookieFor(publicOrigin: string): SessionCookieKind {
  const secure = publicOrigin.startsWith('https://');
  const name = secure ? '__Host-radcore_session' : 'radcore_session';
  const pattern = new RegExp(`(?:^|;\\s*)${name}=([A-Za-z0-9_-]{43})(?:;|$)`);
  return Object.freeze({ name, secure, tokenIn: (header: string | undefined) => pattern.exec(header ?? '')?.[1] ?? null });
}

/**
 * Who a session token signs in, or null: an unknown, ended or expired session, or a person no longer active. With
 * `touch`, the request counts as activity and the idle expiry moves on, never past the absolute one; GET /me doesn't
 * touch, so the shell's per-minute refresh can't keep an idle session alive (RAD-52).
 */
export async function authenticateSession(db: Database, token: string | null, { touch }: { touch: boolean }):
  Promise<Principal | null> {
  if (token === null || !TOKEN.test(token)) return null;
  return runInTransaction(db, WRITE, LOOKUP, randomUUID(), async (ctx) => {
    const tx = platformTx(ctx);
    const now = new Date();
    const [found] = await tx.select({ id: sessions.id, userId: sessions.userId, lastSeenAt: sessions.lastSeenAt,
      absoluteExpiresAt: sessions.absoluteExpiresAt }).from(sessions).innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, sha256(token)), live(now), eq(users.status, 'active'))).limit(1);
    if (found === undefined) return null;
    if (touch && Date.parse(isoMoment(found.lastSeenAt)) < now.getTime() - TOUCH_AFTER_MS) {
      await tx.update(sessions).set({ lastSeenAt: now.toISOString(), idleExpiresAt: idleUntil(now, found.absoluteExpiresAt) })
        .where(eq(sessions.id, found.id));
    }
    // Their role's keys as they are now, read on every request (RAD-35, RC-095).
    return principalFor(ctx, found.userId, found.id);
  });
}

/** Ends what `where` picks of the live sessions, each with its security event; returns how many. */
async function end(ctx: Ctx, where: SQL | undefined, reason: EndedReason): Promise<number> {
  const now = new Date();
  const ended = await platformTx(ctx).update(sessions).set({ endedAt: now, endedReason: reason })
    .where(and(where, live(now))).returning({ userId: sessions.userId, device: sessions.device });
  for (const subject of ended) await recordSecurityEvent(ctx, { kind: 'session_ended', detail: { reason } }, subject);
  return ended.length;
}

/** Ends a person's live sessions, but `keep` (the caller's own, on a password change); for RAD-35's role change and
 * RAD-36's deactivation too. Returns how many ended. */
export const endSessionsOf = (ctx: Ctx, userId: string, reason: EndedReason, { keep }: { keep?: string | undefined } = {}) =>
  end(ctx, and(eq(sessions.userId, userId), keep === undefined ? undefined : ne(sessions.id, keep)), reason);

const own = (ctx: Ctx): { userId: string; sessionId: string } => {
  const p = ctx.principal;
  if (p.kind !== 'user' || p.sessionId === undefined) throw signedOut();
  return { userId: p.userId, sessionId: p.sessionId };
};
const cookieOf = (ctx: Ctx): SessionCookie => {
  if (ctx.cookie === undefined) throw new TypeError('This service sets the session cookie: mount it on a key-exempt route');
  return ctx.cookie;
};

type Out<C extends { output: z.ZodType }> = z.input<C['output']>;
type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Credentials = (ctx: Ctx, input: In<typeof signIn>) => Promise<SignInResult>;
const FAILED = ['invalid_credentials', 'account_locked'] as const;
const isFailure = (code: string): code is (typeof FAILED)[number] => (FAILED as readonly string[]).includes(code);

/**
 * POST /sign-in over the credential step (createSignIn). A success with nothing more to prove starts a session and
 * sets its cookie; a failure is recorded, and that record commits though the answer is a refusal.
 */
export function signInService(credentials: Credentials) {
  return async (ctx: Ctx, input: In<typeof signIn>): Promise<Out<typeof signIn>> => {
    const cookie = cookieOf(ctx);
    let result: SignInResult;
    try {
      result = await credentials(ctx, input);
    } catch (err) {
      if (!(err instanceof AppError) || !isFailure(err.code)) throw err;
      const [known] = await platformTx(ctx).select({ id: users.id }).from(users)
        .where(eq(users.emailKey, normaliseEmail(input.email))).limit(1);
      // Every refusal is recorded, known address or not, so both do the same work and timing can't tell them apart
      // (RAD-64). The per-IP limit (RAD-39) bounds how many rows one source can add.
      await recordSecurityEvent(ctx, { kind: 'sign_in_failed', detail: { reason: err.code } },
        { userId: known?.id ?? null, device: cookie.device });
      throw new RecordedRefusal(err.code, err.message, err.issues, err.retryAfterSeconds);
    }
    // shortcut: second_factor and enrol_second_factor set RAD-33's pending-sign-in cookie, which lands with it.
    if (result.next !== 'done') return { next: result.next };
    // The session this browser already had ends, so it doesn't linger on a shared computer.
    if (cookie.incoming !== null) await end(ctx, eq(sessions.tokenHash, sha256(cookie.incoming)), 'sign_out');
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    const absolute = new Date(now.getTime() + SESSION_ABSOLUTE_SECONDS * 1000);
    await platformTx(ctx).insert(sessions).values({ userId: result.userId, tokenHash: sha256(token), device: cookie.device,
      idleExpiresAt: idleUntil(now, absolute), absoluteExpiresAt: absolute });
    await recordSecurityEvent(ctx, { kind: 'sign_in', detail: {} }, { userId: result.userId, device: cookie.device });
    cookie.set(token, absolute);
    return { next: 'done' };
  };
}

/** POST /sign-out: ends this session and clears its cookie. */
export async function endCurrentSession(ctx: Ctx): Promise<Record<string, never>> {
  const cookie = cookieOf(ctx);
  await end(ctx, eq(sessions.id, own(ctx).sessionId), 'sign_out');
  cookie.clear();
  return {};
}

/** GET /me. */
export async function getMyself(ctx: Ctx): Promise<Out<typeof getMe>> {
  const { userId, sessionId } = own(ctx);
  const [row] = await platformTx(ctx).select({ displayName: users.displayName, idle: sessions.idleExpiresAt,
    absolute: sessions.absoluteExpiresAt }).from(sessions).innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, sessionId)).limit(1);
  if (row === undefined) throw signedOut();
  return {
    user: { id: userId, displayName: row.displayName },
    permissions: [...ctx.principal.permissions].toSorted(),
    session: { idleExpiresAt: row.idle.toISOString(), absoluteExpiresAt: row.absolute.toISOString() },
    // shortcut: D-19's answer comes from the person's role and enrolment with RAD-33.
    secondFactor: 'not_required',
  };
}

// Newest activity first; last_seen_at is PostgreSQL's own text, so the key keeps its microseconds.
const pageKey = z.strictObject({ lastSeenAt: momentKey(), id: idString() });

async function livePage(ctx: Ctx, where: SQL | undefined, { after: cursor, limit }: { after?: string | undefined; limit: number }) {
  const key = cursor === undefined ? undefined : decodeCursor(pageKey, cursor);
  const rows = await platformTx(ctx).select({ id: sessions.id, userId: sessions.userId, displayName: users.displayName,
    device: sessions.device, createdAt: sessions.createdAt, lastSeenAt: sessions.lastSeenAt,
    idleExpiresAt: sessions.idleExpiresAt, absoluteExpiresAt: sessions.absoluteExpiresAt })
    .from(sessions).innerJoin(users, eq(users.id, sessions.userId))
    .where(and(where, live(new Date()), after([sessions.lastSeenAt, sessions.id], key && [key.lastSeenAt, key.id], 'desc')))
    .orderBy(desc(sessions.lastSeenAt), desc(sessions.id)).limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return { page, next: rows.length > limit && last ? encodeCursor({ lastSeenAt: last.lastSeenAt, id: last.id }) : null };
}

/** GET /me/sessions. */
export async function listOwnSessions(ctx: Ctx, input: In<typeof listMySessions>): Promise<Out<typeof listMySessions>> {
  const { userId, sessionId } = own(ctx);
  const { page, next } = await livePage(ctx, eq(sessions.userId, userId), input);
  return { items: page.map((s) => ({ id: s.id, current: s.id === sessionId, createdAt: s.createdAt.toISOString(),
    lastSeenAt: isoMoment(s.lastSeenAt), device: s.device })), next };
}

/** DELETE /me/sessions/:id: another of your own sessions. Someone else's answers not_found. */
export async function endOwnSession(ctx: Ctx, { id }: In<typeof endMySession>): Promise<Out<typeof endMySession>> {
  const { userId, sessionId } = own(ctx);
  if (id === sessionId) throw new AppError('current_session', 'To end this session, sign out');
  if (await end(ctx, and(eq(sessions.id, id), eq(sessions.userId, userId)), 'sign_out') === 0) {
    throw new AppError('not_found', 'That session has already ended');
  }
  return {};
}

/** GET /admin/sessions (users:read). */
export async function listAllSessions(ctx: Ctx, input: In<typeof listSessions>): Promise<Out<typeof listSessions>> {
  const current = ctx.principal.kind === 'user' ? ctx.principal.sessionId : undefined;
  const { userId } = input.filter;
  const { page, next } = await livePage(ctx, userId === undefined ? undefined : eq(sessions.userId, userId), input);
  return { items: page.map((s) => ({ id: s.id, user: { id: s.userId, displayName: s.displayName },
    createdAt: s.createdAt.toISOString(), lastSeenAt: isoMoment(s.lastSeenAt), idleExpiresAt: s.idleExpiresAt.toISOString(),
    absoluteExpiresAt: s.absoluteExpiresAt.toISOString(), device: s.device, current: s.id === current })), next };
}

/** DELETE /admin/sessions/:id (users:write): anyone's session but your current one. */
export async function endAnySession(ctx: Ctx, { id }: In<typeof endSession>): Promise<Out<typeof endSession>> {
  if (ctx.principal.kind === 'user' && id === ctx.principal.sessionId) {
    throw new AppError('current_session', 'To end this session, sign out');
  }
  if (await end(ctx, eq(sessions.id, id), 'admin') === 0) throw new AppError('not_found', 'That session has already ended');
  return {};
}

/** POST /admin/users/:id/sessions/end (users:write): every session of one person, never your own account. */
export async function endPersonSessions(ctx: Ctx, { id }: In<typeof endUserSessions>): Promise<Out<typeof endUserSessions>> {
  if (ctx.principal.kind === 'user' && id === ctx.principal.userId) {
    throw new AppError('own_account', 'To end your own sessions, use your sessions page');
  }
  return { ended: await endSessionsOf(ctx, id, 'admin') };
}
