// Reminders to a party of what it owes (M3-15, RAD-119; the architect's ruling). Each is recorded, append-only, with the
// amounts as at when it was made; its text carries the party's name and the amounts, and nothing of how to reach them
// (ADR-001 §7a). Sending it by WhatsApp waits for M7; a link to the oldest overdue bill joins with RAD-118.
import { accountsTx, paymentReminders } from '@radcore/db/accounts';
import { formatDate, formatMoney } from '@radcore/lib-common';
import { AppError, principalsOf, type Ctx } from '@radcore/lib-platform';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { REMINDER_CHANNELS, type listReminders, type recordReminder } from '../contract.ts';
import { partyOwed } from './collect.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;
const channelOf = z.enum(REMINDER_CHANNELS);

/** POST /parties/:id/reminders. A reminder answers with the amounts, so it needs receivables:read too (RC-042). */
export async function remind(ctx: Ctx, { id, channel, note }: In<typeof recordReminder>): Promise<Out<typeof recordReminder>> {
  if (!ctx.can('receivables:read')) throw new AppError('forbidden', 'A reminder shows what the party owes: it needs receivables:read');
  const { party, owed } = await partyOwed(ctx, id);
  const [row] = await accountsTx(ctx).insert(paymentReminders).values({ partyId: party.id, outstanding: owed.outstanding, overdue: owed.overdue,
    oldestDue: owed.oldestDue, channel, note: note ?? null }).returning({ id: paymentReminders.id, asAt: paymentReminders.asAt });
  if (row === undefined) throw new Error('The reminder was not stored');
  const overdue = owed.oldestDue === null ? '' : `, of which ${formatMoney(owed.overdue)} has been due since ${formatDate(owed.oldestDue)}`;
  return { id: row.id, asAt: row.asAt.toISOString(), channel, note: note ?? null, outstanding: owed.outstanding, overdue: owed.overdue,
    oldestDue: owed.oldestDue, text: `${party.name}: ${formatMoney(owed.outstanding)} is outstanding${overdue}.` };
}

/** GET /parties/:id/reminders: the latest first. shortcut: paged by position, as a party's reminders are few. */
export async function remindersPage(ctx: Ctx, { id, after, limit }: In<typeof listReminders>): Promise<Out<typeof listReminders>> {
  const start = after === undefined ? 0 : Number(after);
  const rows = await accountsTx(ctx).select().from(paymentReminders).where(eq(paymentReminders.partyId, id))
    .orderBy(desc(paymentReminders.asAt), desc(paymentReminders.id)).limit(limit + 1).offset(start);
  const who = await principalsOf(ctx, rows.map((r) => r.createdBy));
  return { items: rows.slice(0, limit).map((r) => ({ id: r.id, asAt: r.asAt.toISOString(), channel: channelOf.parse(r.channel), note: r.note,
    outstanding: r.outstanding, overdue: r.overdue, oldestDue: r.oldestDue, by: who(r.createdBy) })),
    next: rows.length > limit ? String(start + limit) : null };
}
