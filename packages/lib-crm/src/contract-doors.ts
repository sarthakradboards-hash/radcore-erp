// The outside doors into lead capture (M3-03, RAD-107; ADR-001 §8a), re-exported by contract.ts. One public form door,
// with the captcha (RC-054: no second, captcha-less door), and one webhook per provider, each with its own proof.
import { defineContract, emailString, phoneString } from '@radcore/lib-common';
import { z } from 'zod';

const write = { readOnly: false, isolation: 'read committed' } as const;

/**
 * An enquiry from the public form (the website links to or frames RadCore's enquiry page, which posts here). The
 * Turnstile token is checked with Cloudflare before anything is stored; a refused one is `captcha_failed`. What passes
 * is stored once and queued, like a provider's delivery, and becomes a lead, or joins the number's lead, in the worker.
 * The answer says nothing about any lead.
 */
export const submitEnquiry = defineContract({
  method: 'POST', path: '/public/enquiries', auth: 'public', rateLimit: 'enquiry', perm: null, tx: write,
  input: z.object({
    phone: phoneString(),
    name: z.string().trim().min(1).max(120).optional(),
    email: emailString().optional(),
    message: z.string().trim().min(1).max(2000).optional(),
    // The campaign token its link or QR code carried (M3-06): an identifier, not a secret, that grants nothing beyond
    // tagging the enquiry; an unknown or ended one tags nothing (the architect on RAD-110).
    campaign: z.string().regex(/^[A-Za-z0-9_-]{22}$/).optional(),
    captcha: z.string().min(1).max(2048),
  }),
  output: z.object({}), errors: ['captcha_failed'],
});

const hook = (path: string) => defineContract({ method: 'POST', path, auth: 'webhook', perm: null, tx: write,
  input: z.unknown(), output: z.object({}) });

/** Google Ads lead forms: proved by the form's `google_key`, its own secret (crm.google_lead_key). */
export const googleLeadHook = hook('/hooks/google-leads');
/** Meta lead ads: proved by `X-Hub-Signature-256` under the app secret (crm.meta_app_secret). */
export const metaLeadHook = hook('/hooks/meta-leads');
/** WhatsApp Cloud API messages: proved by `X-Hub-Signature-256` under the app secret (crm.whatsapp_app_secret). */
export const whatsappHook = hook('/hooks/whatsapp');
