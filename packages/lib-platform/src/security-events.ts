// Security events (RAD-31, M1-13, RC-031): sign-in, a failed sign-in, a password or second-factor change, every export
// and every download leave one event_log row. v1 left 33 of 230 write routes with no trace, every sign-in and password
// change among them. The row is written only through record_event (ADR-005 §7c), as the request's principal, at the
// database's time; the app can't insert, change or delete one.
// `detail` holds references only (M6-16: references, not copies): each kind's schema below is strict, so no typed
// email, password, code or token can ride along. `userId` is the account the event concerns, which the principal
// can't say: a sign-in runs as system:public. It's null when a failed sign-in's email matched nobody.
import { addDays, idString } from '@radcore/lib-common';
import { after, eventLog, onIndiaDays, platformTx, users } from '@radcore/db/platform';
import { recordEvent } from '@radcore/db/request-context';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { AUDIT_RANGE_MAX_DAYS, SECURITY_EVENT_KINDS, type listSecurityEvents } from './contract.ts';
import type { Ctx } from './ctx.ts';
import { AppError } from './errors.ts';
import { decodeCursor, encodeCursor } from './lists.ts';

const listName = () => z.string().regex(/^[a-z][a-z0-9_.-]{0,62}$/, 'A list name, such as sales.invoices');

const securityEvent = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('sign_in'), detail: z.strictObject({}) }),
  z.strictObject({ kind: z.literal('sign_in_failed'), detail: z.strictObject({
    reason: z.enum(['invalid_credentials', 'second_factor', 'account_locked', 'rate_limited']) }) }),
  z.strictObject({ kind: z.literal('password_changed'), detail: z.strictObject({ how: z.enum(['change', 'reset', 'invite']) }) }),
  z.strictObject({ kind: z.literal('second_factor_changed'), detail: z.strictObject({
    change: z.enum(['enrolled', 'removed', 'recovery_codes']) }) }),
  z.strictObject({ kind: z.literal('export'), detail: z.strictObject({ what: listName(), rows: z.number().int().nonnegative() }) }),
  z.strictObject({ kind: z.literal('download'), detail: z.strictObject({ fileId: idString() }) }),
]);
export type SecurityEvent = z.input<typeof securityEvent>;
// The contract's list and these schemas name the same kinds, in both directions.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const sameKinds: Same<SecurityEvent['kind'], (typeof SECURITY_EVENT_KINDS)[number]> = true;
void sameKinds;

/** Who the event concerns and from what device ("Chrome on Android", never an address); either may be unknown. */
export type EventSubject = { userId: string | null; device: string | null };

/** Appends one security event in the caller's transaction: it's kept only if the work it records commits. */
export async function recordSecurityEvent(ctx: Ctx, event: SecurityEvent, subject: EventSubject): Promise<void> {
  const { kind, detail } = securityEvent.parse(event);
  await recordEvent(ctx.tx, { kind, userId: subject.userId, device: subject.device?.slice(0, 80) ?? null, detail });
}

// The page key: occurred_at, then seq, which orders the rows of one transaction (they share occurred_at).
const pageKey = z.strictObject({ occurredAt: z.iso.datetime({ offset: true }), seq: z.number().int().positive() });
type Input = z.output<typeof listSecurityEvents.input>;
type Output = z.input<typeof listSecurityEvents.output>;

/** listSecurityEvents (audit:read): newest first, within a date range of at most AUDIT_RANGE_MAX_DAYS India days. */
export async function listSecurityEventsPage(ctx: Ctx, input: Input): Promise<Output> {
  const { occurred, kind, principal } = input.filter;
  if (addDays(occurred.from, AUDIT_RANGE_MAX_DAYS - 1) < occurred.to) {
    throw new AppError('range_too_long', `Choose a range of at most ${String(AUDIT_RANGE_MAX_DAYS)} days`);
  }
  const key = input.after === undefined ? undefined : decodeCursor(pageKey, input.after);
  const rows = await platformTx(ctx).select({
    id: eventLog.id, occurredAt: eventLog.occurredAt, seq: eventLog.seq, kind: eventLog.kind, userId: eventLog.userId,
    device: eventLog.device, detail: eventLog.detail, createdBy: eventLog.createdBy, displayName: users.displayName,
  }).from(eventLog).leftJoin(users, eq(users.id, eventLog.userId))
    .where(and(
      onIndiaDays(eventLog.occurredAt, occurred),
      kind === undefined ? undefined : eq(eventLog.kind, kind),
      principal === undefined ? undefined : eq(eventLog.userId, principal),
      after([eventLog.occurredAt, eventLog.seq], key && [key.occurredAt, key.seq], 'desc'),
    ))
    .orderBy(desc(eventLog.occurredAt), desc(eventLog.seq))
    .limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return {
    items: page.map((r) => ({
      id: r.id,
      occurredAt: new Date(r.occurredAt).toISOString(),
      kind: z.enum(SECURITY_EVENT_KINDS).parse(r.kind),
      principal: principalOf(r.userId, r.displayName, r.createdBy),
      device: r.device ?? '',
      detail: z.record(z.string(), z.json()).parse(r.detail),
    })),
    next: rows.length > input.limit && last
      ? encodeCursor({ occurredAt: new Date(last.occurredAt).toISOString(), seq: last.seq }) : null,
  };
}

// The account concerned; else a system principal that did it (a job's export); else nobody (an unmatched sign-in).
function principalOf(userId: string | null, displayName: string | null, createdBy: string): Output['items'][number]['principal'] {
  if (userId !== null) return { kind: 'user', id: userId, displayName };
  if (createdBy.startsWith('system:') && createdBy !== 'system:public') {
    return { kind: 'system', id: createdBy.slice('system:'.length), displayName: null };
  }
  return null;
}
