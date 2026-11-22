// How many enquiries each campaign and each source had over a range of days, for cost per lead (M3-06, RAD-110).
// Every enquiry counts, whoever owns its lead: campaigns:read is all-only, and the answer is about the campaign, not a
// person. So this file reads past the record scope, on delivered.ts's terms (the architect on RAD-110): it answers
// counts only, keyed by campaign or source id, never a lead's or an enquiry's row, id or field.
import { crmTx, leadEnquiries } from '@radcore/db/crm';
import { addDays } from '@radcore/lib-common';
import { and, count, gte, isNotNull, lt } from 'drizzle-orm';

/** The India day's start, as a moment: an enquiry's received_at is a timestamp, its range India dates. */
const startOf = (day: string): Date => new Date(`${day}T00:00:00+05:30`);

/** Enquiries received from `from` to `to` (India days, both included): by campaign, and by source. */
export async function enquiryCounts(ctx: Parameters<typeof crmTx>[0], from: string, to: string):
  Promise<{ byCampaign: Map<string, number>; bySource: Map<string, number> }> {
  const tx = crmTx(ctx);
  const within = and(gte(leadEnquiries.receivedAt, startOf(from)), lt(leadEnquiries.receivedAt, startOf(addDays(to, 1))));
  const campaigns = await tx.select({ id: leadEnquiries.campaignId, n: count() }).from(leadEnquiries)
    .where(and(within, isNotNull(leadEnquiries.campaignId))).groupBy(leadEnquiries.campaignId);
  const sources = await tx.select({ id: leadEnquiries.sourceId, n: count() }).from(leadEnquiries).where(within).groupBy(leadEnquiries.sourceId);
  return {
    byCampaign: new Map(campaigns.flatMap((r) => (r.id === null ? [] : [[r.id, r.n] as const]))),
    bySource: new Map(sources.map((r) => [r.id, r.n] as const)),
  };
}
