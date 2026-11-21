// A lead's side of a vehicle booking (M3-13, RAD-117, RC-127; the architect's rulings): lib-sales calls these, and no
// route reaches them. Making a booking converts its lead; cancelling the last live one sends it back to interested,
// due for a follow-up that day, so it doesn't sit in the pipeline unseen. Each locks the lead's row right after the
// booking's (ADR-006 §1), and leaves a stage activity whose note names the booking.
import { crmTx, leadActivities, leads } from '@radcore/db/crm';
import { AppError, type Ctx } from '@radcore/lib-platform';
import { eq } from 'drizzle-orm';

/** A booking made from a lead the maker may read (else not_found, so no lead id can be tied to a booking blind). The
 * lead becomes converted, unless it is already, which ends its follow-ups and plan and clears a lost reason. */
export async function bookingMade(ctx: Ctx, leadId: string, note: string): Promise<void> {
  const tx = crmTx(ctx);
  const [lead] = await tx.select({ owner: leads.owner, stage: leads.stage }).from(leads).where(eq(leads.id, leadId)).for('update');
  if (lead === undefined || !(ctx.can('leads:read', { owner: lead.owner ?? '' }) || (lead.owner === null && ctx.can('leads:unassigned')))) {
    throw new AppError('not_found', 'There is no such lead', [{ path: ['leadId'], code: 'unknown', message: 'Choose a lead' }]);
  }
  if (lead.stage === 'converted') return;
  await tx.update(leads).set({ stage: 'converted', lostReasonId: null, followUpOn: null, planId: null, planStep: null })
    .where(eq(leads.id, leadId));
  await tx.insert(leadActivities).values({ leadId, kind: 'stage', stage: 'converted', note });
}

/** A lead's last live booking cancelled: back to interested, its follow-up due `on` (the cancellation's day). A system
 * move: the cancellation was keyed already (the architect). The caller judges "last live booking". */
export async function bookingCancelled(ctx: Ctx, leadId: string, note: string, on: string): Promise<void> {
  const tx = crmTx(ctx);
  // The update locks the row; a lead is never deleted.
  const [moved] = await tx.update(leads).set({ stage: 'interested', lostReasonId: null, followUpOn: on, followUpToldOn: null })
    .where(eq(leads.id, leadId)).returning({ id: leads.id });
  if (moved === undefined) throw new Error(`lead ${leadId} named by a booking is gone: leads are never deleted`);
  await tx.insert(leadActivities).values({ leadId, kind: 'stage', stage: 'interested', note });
}
