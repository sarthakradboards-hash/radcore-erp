// The pipeline (M3-05, RAD-109): working a lead from New to Converted or Lost, with the CRM's own lists (lead-lists.ts):
// a lost reason, a follow-up plan, a quick reply, each an active item named by id.
// - Every write locks the lead's row first, so two people working one lead take turns.
// - Who sees whose leads is the key's scope (E7), and with leads:unassigned the unowned ones too (D-11), in each reading
//   function itself so E7 sees it. Acting on an unowned lead takes it; only `all` scope hands one on (the architect on
//   RAD-109).
// - A follow-up that falls due tells its owner once a day's run finds it (crm.follow_up_due), never the whole number.
import {
  after, crmTx, followUpPlanSteps, followUpPlans, leadActivities, leadLostReasons, leads, notInNonEmpty, quickReplies,
} from '@radcore/db/crm';
import { addDays, indiaDate, maskOf, normaliseEmail } from '@radcore/lib-common';
import {
  AppError, decodeCursor, defineNotification, encodeCursor, holdsKey, isoMoment, listScope, momentKey, notify, principalId, principalsOf,
  roleOf, type Ctx, type JobContract,
} from '@radcore/lib-platform';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type {
  assignLead, followUpLead, LEAD_STAGES, listLeads, moveLead, planLead, quickReply, updateLead,
} from '../contract.ts';
import { fillReply } from './reply-rules.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;
type Stage = (typeof LEAD_STAGES)[number];

const today = () => indiaDate(new Date());
const ENDED: readonly Stage[] = ['converted', 'lost'];
const PAGE_KEY = z.object({ at: momentKey(), id: z.uuid() });

/** GET /leads (leads:read): latest enquiry first, a page at a time, only the principal's own at `own` scope. */
export async function listLeadsPage(ctx: Ctx, input: In<typeof listLeads>): Promise<Out<typeof listLeads>> {
  const key = input.after === undefined ? undefined : decodeCursor(PAGE_KEY, input.after);
  const f = input.filter;
  const me = ctx.principal.kind === 'user' ? principalId(ctx.principal) : '';
  const rows = await crmTx(ctx).select({ id: leads.id, name: leads.name, phone: leads.phone, stage: leads.stage, owner: leads.owner,
    followUpOn: leads.followUpOn, value: leads.value, score: leads.score, lastEnquiryAt: leads.lastEnquiryAt }).from(leads).where(and(
    f.stage === undefined ? undefined : eq(leads.stage, f.stage),
    f.owner === undefined ? undefined : f.owner === 'none' ? isNull(leads.owner) : eq(leads.owner, me),
    f.followUpBy === undefined ? undefined : lte(leads.followUpOn, f.followUpBy),
    unownedToo(ctx, listScope(ctx, 'leads:read', leads.owner)),
    after([leads.lastEnquiryAt, leads.id], key && [key.at, key.id], 'desc'),
  )).orderBy(desc(leads.lastEnquiryAt), desc(leads.id)).limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return {
    // The column is read as PostgreSQL's text, kept so for the page key's microseconds; the answer is an ISO moment.
    items: page.map((r) => ({ ...r, phone: maskOf(r.phone, 'last4'), stage: r.stage as Stage, lastEnquiryAt: isoMoment(r.lastEnquiryAt) })),
    next: rows.length > input.limit && last ? encodeCursor({ at: last.lastEnquiryAt, id: last.id }) : null,
  };
}

/** A list's scope, widened to the unowned leads for a holder of leads:unassigned; every lead (undefined) stays so. */
const unownedToo = (ctx: Ctx, scope: SQL | undefined) =>
  scope === undefined || !ctx.can('leads:unassigned') ? scope : or(scope, isNull(leads.owner));

/**
 * The lead, locked for a write, when the principal may change it; not_found otherwise, as if there were none. An
 * unowned one is taken first by someone who works only their own (D-11): `lead_taken` if another got there first.
 */
async function leadFor(ctx: Ctx, id: string) {
  const tx = crmTx(ctx);
  const [seen] = await tx.select({ owner: leads.owner }).from(leads).where(eq(leads.id, id));
  if (seen === undefined) throw new AppError('not_found', 'There is no such lead');
  if (seen.owner === null && !ctx.can('leads:write', { owner: '' })) {
    if (ctx.principal.kind !== 'user' || !ctx.can('leads:unassigned')) throw new AppError('not_found', 'There is no such lead');
    const [taken] = await tx.update(leads).set({ owner: principalId(ctx.principal), followUpToldOn: null })
      .where(and(eq(leads.id, id), isNull(leads.owner))).returning({ id: leads.id });
    if (taken === undefined) throw new AppError('lead_taken', 'Someone else has just taken this lead');
  }
  const [lead] = await tx.select({ name: leads.name, owner: leads.owner, stage: leads.stage, followUpOn: leads.followUpOn,
    planId: leads.planId, planStep: leads.planStep }).from(leads).where(eq(leads.id, id)).for('update');
  if (lead === undefined) throw new AppError('not_found', 'There is no such lead');
  ctx.see('leads:write', { owner: lead.owner ?? '' });
  return lead;
}

const wrongStage = () => new AppError('wrong_stage', 'Move the lead back into the pipeline first');

/** PATCH /leads/:id (leads:write). */
export async function updateLeadDetails(ctx: Ctx, { id, email, ...rest }: In<typeof updateLead>): Promise<Out<typeof updateLead>> {
  await leadFor(ctx, id);
  const set = Object.fromEntries(Object.entries({ ...rest, email: email === null || email === undefined ? email : normaliseEmail(email) })
    .filter(([, v]) => v !== undefined));
  if (Object.keys(set).length > 0) await crmTx(ctx).update(leads).set(set).where(eq(leads.id, id));
  return {};
}

/** POST /leads/:id/stage (leads:write). */
export async function moveLeadStage(ctx: Ctx, { id, stage, lostReasonId, note }: In<typeof moveLead>): Promise<Out<typeof moveLead>> {
  await leadFor(ctx, id);
  const tx = crmTx(ctx);
  const [reason] = stage !== 'lost' || lostReasonId === undefined ? [] : await tx.select({ id: leadLostReasons.id })
    .from(leadLostReasons).where(and(eq(leadLostReasons.id, lostReasonId), eq(leadLostReasons.active, true)));
  if (stage === 'lost' && reason === undefined) {
    throw new AppError('unknown_reason', 'Choose why the lead was lost', [{ path: ['lostReasonId'], code: 'unknown', message: 'Choose a reason' }]);
  }
  const ends = ENDED.includes(stage) ? { followUpOn: null, planId: null, planStep: null } : {};
  await tx.update(leads).set({ stage, lostReasonId: reason?.id ?? null, ...ends }).where(eq(leads.id, id));
  await tx.insert(leadActivities).values({ leadId: id, kind: 'stage', stage, note: note ?? null });
  return {};
}

/** POST /leads/:id/follow-up (leads:write). With no `nextOn`, a plan's next step is taken; its last ends the plan. */
export async function followUpDone(ctx: Ctx, { id, note, nextOn }: In<typeof followUpLead>): Promise<Out<typeof followUpLead>> {
  const lead = await leadFor(ctx, id);
  if (ENDED.includes(lead.stage as Stage)) throw wrongStage();
  const tx = crmTx(ctx);
  // This step and the one after it, as the plan reads now: a step it no longer has ends the plan.
  const steps = nextOn !== undefined || lead.planId === null || lead.planStep === null ? undefined
    : await tx.select({ step: followUpPlanSteps.step, afterDays: followUpPlanSteps.afterDays }).from(followUpPlanSteps)
      .where(and(eq(followUpPlanSteps.planId, lead.planId), gte(followUpPlanSteps.step, lead.planStep)))
      .orderBy(asc(followUpPlanSteps.step)).limit(2);
  const [now, then] = steps?.[0]?.step === lead.planStep ? steps ?? [] : [];
  const followUpOn = nextOn ?? (now === undefined ? null : addDays(today(), now.afterDays));
  const plan = steps === undefined ? {} : then === undefined ? { planId: null, planStep: null } : { planStep: then.step };
  await tx.update(leads).set({ followUpOn, ...plan, ...(lead.stage === 'new' ? { stage: 'contacted' } : {}) }).where(eq(leads.id, id));
  await tx.insert(leadActivities).values({ leadId: id, kind: 'follow_up', note: note ?? null });
  return { followUpOn };
}

/** POST /leads/:id/plan (leads:write). Its first step sets the follow-up; planStep is the one the next follow-up takes. */
export async function putOnPlan(ctx: Ctx, { id, planId }: In<typeof planLead>): Promise<Out<typeof planLead>> {
  const lead = await leadFor(ctx, id);
  const tx = crmTx(ctx);
  if (planId === null) {
    await tx.update(leads).set({ planId: null, planStep: null }).where(eq(leads.id, id));
    return { followUpOn: lead.followUpOn };
  }
  const [first, second] = await tx.select({ step: followUpPlanSteps.step, afterDays: followUpPlanSteps.afterDays }).from(followUpPlanSteps)
    .innerJoin(followUpPlans, eq(followUpPlans.id, followUpPlanSteps.planId))
    .where(and(eq(followUpPlans.id, planId), eq(followUpPlans.active, true))).orderBy(asc(followUpPlanSteps.step)).limit(2);
  if (first === undefined) throw new AppError('unknown_plan', 'There is no such plan', [{ path: ['planId'], code: 'unknown', message: 'Choose a plan' }]);
  if (ENDED.includes(lead.stage as Stage)) throw wrongStage();
  const followUpOn = addDays(today(), first.afterDays);
  await tx.update(leads).set({ followUpOn, ...(second === undefined ? { planId: null, planStep: null } : { planId, planStep: second.step }) })
    .where(eq(leads.id, id));
  return { followUpOn };
}

/** POST /leads/:id/quick-reply (leads:write). The screen opens WhatsApp with it; nothing is sent from here. Its
 * placeholders are filled for the lead (M3-06, reply-rules.ts). */
export async function quickReplyText(ctx: Ctx, { id, replyId }: In<typeof quickReply>): Promise<Out<typeof quickReply>> {
  const lead = await leadFor(ctx, id);
  const tx = crmTx(ctx);
  const [reply] = await tx.select({ title: quickReplies.title, body: quickReplies.body }).from(quickReplies)
    .where(and(eq(quickReplies.id, replyId), eq(quickReplies.active, true)));
  if (reply === undefined) throw new AppError('unknown_reply', 'There is no such quick reply', [{ path: ['replyId'], code: 'unknown', message: 'Choose a reply' }]);
  if (lead.stage === 'new') await tx.update(leads).set({ stage: 'contacted' }).where(eq(leads.id, id));
  await tx.insert(leadActivities).values({ leadId: id, kind: 'quick_reply', note: reply.title });
  const owner = lead.owner === null ? null : (await principalsOf(ctx, [lead.owner]))(lead.owner).displayName;
  return { text: fillReply(reply.body, { name: lead.name, owner }) };
}

/** POST /leads/:id/owner (leads:write at `all`): hands a lead to an active person whose role sees leads, or back to no
 * one. Its new owner is told of a follow-up already due. */
export async function assignLeadOwner(ctx: Ctx, { id, owner }: In<typeof assignLead>): Promise<Out<typeof assignLead>> {
  if (!ctx.can('leads:write', { owner: '' })) throw new AppError('forbidden', 'Only someone who works every lead may hand one on');
  const tx = crmTx(ctx);
  const [lead] = await tx.select({ id: leads.id }).from(leads).where(eq(leads.id, id)).for('update');
  if (lead === undefined) throw new AppError('not_found', 'There is no such lead');
  const to = owner === null ? null : `user:${owner}`;
  if (owner !== null) {
    if (await roleOf(ctx, to ?? '') === undefined) {
      throw new AppError('unknown_person', 'There is no such person', [{ path: ['owner'], code: 'unknown', message: 'Choose a person' }]);
    }
    // A lead handed to someone who can't see leads would be lost to them and to their bell (the architect on #262).
    if (await holdsKey(ctx, owner, 'leads:read') !== true) {
      throw new AppError('owner_cannot_see_leads', 'That person can’t see leads', [{ path: ['owner'], code: 'owner_cannot_see_leads',
        message: 'Choose someone whose account is active and whose role sees leads' }]);
    }
  }
  await tx.update(leads).set({ owner: to, followUpToldOn: null }).where(eq(leads.id, id));
  return {};
}

/** A follow-up due, to the lead's owner: its name, else its phone's last 4, as for a repeat enquiry. */
export const followUpDue = defineNotification('crm.follow_up_due', {
  table: 'leads', label: 'A follow-up is due',
  async describe(ctx, ids) {
    const rows = await crmTx(ctx).select({ id: leads.id, name: leads.name, phone: leads.phone, owner: leads.owner })
      .from(leads).where(inArray(leads.id, [...ids]));
    const seen = rows.filter((r) => ctx.can('leads:read', { owner: r.owner ?? '' }));
    return new Map(seen.map((r) => [r.id, `Follow up ${r.name ?? maskOf(r.phone, 'last4').masked}`]));
  },
});

/** Each morning, every owned lead still in the pipeline whose follow-up has come, told once per follow-up date. A
 * follow-up moved to a day already past is told on the next morning's run, so up to a day late. */
export const followUpsDueWatch: JobContract<object | null> = {
  name: 'crm.follow-ups-due',
  principal: { kind: 'system', name: 'follow-ups-due', permissions: ['leads:read'] },
  input: z.strictObject({}).nullable(),
  // Daily at 02:30 UTC, 08:00 in India.
  every: '30 2 * * *',
  oneAtATime: true,
};

export async function tellFollowUpsDue(ctx: Ctx): Promise<void> {
  const tx = crmTx(ctx);
  const due = await tx.select({ id: leads.id, owner: leads.owner, on: leads.followUpOn }).from(leads).where(and(
    isNotNull(leads.owner), lte(leads.followUpOn, today()), notInNonEmpty(leads.stage, ENDED),
    or(isNull(leads.followUpToldOn), ne(leads.followUpToldOn, leads.followUpOn)),
    listScope(ctx, 'leads:read', leads.owner)));
  for (const d of due) {
    if (d.owner === null || d.on === null) continue;
    // Only if the date is still the one read: a lead moved meanwhile is told when its new date comes.
    const [told] = await tx.update(leads).set({ followUpToldOn: d.on }).where(and(eq(leads.id, d.id), eq(leads.followUpOn, d.on),
      eq(leads.owner, d.owner))).returning({ id: leads.id });
    if (told !== undefined) await notify(ctx, followUpDue, { to: d.owner.slice('user:'.length), recordId: d.id });
  }
}
