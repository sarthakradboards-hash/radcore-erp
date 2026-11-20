// lib-crm's route contracts (ADR-001 §6, §7a): declared once, shared by the API and the web app. Like every contract
// file it imports only zod and lib-common (D5), so the browser can load it.
import {
  dateString, defineContract, emailString, idString, listInput, listOf, momentString, moneyString, phoneString, pii, piiRecord,
  principalOut,
} from '@radcore/lib-common';
import { z } from 'zod';

const read = { readOnly: true, isolation: 'read committed' } as const;
const write = { readOnly: false, isolation: 'read committed' } as const;

/** Where an enquiry came from: by hand, at the counter, the website form, or an ad or chat platform (M3-03). */
export const LEAD_SOURCES = ['manual', 'walk_in', 'form', 'meta', 'google', 'whatsapp', 'qr'] as const;

/**
 * An enquiry taken by staff, by hand or at the counter (M3-02). A number that already has a lead joins it: the lead's
 * owner is told and its follow-up comes forward to today (RC-142). `repeat` says which happened. `id` is the lead's,
 * left out when the number's lead is one the person may not open, so capture shows nothing of it.
 * The form and the platforms (M3-03) capture through the same service.
 */
export const captureLead = defineContract({
  method: 'POST', path: '/leads', auth: 'session', perm: 'leads:write', tx: write,
  input: z.object({ phone: phoneString(), name: z.string().trim().min(1).max(120).optional(), email: emailString().optional(),
    source: z.enum(['manual', 'walk_in']) }),
  output: z.object({ id: idString().optional(), repeat: z.boolean() }),
});

/** A lead's place in the pipeline (M3-05). Lost needs a reason; a lost lead can be moved back when they return. */
export const LEAD_STAGES = ['new', 'contacted', 'interested', 'meeting_booked', 'converted', 'lost'] as const;
const stage = z.enum(LEAD_STAGES);
const score = z.number().int().min(0).max(100);
const note = () => z.string().trim().min(1).max(2000);

/**
 * A lead with each of its enquiries, newest first, and its timeline, newest first. Its phone and email are personal
 * data, masked without pii:read or leads:contact, and each record shown unmasked is logged as a look. An enquiry's
 * `message` is what the outsider wrote, apart from staff's `notes` (RC-173): a screen shows it as text, never as markup.
 * `planStep` is the step of `planId` its next follow-up takes.
 */
export const getLead = defineContract({
  method: 'GET', path: '/leads/:id', auth: 'session', perm: 'leads:read', tx: read,
  input: z.object({ id: idString() }),
  output: piiRecord('leads', z.object({
    id: idString(), name: z.string().nullable(), phone: pii(z.string(), 'last4'), email: pii(z.string().nullable()),
    owner: z.string().nullable(), followUpOn: dateString().nullable(), notes: z.string().nullable(), stage,
    lostReasonId: idString().nullable(), value: moneyString().nullable(), score: score.nullable(), planId: idString().nullable(),
    planStep: z.number().int().nullable(),
    enquiries: z.array(z.object({ source: z.enum(LEAD_SOURCES), message: z.string().nullable(), receivedAt: momentString() })),
    activities: z.array(z.object({ kind: z.enum(['follow_up', 'quick_reply', 'stage']), stage: stage.nullable(),
      note: z.string().nullable(), at: momentString(), by: principalOut })),
  }), { seenWith: 'leads:contact' }),
});

/**
 * Leads, latest enquiry first, a page of at most 200 (RC-041). A person who holds leads:read at `own` gets only their
 * own, and the unowned ones too with leads:unassigned (D-11). The phone keeps its last 4 and the email is masked,
 * without pii:read, so a list never hands out the numbers: the lead's own page shows them to a leads:contact holder,
 * and logs the look. `owner: 'none'` is the unowned ones, `followUpBy` those whose follow-up falls on or before that day.
 */
export const listLeads = defineContract({
  method: 'GET', path: '/leads', auth: 'session', perm: 'leads:read', tx: read,
  input: listInput(z.object({ stage: stage.optional(), owner: z.enum(['me', 'none']).optional(), followUpBy: dateString().optional() })),
  output: listOf(piiRecord('leads', z.object({
    id: idString(), name: z.string().nullable(), phone: pii(z.string(), 'last4'), stage, owner: z.string().nullable(),
    followUpOn: dateString().nullable(), value: moneyString().nullable(), score: score.nullable(), lastEnquiryAt: momentString(),
  }))),
});

const active = z.boolean();
const lostReason = z.object({ label: z.string().trim().min(1).max(80) });
const planStep = z.object({ afterDays: z.number().int().min(1).max(365), note: z.string().trim().min(1).max(200).nullable() });
const plan = z.object({ name: z.string().trim().min(1).max(60), steps: z.array(planStep).min(1).max(20) });
const reply = z.object({ title: z.string().trim().min(1).max(60), body: z.string().trim().min(1).max(1000) });

/** The CRM's lists (RAD-109), switched-off items too, so the screen that keeps them shows them; a picker offers the
 * active ones. Read with leads:read, since a salesperson picks a reason, a plan or a reply. */
export const getLeadLists = defineContract({
  method: 'GET', path: '/lead-lists', auth: 'session', perm: 'leads:read', tx: read,
  input: z.object({}),
  output: z.object({
    lostReasons: z.array(lostReason.extend({ id: idString(), active })),
    plans: z.array(plan.extend({ id: idString(), active, steps: z.array(planStep.extend({ step: z.number().int() })) })),
    quickReplies: z.array(reply.extend({ id: idString(), active })),
  }),
});

/** A new lost reason (leads:setup). */
export const createLostReason = defineContract({
  method: 'POST', path: '/lead-lists/lost-reasons', auth: 'session', perm: 'leads:setup', tx: write,
  input: lostReason, output: z.object({ id: idString() }), errors: ['name_taken'],
});
/** A lost reason renamed, or switched off or on: leads lost for it keep it. */
export const updateLostReason = defineContract({
  method: 'PUT', path: '/lead-lists/lost-reasons/:id', auth: 'session', perm: 'leads:setup', tx: write,
  input: lostReason.extend({ id: idString(), active }), output: z.object({}), errors: ['name_taken'],
});
/** A new follow-up plan with its steps (leads:setup). */
export const createPlan = defineContract({
  method: 'POST', path: '/lead-lists/plans', auth: 'session', perm: 'leads:setup', tx: write,
  input: plan, output: z.object({ id: idString() }), errors: ['name_taken'],
});
/** A plan rewritten whole: its steps are replaced, and a lead on it takes its next step as the plan now reads. */
export const updatePlan = defineContract({
  method: 'PUT', path: '/lead-lists/plans/:id', auth: 'session', perm: 'leads:setup', tx: write,
  input: plan.extend({ id: idString(), active }), output: z.object({}), errors: ['name_taken'],
});
/** A new quick reply (leads:setup). */
export const createQuickReply = defineContract({
  method: 'POST', path: '/lead-lists/quick-replies', auth: 'session', perm: 'leads:setup', tx: write,
  input: reply, output: z.object({ id: idString() }), errors: ['name_taken'],
});
/** A quick reply rewritten, or switched off or on. */
export const updateQuickReply = defineContract({
  method: 'PUT', path: '/lead-lists/quick-replies/:id', auth: 'session', perm: 'leads:setup', tx: write,
  input: reply.extend({ id: idString(), active }), output: z.object({}), errors: ['name_taken'],
});

/** A lead's details as staff keep them. A field left out is left as it is; null clears it. */
export const updateLead = defineContract({
  method: 'PATCH', path: '/leads/:id', auth: 'session', perm: 'leads:write', tx: write,
  input: z.object({ id: idString(), name: z.string().trim().min(1).max(120).nullable().optional(),
    email: emailString().nullable().optional(), value: moneyString().nullable().optional(), score: score.nullable().optional(),
    notes: z.string().trim().min(1).max(2000).nullable().optional(), followUpOn: dateString().nullable().optional() }),
  output: z.object({}), errors: ['lead_taken'],
});

/** Moves a lead to a stage. Lost takes an active lost reason (`unknown_reason` otherwise); converted and lost end its
 * follow-ups and plan. */
export const moveLead = defineContract({
  method: 'POST', path: '/leads/:id/stage', auth: 'session', perm: 'leads:write', tx: write,
  input: z.object({ id: idString(), stage, lostReasonId: idString().optional(), note: note().optional() }),
  output: z.object({}), errors: ['unknown_reason', 'lead_taken'],
});

/** A follow-up made: kept on the lead's timeline, and a new lead becomes contacted. The next one is `nextOn`, else
 * the plan's next step counted from today, else none. */
export const followUpLead = defineContract({
  method: 'POST', path: '/leads/:id/follow-up', auth: 'session', perm: 'leads:write', tx: write,
  input: z.object({ id: idString(), note: note().optional(), nextOn: dateString().optional() }),
  output: z.object({ followUpOn: dateString().nullable() }), errors: ['wrong_stage', 'lead_taken'],
});

/** Puts a lead on an active follow-up plan, its first follow-up that many days from today; null takes it off. */
export const planLead = defineContract({
  method: 'POST', path: '/leads/:id/plan', auth: 'session', perm: 'leads:write', tx: write,
  input: z.object({ id: idString(), planId: idString().nullable() }),
  output: z.object({ followUpOn: dateString().nullable() }), errors: ['unknown_plan', 'wrong_stage', 'lead_taken'],
});

/** An active quick reply's text, for the screen to open in WhatsApp with the number it already shows. Kept on the
 * timeline, and a new lead becomes contacted. */
export const quickReply = defineContract({
  method: 'POST', path: '/leads/:id/quick-reply', auth: 'session', perm: 'leads:write', tx: write,
  input: z.object({ id: idString(), replyId: idString() }),
  output: z.object({ text: z.string() }), errors: ['unknown_reply', 'lead_taken'],
});

/** Hands a lead to a person, or (null) back to no one: only for someone who holds leads:write at `all` (D-11). */
export const assignLead = defineContract({
  method: 'POST', path: '/leads/:id/owner', auth: 'session', perm: 'leads:write', tx: write,
  input: z.object({ id: idString(), owner: idString().nullable() }),
  output: z.object({}), errors: ['unknown_person'],
});
