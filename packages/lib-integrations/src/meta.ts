// Meta lead ads (RAD-107). The webhook only says a lead exists (`leadgen_id`); its answers come from a Graph API call,
// which is M7's. Until then a notification is kept, waiting, and the fetched lead's parse is built and tested on a
// fixture behind MetaLeadFetch.
import { z } from 'zod';

const NOTIFICATION = z.object({
  object: z.string(),
  entry: z.array(z.object({
    changes: z.array(z.object({ field: z.string(), value: z.object({ leadgen_id: z.union([z.string(), z.number()]).optional(),
      form_id: z.union([z.string(), z.number()]).optional(), page_id: z.union([z.string(), z.number()]).optional() }).loose() })),
  })).max(100),
});

/** A lead a notification names, with its form and page when given. */
export type LeadgenNotice = { leadgenId: string; formId: string | null; pageId: string | null };
const idOrNull = (v: string | number | undefined) => (v === undefined ? null : String(v));

/** Every lead a notification names (one notification can batch several). */
export function leadgenNotices(payload: string): LeadgenNotice[] {
  const n = NOTIFICATION.parse(JSON.parse(payload));
  if (n.object !== 'page') return [];
  return n.entry.flatMap((e) => e.changes).filter((c) => c.field === 'leadgen' && c.value.leadgen_id !== undefined)
    .map((c) => ({ leadgenId: String(c.value.leadgen_id), formId: idOrNull(c.value.form_id), pageId: idOrNull(c.value.page_id) }));
}

const LEAD = z.object({
  id: z.string(),
  created_time: z.string().optional(),
  field_data: z.array(z.object({ name: z.string(), values: z.array(z.string()) })).max(100),
});

/** A fetched lead's answers, by Meta's standard field names. */
export type MetaLead = { id: string; phone: string | undefined; name: string | undefined; email: string | undefined;
  createdAt: Date | undefined };

export function parseMetaLead(body: string): MetaLead {
  const lead = LEAD.parse(JSON.parse(body));
  const field = (name: string) => lead.field_data.find((f) => f.name === name)?.values[0]?.trim() || undefined;
  const at = lead.created_time === undefined ? undefined : new Date(lead.created_time);
  return { id: lead.id, phone: field('phone_number'), name: field('full_name'), email: field('email'),
    createdAt: at === undefined || Number.isNaN(at.getTime()) ? undefined : at };
}

/** Fetches a lead's Graph API body by its id. M7 supplies the live client; until then there is none. */
export type MetaLeadFetch = (leadgenId: string) => Promise<string>;
