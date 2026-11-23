// Lead capture (M3-02, RAD-106): the one way an enquiry becomes a lead, whoever takes it. Staff by hand or at the
// counter (captureLead's route), and the website form and the ad and chat platforms (M3-03) as a system principal,
// all call captureEnquiry.
// - A lead is one phone number in E.164. ux_leads_phone is the lock on the number: of two enquiries from it at once,
//   the second's insert waits for the first's transaction, then joins its lead (RC-142).
// - A repeat enquiry tells the lead's owner (crm.repeat_enquiry) and brings its follow-up forward to the enquiry's day.
// - What an outsider wrote is kept as they wrote it, on the enquiry, never in a staff field (RC-173).
// Capture reaches every lead, whatever the principal's scope: a number must join its lead even when someone else owns
// it. It answers the lead's id only when the principal may open that lead, so it shows nothing of one they can't (the
// architect on RAD-106).
// A person who holds leads:unassigned (D-11) also opens the leads no one owns, and their repeat enquiry on one takes it;
// a form or a platform never does (the architect on RAD-109).
import { campaigns, crmTx, leadActivities, leadEnquiries, leadSetAsides, leadSources, leads } from '@radcore/db/crm';
import { indiaDate, maskOf, normaliseEmail, normalisePhone } from '@radcore/lib-common';
import { AppError, defineNotification, notify, principalId, principalsOf, type Ctx } from '@radcore/lib-platform';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import type { getLead, LEAD_SOURCES, LEAD_STAGES } from '../contract.ts';

// lead_enquiries.message's cap, in characters (code points, as char_length counts them).
const MESSAGE_MAX = 2000;

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;

/** One enquiry, from whichever door it came in by. */
export type Capture = Readonly<{
  phone: string;
  name?: string | undefined;
  email?: string | undefined;
  source: (typeof LEAD_SOURCES)[number];
  /** The outsider's own words (a form's message, a chat's text); staff's words are never put here. Past 2,000
   * characters the rest is dropped: the door keeps the whole of what came in (ADR-001 §8a), and the lead isn't lost. */
  message?: string | undefined;
  /** When it arrived; now unless a door stored it first (M3-03's webhooks). */
  receivedAt?: Date | undefined;
  /** A source a person picked at capture by hand or at the counter (M3-06): one leads:setup added, of that channel. */
  sourceId?: string | undefined;
  /** The campaign token the form came with (a campaign's link or QR code, M3-06): an unknown or ended one tags nothing. */
  campaign?: string | undefined;
}>;

/** The source and campaign an enquiry counts under (M3-06, the architect): a live campaign's, from its token; else the
 * source a person picked; else its door's own, seeded one. */
async function sourceOf(ctx: Ctx, c: Capture): Promise<{ id: string; channel: string; ignored: boolean; campaignId: string | null }> {
  const tx = crmTx(ctx);
  const columns = { id: leadSources.id, channel: leadSources.channel, ignored: leadSources.ignored };
  if (c.campaign !== undefined) {
    const [hit] = await tx.select({ ...columns, campaignId: campaigns.id, endedAt: campaigns.endedAt }).from(campaigns)
      .innerJoin(leadSources, eq(leadSources.id, campaigns.sourceId)).where(eq(campaigns.token, c.campaign));
    if (hit !== undefined && hit.endedAt === null) return { id: hit.id, channel: hit.channel, ignored: hit.ignored, campaignId: hit.campaignId };
  }
  if (c.sourceId !== undefined) {
    const [picked] = await tx.select(columns).from(leadSources)
      .where(and(eq(leadSources.id, c.sourceId), eq(leadSources.channel, c.source), eq(leadSources.active, true)));
    if (picked === undefined) {
      throw new AppError('unknown_source', 'There is no such source', [{ path: ['sourceId'], code: 'unknown', message: 'Choose a source' }]);
    }
    return { ...picked, campaignId: null };
  }
  const [door] = await tx.select(columns).from(leadSources).where(eq(leadSources.doorChannel, c.source));
  if (door === undefined) throw new Error(`the ${c.source} door has no source: the migration seeds one per door`);
  return { ...door, campaignId: null };
}

/** A repeat enquiry, to the lead's owner: the lead's name, else its phone's last four digits, whoever views it. The
 * whole number shows only on the lead itself, where the look is logged (ADR-005 §7c; auditor-2 on #241). */
export const repeatEnquiry = defineNotification('crm.repeat_enquiry', {
  table: 'leads', label: 'A lead enquired again',
  async describe(ctx, ids) {
    const rows = await crmTx(ctx).select({ id: leads.id, name: leads.name, phone: leads.phone, owner: leads.owner })
      .from(leads).where(inArray(leads.id, [...ids]));
    const seen = rows.filter((r) => ctx.can('leads:read', { owner: r.owner ?? '' }));
    return new Map(seen.map((r) => [r.id, `${r.name ?? maskOf(r.phone, 'last4').masked} enquired again`]));
  },
});

/** Takes an enquiry, and POST /leads (leads:write): a new lead for a new number, else the number's lead, told and
 * brought forward. */
export async function captureEnquiry(ctx: Ctx, c: Capture): Promise<{ id?: string; repeat: boolean }> {
  const phone = normalisePhone(c.phone);
  if (phone === undefined) throw new AppError('invalid_input', 'Enter a valid phone number', [{ path: ['phone'], code: 'invalid', message: 'Enter a valid phone number' }]);
  const receivedAt = c.receivedAt ?? new Date();
  const source = await sourceOf(ctx, c);
  const message = c.message === undefined ? null : [...c.message].slice(0, MESSAGE_MAX).join('');
  // An ignored source's enquiry is stored and set aside: no lead, no join to the number's lead, no one told (RC-212).
  if (source.ignored) {
    await crmTx(ctx).insert(leadSetAsides).values({ sourceId: source.id, campaignId: source.campaignId, phone, name: c.name ?? null,
      email: c.email === undefined ? null : normaliseEmail(c.email), message, receivedAt: receivedAt.toISOString() });
    return { repeat: false };
  }
  const on = indiaDate(receivedAt);
  // A person who takes a new enquiry owns it; a form or platform's lead waits unowned (M3-05 assigns it).
  const me = ctx.principal.kind === 'user' ? principalId(ctx.principal) : null;
  const tx = crmTx(ctx);
  const [made] = await tx.insert(leads).values({ phone, name: c.name ?? null, email: c.email === undefined ? null : normaliseEmail(c.email),
    owner: me, followUpOn: on, lastEnquiryAt: receivedAt.toISOString() }).onConflictDoNothing({ target: leads.phone }).returning({ id: leads.id });
  let id = made?.id;
  let owner = me;
  if (id === undefined) {
    // The number has a lead. This update locks its row, so a second repeat at the same time waits for this one.
    const [lead] = await tx.update(leads).set({ lastEnquiryAt: receivedAt.toISOString() }).where(eq(leads.phone, phone))
      .returning({ id: leads.id, owner: leads.owner, followUpOn: leads.followUpOn });
    if (lead === undefined) throw new Error('a lead held the number and is gone: leads are never deleted');
    // The update above holds the row, so taking an unowned lead here can't race another taker.
    const takes = lead.owner === null && me !== null && ctx.can('leads:unassigned');
    const sooner = lead.followUpOn === null || lead.followUpOn > on;
    if (sooner || takes) await tx.update(leads).set({ ...(takes ? { owner: me } : {}), ...(sooner ? { followUpOn: on } : {}) }).where(eq(leads.id, lead.id));
    if (lead.owner !== null && lead.owner !== me) await notify(ctx, repeatEnquiry, { to: lead.owner.slice('user:'.length), recordId: lead.id });
    id = lead.id;
    owner = takes ? me : lead.owner;
  }
  await tx.insert(leadEnquiries).values({ leadId: id, source: source.channel, sourceId: source.id, campaignId: source.campaignId, message,
    receivedAt });
  const repeat = made === undefined;
  const opens = ctx.can('leads:read', { owner: owner ?? '' }) || (owner === null && ctx.can('leads:unassigned'));
  return opens ? { id, repeat } : { repeat };
}

type Stage = (typeof LEAD_STAGES)[number];

/** GET /leads/:id (leads:read): one the principal may see, else not_found, as if there were none. Opening an unowned
 * one doesn't take it. */
export async function leadById(ctx: Ctx, { id }: In<typeof getLead>): Promise<Out<typeof getLead>> {
  const tx = crmTx(ctx);
  const [lead] = await tx.select({ id: leads.id, name: leads.name, phone: leads.phone, email: leads.email, owner: leads.owner,
    followUpOn: leads.followUpOn, notes: leads.notes, stage: leads.stage, lostReasonId: leads.lostReasonId, value: leads.value,
    score: leads.score, planId: leads.planId, planStep: leads.planStep }).from(leads).where(eq(leads.id, id));
  if (lead === undefined) throw new AppError('not_found', 'There is no such lead');
  if (!ctx.can('leads:read', { owner: lead.owner ?? '' }) && !(lead.owner === null && ctx.can('leads:unassigned'))) {
    throw new AppError('not_found', 'There is no such lead');
  }
  const enquiries = await tx.select({ source: leadEnquiries.source, message: leadEnquiries.message, receivedAt: leadEnquiries.receivedAt })
    .from(leadEnquiries).where(eq(leadEnquiries.leadId, id)).orderBy(desc(leadEnquiries.receivedAt), desc(leadEnquiries.id));
  const done = await tx.select({ kind: leadActivities.kind, stage: leadActivities.stage, note: leadActivities.note,
    at: leadActivities.createdAt, by: leadActivities.createdBy }).from(leadActivities).where(eq(leadActivities.leadId, id))
    .orderBy(desc(leadActivities.createdAt), desc(leadActivities.id));
  // The owner as a person, by name, read with the activities' authors (RAD-109).
  const who = await principalsOf(ctx, [...done.map((a) => a.by), ...(lead.owner === null ? [] : [lead.owner])]);
  return { ...lead, owner: lead.owner === null ? null : who(lead.owner), stage: lead.stage as Stage, enquiries: enquiries.map((e) => ({ source: e.source as Capture['source'], message: e.message,
    receivedAt: e.receivedAt.toISOString() })),
    activities: done.map((a) => ({ kind: a.kind as 'follow_up' | 'quick_reply' | 'stage', stage: a.stage as Stage | null, note: a.note,
      at: a.at.toISOString(), by: who(a.by) })) };
}
