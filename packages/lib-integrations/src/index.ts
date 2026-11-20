// lib-integrations (ADR-001 §3, §8a): outside services' clients, payload parsers and signature checks. It knows no
// RadCore module: the owning library acts on what it parses.
export { googleLeadCheck, parseGoogleLead, type GoogleLead } from './google.ts';
export { hubChallenge, hubSignature, sameSecret } from './hub.ts';
export { leadgenNotices, parseMetaLead, type LeadgenNotice, type MetaLead, type MetaLeadFetch } from './meta.ts';
export { TURNSTILE_ORIGIN, TURNSTILE_TEST_SECRETS, turnstilePasses } from './turnstile.ts';
export { whatsappMessages, type WhatsappMessage } from './whatsapp.ts';
