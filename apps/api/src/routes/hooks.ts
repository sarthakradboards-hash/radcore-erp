// The api's webhooks (ADR-001 §8a, RAD-45): declarations only. Each is a provider's POST, proved by the provider's own
// check from lib-integrations under its stored secret, and acted on by its owning library's job in the worker. Meta and
// WhatsApp also answer their GET subscription handshake with the stored verify token (RAD-107).
import { googleLeadJob, metaLeadJob, whatsappMessageJob } from '@radcore/lib-crm';
import { googleLeadHook, metaLeadHook, whatsappHook } from '@radcore/lib-crm/contract';
import { googleKeyed, googleLeadCheck, hubAsks, hubChallenge, hubSignature, hubSigned } from '@radcore/lib-integrations';
import { defineWebhook } from '@radcore/lib-platform';

export default [
  defineWebhook(googleLeadHook, googleLeadCheck, googleLeadJob, { secret: 'crm.google_lead_key', precheck: googleKeyed }),
  defineWebhook(metaLeadHook, hubSignature, metaLeadJob, { secret: 'crm.meta_app_secret', precheck: hubSigned,
    handshake: { secret: 'crm.meta_verify_token', asks: hubAsks, answer: hubChallenge } }),
  defineWebhook(whatsappHook, hubSignature, whatsappMessageJob, { secret: 'crm.whatsapp_app_secret', precheck: hubSigned,
    handshake: { secret: 'crm.whatsapp_verify_token', asks: hubAsks, answer: hubChallenge } }),
];
