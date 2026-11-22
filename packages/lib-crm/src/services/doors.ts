// The outside doors into lead capture (M3-03, RAD-107; ADR-001 §8a): each stores what came in once, through
// lib-platform's intake, and a worker job makes it an enquiry with captureEnquiry, as a system principal, so a form or
// platform lead waits unowned (M3-05 hands it on) and never takes anyone's consent (RAD-108).
// - The form: Turnstile checked in the route's `before`, outside the transaction (the architect), with only the token
//   sent (no visitor address), under TURNSTILE_SECRET, a runtime secret read at start. Its delivery id is the token's
//   hash, which Cloudflare won't pass twice.
// - Meta: each lead kept in meta_lead_waits until M7's fetch (the architect).
// - Google, Meta and WhatsApp: the provider's own proof, in the webhook lane (lib-integrations' checks).
import { createHash } from 'node:crypto';
import { crmTx, metaLeadWaits } from '@radcore/db/crm';
import {
  leadgenNotices, parseMetaLead, parseGoogleLead, turnstilePasses, whatsappMessages, type MetaLeadFetch,
} from '@radcore/lib-integrations';
import {
  AppError, defineRoute, takeDelivery, webhookDelivery, type Ctx, type JobContract, type Outbound, type WebhookDelivery,
} from '@radcore/lib-platform';
import type { z } from 'zod';
import { submitEnquiry } from '../contract-doors.ts';
import { captureEnquiry } from './leads.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;

/** Each door's work runs as its own system principal, with the lead keys capture needs and nothing else. */
const doorJob = (name: string, principal: string): JobContract<{ id: string }> => ({
  name, principal: { kind: 'system', name: principal, permissions: ['leads:read', 'leads:write'] }, input: webhookDelivery,
});
export const formEnquiryJob = doorJob('crm.form-enquiry', 'enquiry-form');
export const googleLeadJob = doorJob('crm.google-lead', 'google-leads');
export const metaLeadJob = doorJob('crm.meta-lead', 'meta-leads');
export const whatsappMessageJob = doorJob('crm.whatsapp-message', 'whatsapp');

/** What the form stores: the visitor's answers, without the token. */
const FORM = submitEnquiry.input.omit({ captcha: true });
const formSource = `${submitEnquiry.method} ${submitEnquiry.path}`;

/** Turnstile's client and secret, made at start: the published always-passing test secret in development and CI. */
export type Turnstile = { outbound: Outbound; secret: string };

/** The form's `before`: whether Cloudflare passes the token. Any refusal, or no answer, is a fail. */
export const turnstileBefore = ({ outbound, secret }: Turnstile) => (input: In<typeof submitEnquiry>): Promise<boolean> =>
  turnstilePasses(outbound, secret, input.captcha);

/** The form's one route, built at start with Turnstile's client and secret, as createClientErrors builds its own. */
export function createEnquiryForm(turnstile: Turnstile) {
  return { routes: [defineRoute(submitEnquiry, takeFormEnquiry, { before: turnstileBefore(turnstile) })] };
}

/** POST /public/enquiries: refused here, inside the transaction, so a retry of a stored enquiry replays its answer
 * before the spent token is judged again. */
export async function takeFormEnquiry(ctx: Ctx, { captcha, ...answers }: In<typeof submitEnquiry>,
  { before: passed }: { before: boolean }): Promise<Record<string, never>> {
  if (!passed) throw new AppError('captcha_failed', 'Please confirm you’re not a robot, then send it again');
  const tokenHash = createHash('sha256').update(captcha).digest('hex');
  await takeDelivery(ctx, { source: formSource, job: formEnquiryJob }, Buffer.from(JSON.stringify(answers)), tokenHash);
  return {};
}

/** The form's job. */
export async function formEnquiry(ctx: Ctx, delivery: WebhookDelivery): Promise<void> {
  const a = FORM.parse(JSON.parse(delivery.payload));
  await captureEnquiry(ctx, { phone: a.phone, name: a.name, email: a.email, source: 'form', message: a.message, campaign: a.campaign });
}

/** Google's job. A lead with no phone can't be a lead (one per number): it's dropped, and its delivery stays stored. */
export async function googleLead(ctx: Ctx, delivery: WebhookDelivery): Promise<void> {
  const lead = parseGoogleLead(delivery.payload);
  if (lead.phone === undefined) return;
  await captureEnquiry(ctx, { phone: lead.phone, name: lead.name, email: lead.email, source: 'google' });
}

/** WhatsApp's job: each message an enquiry, its text kept as the person wrote it (RC-173). */
export async function whatsappMessage(ctx: Ctx, delivery: WebhookDelivery): Promise<void> {
  for (const m of whatsappMessages(delivery.payload)) {
    await captureEnquiry(ctx, { phone: m.phone, name: m.name, source: 'whatsapp', message: m.text, receivedAt: m.at });
  }
}

/**
 * Meta's job: each lead fetched and captured, or, with no fetch (until M7), kept waiting in meta_lead_waits, once per
 * lead however often Meta repeats it.
 * shortcut: the fetch runs inside the job's transaction; M7 moves it before the transaction when it brings the client.
 */
export const metaLead = (fetchLead: MetaLeadFetch | null) => async (ctx: Ctx, delivery: WebhookDelivery): Promise<void> => {
  for (const notice of leadgenNotices(delivery.payload)) {
    if (fetchLead === null) {
      await crmTx(ctx).insert(metaLeadWaits).values({ leadgenId: notice.leadgenId, formId: notice.formId, pageId: notice.pageId,
        deliveryId: delivery.id, receivedAt: new Date() }).onConflictDoNothing();
      continue;
    }
    const lead = parseMetaLead(await fetchLead(notice.leadgenId));
    if (lead.phone === undefined) continue;
    await captureEnquiry(ctx, { phone: lead.phone, name: lead.name, email: lead.email, source: 'meta', receivedAt: lead.createdAt });
  }
};
/** Meta's job until M7 brings the live fetch. */
export const metaLeadWaiting = metaLead(null);
