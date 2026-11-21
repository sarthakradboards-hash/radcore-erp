// WhatsApp Cloud API inbound messages (RAD-107): who wrote (their WhatsApp number, digits only), their profile name,
// and what they wrote. Only text is taken; a photo or a voice note still becomes an enquiry, with no message.
import { z } from 'zod';

const PAYLOAD = z.object({
  object: z.string(),
  entry: z.array(z.object({
    changes: z.array(z.object({
      field: z.string(),
      value: z.object({
        contacts: z.array(z.object({ wa_id: z.string(), profile: z.object({ name: z.string().optional() }).optional() })).optional(),
        messages: z.array(z.object({
          from: z.string(), id: z.string(), timestamp: z.string(), type: z.string(),
          text: z.object({ body: z.string() }).optional(),
        })).optional(),
      }).loose(),
    })),
  })).max(100),
});

export type WhatsappMessage = { phone: string; name: string | undefined; text: string | undefined; at: Date };

/** Each message a delivery holds; delivery receipts and status updates hold none. */
export function whatsappMessages(payload: string): WhatsappMessage[] {
  const p = PAYLOAD.parse(JSON.parse(payload));
  if (p.object !== 'whatsapp_business_account') return [];
  return p.entry.flatMap((e) => e.changes).filter((c) => c.field === 'messages').flatMap((c) => (c.value.messages ?? []).map((m) => ({
    phone: `+${m.from.replace(/\D/g, '')}`,
    name: c.value.contacts?.find((k) => k.wa_id === m.from)?.profile?.name?.trim() || undefined,
    text: m.type === 'text' ? m.text?.body : undefined,
    at: new Date(Number(m.timestamp) * 1000),
  })));
}
