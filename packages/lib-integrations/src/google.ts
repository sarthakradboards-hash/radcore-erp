// Google Ads lead form webhooks (RAD-107): Google signs nothing, and proves the delivery with the `google_key` set on
// the form. That key is its own secret, never a campaign link's token (RC-054), compared in constant time.
import type { WebhookCheck } from '@radcore/lib-platform';
import { z } from 'zod';
import { sameSecret } from './hub.ts';

const LEAD = z.object({
  lead_id: z.string().min(1).max(200),
  google_key: z.string(),
  user_column_data: z.array(z.object({ column_id: z.string(), string_value: z.string().optional() })).max(100),
});

const parse = (raw: Buffer | string) => {
  try {
    return LEAD.safeParse(JSON.parse(raw.toString()));
  } catch {
    return LEAD.safeParse(undefined);
  }
};

/** Whether a delivery is a well-formed lead with a key at all: the check before the stored key is read. */
export const googleKeyed = (raw: Buffer): boolean => {
  const lead = parse(raw);
  return lead.success && lead.data.google_key !== '';
};

/** The delivery's proof: a well-formed lead whose `google_key` is the stored one. The lead's own id keys it. */
export function googleLeadCheck(raw: Buffer, _header: (name: string) => string | undefined, key: string | null): WebhookCheck {
  const lead = parse(raw);
  if (key === null || key === '' || !lead.success || !sameSecret(lead.data.google_key, key)) return { valid: false };
  return { valid: true, deliveryId: lead.data.lead_id };
}

/** What a lead form asked, by Google's column ids. */
export type GoogleLead = { phone: string | undefined; name: string | undefined; email: string | undefined };

export function parseGoogleLead(payload: string): GoogleLead {
  const lead = parse(payload);
  if (!lead.success) throw new TypeError('A stored Google lead no longer parses');
  const column = (id: string) => lead.data.user_column_data.find((c) => c.column_id === id)?.string_value?.trim() || undefined;
  const first = column('FIRST_NAME');
  const last = column('LAST_NAME');
  return {
    phone: column('PHONE_NUMBER'),
    name: column('FULL_NAME') ?? ([first, last].filter(Boolean).join(' ') || undefined),
    email: column('EMAIL'),
  };
}
