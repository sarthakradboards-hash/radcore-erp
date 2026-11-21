// A lead's row lock for another library's lock order (RAD-117; the architect's ruling), reached by no route, like
// lib-accounts' holdParty. E7's exemption: it locks one lead by an id taken from a booking the caller has already locked
// within its scope, and answers nothing: no lead field leaves this file.
import { crmTx, leads } from '@radcore/db/crm';
import { AppError, type Ctx } from '@radcore/lib-platform';
import { eq } from 'drizzle-orm';

/** Locks the lead's row FOR UPDATE, so a cancelled booking judges its lead's other bookings under it (RC-127). */
export async function holdLead(ctx: Ctx, leadId: string): Promise<void> {
  const [lead] = await crmTx(ctx).select({ id: leads.id }).from(leads).where(eq(leads.id, leadId)).for('update');
  if (lead === undefined) throw new AppError('not_found', 'There is no such lead');
}
