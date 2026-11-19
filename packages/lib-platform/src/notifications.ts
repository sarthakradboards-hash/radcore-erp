// In-app notifications (M3-17, RAD-121, RC-142): a library declares each kind once, `defineNotification('crm.
// repeat_enquiry', { table: 'leads', label, describe })`, and its service raises one with `notify(ctx, kind, …)` inside
// its own save, so a save that rolls back raises none. A notification stores references only: its kind, and the
// record's table and id. Its text is built when it's read, by the kind's `describe`, run with the viewer's ctx, so the
// viewer's keys and sight (ctx.shows) decide what it says (M6-16); a record it can't describe shows the kind's label.
// Each person reads, counts and marks only their own (the /me routes).
import { after, notifications, platformTx } from '@radcore/db/platform';
import { and, desc, eq, inArray, isNull, count } from 'drizzle-orm';
import { z } from 'zod';
import type { countMyNotifications, listMyNotifications, markMyNotificationsRead } from './contract/notifications.ts';
import type { Ctx } from './ctx.ts';
import { decodeCursor, encodeCursor, isoMoment, momentKey } from './lists.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;

/** One kind of notification: about a record of one table, with the words to show when the record can't be described. */
export type NotificationKind = Readonly<{
  kind: string;
  table: string;
  label: string;
  /** The text for each of these records the viewer may see, built with the viewer's ctx and masked for them (ctx.shows).
   * A record left out of the map shows the label. */
  describe?: ((ctx: Ctx, recordIds: readonly string[]) => Promise<ReadonlyMap<string, string>>) | undefined;
}>;

const KIND = /^(platform|hr|gst|ops|accounts|crm|stock|payroll|purchasing|sales|service)\.[a-z][a-z0-9_]*$/;
const TABLE = /^[a-z][a-z0-9_]*$/;
// What a notification of a kind this process doesn't know says: nothing about its record.
const UNKNOWN = 'Something needs your attention';
const kinds = new Map<string, NotificationKind>();

/** Declares a kind of notification. Throws at load time on a bad name or table, an empty label, or a kind declared twice. */
export function defineNotification(kind: string, spec: Omit<NotificationKind, 'kind'>): NotificationKind {
  if (!KIND.test(kind)) throw new TypeError(`Notification kind "${kind}" must be <module>.<name> in lower case`);
  if (!TABLE.test(spec.table)) throw new TypeError(`Notification kind ${kind}: "${spec.table}" isn't a table name`);
  if (spec.label.trim() === '') throw new TypeError(`Notification kind ${kind} needs a label`);
  if (kinds.has(kind)) throw new TypeError(`Notification kind ${kind} is declared twice`);
  const def: NotificationKind = Object.freeze({ kind, ...spec });
  kinds.set(kind, def);
  return def;
}

/** Raises a notification for a person about a record, in the caller's transaction: none if the save rolls back. */
export async function notify(ctx: Ctx, kind: NotificationKind, n: Readonly<{ to: string; recordId: string }>): Promise<void> {
  await platformTx(ctx).insert(notifications).values({ userId: n.to, kind: kind.kind, recordTable: kind.table, recordId: n.recordId });
}

/** The viewer's user id, or null for a principal that isn't a person (a link or the system), who has none. */
const viewerOf = (ctx: Ctx): string | null => (ctx.principal.kind === 'user' ? ctx.principal.userId : null);

/** GET /me/notifications/unread: how many of the viewer's own are unread. The bell asks every minute, as /me is. */
export async function unreadNotifications(ctx: Ctx): Promise<Out<typeof countMyNotifications>> {
  const me = viewerOf(ctx);
  if (me === null) return { unread: 0 };
  const [row] = await platformTx(ctx).select({ n: count() }).from(notifications)
    .where(and(eq(notifications.userId, me), isNull(notifications.readAt)));
  return { unread: row?.n ?? 0 };
}

/** GET /me/notifications: the viewer's own, newest first, then by id, so a page key is unique and paging never skips. */
export async function myNotificationsPage(ctx: Ctx, input: In<typeof listMyNotifications>): Promise<Out<typeof listMyNotifications>> {
  const me = viewerOf(ctx);
  if (me === null) return { items: [], next: null };
  const key = input.after === undefined ? undefined : decodeCursor(z.object({ at: momentKey(), id: z.uuid() }), input.after);
  const rows = await platformTx(ctx).select({ id: notifications.id, kind: notifications.kind, table: notifications.recordTable,
    recordId: notifications.recordId, at: notifications.at, readAt: notifications.readAt }).from(notifications)
    .where(and(eq(notifications.userId, me), input.filter.unread === true ? isNull(notifications.readAt) : undefined,
      after([notifications.at, notifications.id], key && [key.at, key.id], 'desc')))
    .orderBy(desc(notifications.at), desc(notifications.id)).limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  // Each kind describes its own records in one call, with the viewer's ctx.
  const texts = new Map<string, string>();
  for (const kind of new Set(page.map((r) => r.kind))) {
    const def = kinds.get(kind);
    if (def?.describe === undefined) continue;
    const ofKind = page.filter((r) => r.kind === kind);
    // One kind that fails to describe its records shows its label, never fails everyone's list (the auditor on #227).
    const described = await def.describe(ctx, [...new Set(ofKind.map((r) => r.recordId))])
      .catch((): ReadonlyMap<string, string> => new Map());
    for (const r of ofKind) {
      const text = described.get(r.recordId);
      if (text !== undefined) texts.set(r.id, text);
    }
  }
  const last = page.at(-1);
  return {
    items: page.map((r) => ({ id: r.id, kind: r.kind, record: { table: r.table, id: r.recordId },
      text: texts.get(r.id) ?? kinds.get(r.kind)?.label ?? UNKNOWN, at: isoMoment(r.at), readAt: r.readAt?.toISOString() ?? null })),
    next: rows.length > input.limit && last ? encodeCursor({ at: last.at, id: last.id }) : null,
  };
}

/** POST /me/notifications/read: marks these of the viewer's own as read, or all of them when no ids are sent. Another
 * person's id is passed over, never marked. */
export async function markNotificationsRead(ctx: Ctx, { ids }: In<typeof markMyNotificationsRead>):
  Promise<Out<typeof markMyNotificationsRead>> {
  const me = viewerOf(ctx);
  if (me === null) return { marked: 0 };
  const marked = await platformTx(ctx).update(notifications).set({ readAt: new Date() })
    .where(and(eq(notifications.userId, me), isNull(notifications.readAt), ids === undefined ? undefined : inArray(notifications.id, ids)))
    .returning({ id: notifications.id });
  return { marked: marked.length };
}
