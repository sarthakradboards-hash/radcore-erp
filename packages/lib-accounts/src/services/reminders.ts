// Reminders to a party of what it owes (M3-15, RAD-119; the architect's ruling). Each is recorded, append-only, with the
// amounts as at when it was made; its text carries the party's name and the amounts, and nothing of how to reach them
// (ADR-001 §7a). Sending it by WhatsApp waits for M7. Its link to the oldest overdue invoice is made by the module that
// owns invoices (lib-sales' remindWithLink, RAD-118): the row keeps only the link's id, never its token.
import { accountsTx, parties, partyManagers, paymentReminders } from '@radcore/db/accounts';
import { dec, formatDate, formatMoney } from '@radcore/lib-common';
import { AppError, principalsOf, type Ctx } from '@radcore/lib-platform';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { REMINDER_CHANNELS, type listReminders, type NO_LINK_REASONS, type recordReminder } from '../contract.ts';
import { partyOwed } from './collect.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;
const channelOf = z.enum(REMINDER_CHANNELS);

/** A reminder's link, or why there's none. */
export type ReminderLink = { link: { id: string; path: string; expiresAt: string } | null; noLink: (typeof NO_LINK_REASONS)[number] | null };
/** Makes the link for a reminder from the party's open bills, the oldest due first. */
export type ReminderLinkFor = (ctx: Ctx, bills: readonly { table: string; id: string }[]) => Promise<ReminderLink>;

/** POST /parties/:id/reminders. A reminder answers with the amounts, so it needs receivables:read too (RC-042). */
export async function remind(ctx: Ctx, { id, channel, note }: In<typeof recordReminder>, linkFor: ReminderLinkFor): Promise<Out<typeof recordReminder>> {
  if (!ctx.can('receivables:read')) throw new AppError('forbidden', 'A reminder shows what the party owes: it needs receivables:read');
  const { party, owed, bills } = await partyOwed(ctx, id, 'receivables:remind');
  if (!dec(owed.outstanding).gt(0)) throw new AppError('nothing_owed', 'This party owes nothing to remind them of');
  const { link, noLink } = await linkFor(ctx, [...bills].sort((a, b) => a.due.localeCompare(b.due) || a.date.localeCompare(b.date)));
  const [row] = await accountsTx(ctx).insert(paymentReminders).values({ partyId: party.id, outstanding: owed.outstanding, overdue: owed.overdue,
    oldestDue: owed.oldestDue, channel, note: note ?? null, linkId: link?.id ?? null })
    .returning({ id: paymentReminders.id, asAt: paymentReminders.asAt });
  if (row === undefined) throw new Error('The reminder was not stored');
  const overdue = owed.oldestDue === null ? '' : `, of which ${formatMoney(owed.overdue)} has been due since ${formatDate(owed.oldestDue)}`;
  return { id: row.id, asAt: row.asAt.toISOString(), channel, note: note ?? null, outstanding: owed.outstanding, overdue: owed.overdue,
    // The text names no link: the screen adds its own origin to link.path when it sends one.
    oldestDue: owed.oldestDue, text: `${party.name}: ${formatMoney(owed.outstanding)} is outstanding${overdue}.`, link, noLink };
}

/** GET /parties/:id/reminders: the latest first. shortcut: paged by position, as a party's reminders are few. */
export async function remindersPage(ctx: Ctx, { id, after, limit }: In<typeof listReminders>): Promise<Out<typeof listReminders>> {
  // The party's scope first: at `own`, only a party this person manages (the architect on RAD-119).
  const [party] = await accountsTx(ctx).select({ owner: partyManagers.owner }).from(parties).leftJoin(partyManagers, eq(partyManagers.partyId, parties.id))
    .where(eq(parties.id, id)).limit(1);
  if (party === undefined) throw new AppError('not_found', 'There is no such party');
  ctx.see('receivables:read', { owner: party.owner ?? '' });
  const start = after === undefined ? 0 : Number(after);
  const rows = await accountsTx(ctx).select().from(paymentReminders).where(eq(paymentReminders.partyId, id))
    .orderBy(desc(paymentReminders.asAt), desc(paymentReminders.id)).limit(limit + 1).offset(start);
  const who = await principalsOf(ctx, rows.map((r) => r.createdBy));
  return { items: rows.slice(0, limit).map((r) => ({ id: r.id, asAt: r.asAt.toISOString(), channel: channelOf.parse(r.channel), note: r.note,
    outstanding: r.outstanding, overdue: r.overdue, oldestDue: r.oldestDue, by: who(r.createdBy) })),
    next: rows.length > limit ? String(start + limit) : null };
}
