// Lead capture (M3-02, RAD-106): the one way an enquiry becomes a lead, whoever takes it. Staff by hand or at the
// counter (captureLead's route), and the website form and the ad and chat platforms (M3-03) as a system principal,
// all call captureEnquiry.
// - A lead is one phone number in E.164. ux_leads_phone is the lock on the number: of two enquiries from it at once,
//   the second's insert waits for the first's transaction, then joins its lead (RC-142).
// - A repeat enquiry tells the lead's owner (crm.repeat_enquiry) and brings its follow-up forward to the enquiry's day.
// - What an outsider wrote is kept as they wrote it, on the enquiry, never in a staff field (RC-173).
// Capture reaches every lead, whatever the principal's scope: a number must join its lead even when someone else owns
// it. It writes and answers only the lead's id, so it shows nothing of a lead the principal can't see.
import { crmTx, leadEnquiries, leads } from '@radcore/db/crm';
import { indiaDate, maskOf, normaliseEmail, normalisePhone } from '@radcore/lib-common';
import { AppError, defineNotification, notify, principalId, type Ctx } from '@radcore/lib-platform';
import { desc, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import type { getLead, LEAD_SOURCES } from '../contract.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;

/** One enquiry, from whichever door it came in by. */
export type Capture = Readonly<{
  phone: string;
  name?: string | undefined;
  email?: string | undefined;
  source: (typeof LEAD_SOURCES)[number];
  /** The outsider's own words (a form's message, a chat's text); staff's words are never put here. */
  message?: string | undefined;
  /** When it arrived; now unless a door stored it first (M3-03's webhooks). */
  receivedAt?: Date | undefined;
}>;

/** A repeat enquiry, to the lead's owner: the lead's name, else its phone as the viewer may see it. */
export const repeatEnquiry = defineNotification('crm.repeat_enquiry', {
  table: 'leads', label: 'A lead enquired again',
  async describe(ctx, ids) {
    const rows = await crmTx(ctx).select({ id: leads.id, name: leads.name, phone: leads.phone, owner: leads.owner })
      .from(leads).where(inArray(leads.id, [...ids]));
    const seen = rows.filter((r) => ctx.can('leads:read', { owner: r.owner ?? '' }));
    const phone = (p: string) => (ctx.shows('last4') ? p : maskOf(p, 'last4').masked);
    return new Map(seen.map((r) => [r.id, `${r.name ?? phone(r.phone)} enquired again`]));
  },
});

/** Takes an enquiry, and POST /leads (leads:write): a new lead for a new number, else the number's lead, told and
 * brought forward. */
export async function captureEnquiry(ctx: Ctx, c: Capture): Promise<{ id: string; repeat: boolean }> {
  const phone = normalisePhone(c.phone);
  if (phone === undefined) throw new AppError('invalid_input', 'Enter a valid phone number', [{ path: ['phone'], code: 'invalid', message: 'Enter a valid phone number' }]);
  const receivedAt = c.receivedAt ?? new Date();
  const on = indiaDate(receivedAt);
  // A person who takes a new enquiry owns it; a form or platform's lead waits unowned (M3-05 assigns it).
  const me = ctx.principal.kind === 'user' ? principalId(ctx.principal) : null;
  const tx = crmTx(ctx);
  const [made] = await tx.insert(leads).values({ phone, name: c.name ?? null, email: c.email === undefined ? null : normaliseEmail(c.email),
    owner: me, followUpOn: on, lastEnquiryAt: receivedAt }).onConflictDoNothing({ target: leads.phone }).returning({ id: leads.id });
  let id = made?.id;
  if (id === undefined) {
    // The number has a lead. This update locks its row, so a second repeat at the same time waits for this one.
    const [lead] = await tx.update(leads).set({ lastEnquiryAt: receivedAt }).where(eq(leads.phone, phone))
      .returning({ id: leads.id, owner: leads.owner, followUpOn: leads.followUpOn });
    if (lead === undefined) throw new Error('a lead held the number and is gone: leads are never deleted');
    if (lead.followUpOn === null || lead.followUpOn > on) await tx.update(leads).set({ followUpOn: on }).where(eq(leads.id, lead.id));
    if (lead.owner !== null && lead.owner !== me) await notify(ctx, repeatEnquiry, { to: lead.owner.slice('user:'.length), recordId: lead.id });
    id = lead.id;
  }
  await tx.insert(leadEnquiries).values({ leadId: id, source: c.source, message: c.message ?? null, receivedAt });
  return { id, repeat: made === undefined };
}

/** GET /leads/:id (leads:read): one the principal may see, else not_found, as if there were none. */
export async function leadById(ctx: Ctx, { id }: In<typeof getLead>): Promise<Out<typeof getLead>> {
  const tx = crmTx(ctx);
  const [lead] = await tx.select({ id: leads.id, name: leads.name, phone: leads.phone, email: leads.email, owner: leads.owner,
    followUpOn: leads.followUpOn, notes: leads.notes }).from(leads).where(eq(leads.id, id));
  if (lead === undefined) throw new AppError('not_found', 'There is no such lead');
  ctx.see('leads:read', { owner: lead.owner ?? '' });
  const enquiries = await tx.select({ source: leadEnquiries.source, message: leadEnquiries.message, receivedAt: leadEnquiries.receivedAt })
    .from(leadEnquiries).where(eq(leadEnquiries.leadId, id)).orderBy(desc(leadEnquiries.receivedAt), desc(leadEnquiries.id));
  return { ...lead, enquiries: enquiries.map((e) => ({ source: e.source as Capture['source'], message: e.message,
    receivedAt: e.receivedAt.toISOString() })) };
}
