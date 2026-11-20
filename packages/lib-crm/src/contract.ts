// lib-crm's route contracts (ADR-001 §6, §7a): declared once, shared by the API and the web app. Like every contract
// file it imports only zod and lib-common (D5), so the browser can load it.
import { dateString, defineContract, emailString, idString, momentString, phoneString, pii, piiRecord } from '@radcore/lib-common';
import { z } from 'zod';

const read = { readOnly: true, isolation: 'read committed' } as const;
const write = { readOnly: false, isolation: 'read committed' } as const;

/** Where an enquiry came from: by hand, at the counter, the website form, or an ad or chat platform (M3-03). */
export const LEAD_SOURCES = ['manual', 'walk_in', 'form', 'meta', 'google', 'whatsapp', 'qr'] as const;

/**
 * An enquiry taken by staff, by hand or at the counter (M3-02). A number that already has a lead joins it: the lead's
 * owner is told and its follow-up comes forward to today (RC-142). `repeat` says which happened; `id` is the lead's.
 * The form and the platforms (M3-03) capture through the same service.
 */
export const captureLead = defineContract({
  method: 'POST', path: '/leads', auth: 'session', perm: 'leads:write', tx: write,
  input: z.object({ phone: phoneString(), name: z.string().trim().min(1).max(120).optional(), email: emailString().optional(),
    source: z.enum(['manual', 'walk_in']) }),
  output: z.object({ id: idString(), repeat: z.boolean() }),
});

/**
 * A lead with each of its enquiries, newest first. Its phone and email are personal data, masked without pii:read, and
 * each record shown unmasked is logged as a look. An enquiry's `message` is what the outsider wrote, apart from staff's
 * `notes` (RC-173): a screen shows it as text, never as markup.
 */
export const getLead = defineContract({
  method: 'GET', path: '/leads/:id', auth: 'session', perm: 'leads:read', tx: read,
  input: z.object({ id: idString() }),
  output: piiRecord('leads', z.object({
    id: idString(), name: z.string().nullable(), phone: pii(z.string(), 'last4'), email: pii(z.string().nullable()),
    owner: z.string().nullable(), followUpOn: dateString().nullable(), notes: z.string().nullable(),
    enquiries: z.array(z.object({ source: z.enum(LEAD_SOURCES), message: z.string().nullable(), receivedAt: momentString() })),
  })),
});
