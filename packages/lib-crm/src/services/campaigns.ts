// Campaigns and ad spend (M3-06, RAD-110; the architect's rulings), under campaigns:read and campaigns:write. A
// campaign's link is the public enquiry page with its random token, and the screen draws the QR code from that link;
// the token grants nothing beyond tagging an enquiry, and an ended campaign's still lets the enquiry in, untagged.
// Ad spend feeds cost per lead only and posts nothing to the books: the Meta or Google bill is booked through
// purchases. Cost per lead is worked out on read, never stored.
import { randomBytes } from 'node:crypto';
import { adSpend, after, campaigns, crmTx, leadSources } from '@radcore/db/crm';
import { dec, roundMoney } from '@radcore/lib-common';
import { AppError, decodeCursor, encodeCursor, type Ctx } from '@radcore/lib-platform';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, sum } from 'drizzle-orm';
import { z } from 'zod';
import type { costPerLead, createCampaign, endCampaign, listAdSpend, listCampaigns, recordAdSpend } from '../contract.ts';
import { enquiryCounts } from './enquiry-counts.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;

const PAGE_KEY = z.object({ at: z.iso.datetime({ offset: true }), id: z.uuid() });
/** The public enquiry page with a campaign's token: its link, relative to the site, and its QR code's text. */
export const campaignPath = (token: string): string => `/enquiry?c=${token}`;
const unknownSource = () => new AppError('unknown_source', 'Choose the website form’s or a QR source',
  [{ path: ['sourceId'], code: 'unknown', message: 'Choose a source' }]);

/** GET /crm/campaigns (campaigns:read): newest first. */
export async function campaignsPage(ctx: Ctx, input: In<typeof listCampaigns>): Promise<Out<typeof listCampaigns>> {
  const key = input.after === undefined ? undefined : decodeCursor(PAGE_KEY, input.after);
  const rows = await crmTx(ctx).select({ id: campaigns.id, name: campaigns.name, sourceId: campaigns.sourceId, token: campaigns.token,
    endedAt: campaigns.endedAt, createdAt: campaigns.createdAt }).from(campaigns).where(and(
    input.filter.ended === undefined ? undefined : input.filter.ended ? isNotNull(campaigns.endedAt) : isNull(campaigns.endedAt),
    after([campaigns.createdAt, campaigns.id], key && [new Date(key.at), key.id], 'desc'),
  )).orderBy(desc(campaigns.createdAt), desc(campaigns.id)).limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return {
    items: page.map((r) => ({ id: r.id, name: r.name, sourceId: r.sourceId, path: campaignPath(r.token), endedAt: r.endedAt?.toISOString() ?? null })),
    next: rows.length > input.limit && last ? encodeCursor({ at: last.createdAt.toISOString(), id: last.id }) : null,
  };
}

/** POST /crm/campaigns (campaigns:write): counted under the form's source or a QR one, with a new random token. */
export async function addCampaign(ctx: Ctx, { name, sourceId }: In<typeof createCampaign>): Promise<Out<typeof createCampaign>> {
  const tx = crmTx(ctx);
  const [source] = await tx.select({ id: leadSources.id }).from(leadSources)
    .where(and(eq(leadSources.id, sourceId), inArray(leadSources.channel, ['form', 'qr'])));
  if (source === undefined) throw unknownSource();
  const token = randomBytes(16).toString('base64url');
  const [row] = await tx.insert(campaigns).values({ name, sourceId, token }).returning({ id: campaigns.id });
  if (row === undefined) throw new Error('the insert returned no row');
  return { id: row.id, path: campaignPath(token) };
}

/** POST /crm/campaigns/:id/end (campaigns:write): once; its link still lets enquiries in, with no campaign. */
export async function endCampaignNow(ctx: Ctx, { id }: In<typeof endCampaign>): Promise<Out<typeof endCampaign>> {
  const tx = crmTx(ctx);
  const [c] = await tx.select({ endedAt: campaigns.endedAt }).from(campaigns).where(eq(campaigns.id, id)).for('update');
  if (c === undefined) throw new AppError('not_found', 'There is no such campaign');
  if (c.endedAt !== null) throw new AppError('campaign_ended', 'This campaign has already ended');
  await tx.update(campaigns).set({ endedAt: new Date() }).where(eq(campaigns.id, id));
  return {};
}

/** GET /crm/ad-spend (campaigns:read): newest first. */
export async function adSpendPage(ctx: Ctx, input: In<typeof listAdSpend>): Promise<Out<typeof listAdSpend>> {
  const key = input.after === undefined ? undefined : decodeCursor(PAGE_KEY, input.after);
  const rows = await crmTx(ctx).select().from(adSpend).where(and(
    input.filter.campaignId === undefined ? undefined : eq(adSpend.campaignId, input.filter.campaignId),
    input.filter.sourceId === undefined ? undefined : eq(adSpend.sourceId, input.filter.sourceId),
    after([adSpend.createdAt, adSpend.id], key && [new Date(key.at), key.id], 'desc'),
  )).orderBy(desc(adSpend.createdAt), desc(adSpend.id)).limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return {
    items: page.map((r) => ({ id: r.id, campaignId: r.campaignId, sourceId: r.sourceId, fromDate: r.fromDate, toDate: r.toDate,
      amount: roundMoney(r.amount), note: r.note })),
    next: rows.length > input.limit && last ? encodeCursor({ at: last.createdAt.toISOString(), id: last.id }) : null,
  };
}

/** POST /crm/ad-spend (campaigns:write): on one campaign or one source. It posts nothing to the books. */
export async function addAdSpend(ctx: Ctx, input: In<typeof recordAdSpend>): Promise<Out<typeof recordAdSpend>> {
  const tx = crmTx(ctx);
  if (input.campaignId !== undefined) {
    const [c] = await tx.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.id, input.campaignId));
    if (c === undefined) {
      throw new AppError('unknown_campaign', 'There is no such campaign', [{ path: ['campaignId'], code: 'unknown', message: 'Choose a campaign' }]);
    }
  }
  if (input.sourceId !== undefined) {
    const [s] = await tx.select({ id: leadSources.id }).from(leadSources).where(eq(leadSources.id, input.sourceId));
    if (s === undefined) {
      throw new AppError('unknown_source', 'There is no such source', [{ path: ['sourceId'], code: 'unknown', message: 'Choose a source' }]);
    }
  }
  const [row] = await tx.insert(adSpend).values({ campaignId: input.campaignId ?? null, sourceId: input.sourceId ?? null,
    fromDate: input.fromDate, toDate: input.toDate, amount: input.amount, note: input.note }).returning({ id: adSpend.id });
  if (row === undefined) throw new Error('the insert returned no row');
  return row;
}

/** Spend ÷ enquiries, to the paisa; none when there were no enquiries. */
const per = (spend: string, enquiries: number) => (enquiries === 0 ? null : roundMoney(dec(spend).div(enquiries)));

/** GET /crm/cost-per-lead (campaigns:read): each campaign and source with spend recorded within the range. */
export async function costPerLeadIn(ctx: Ctx, { fromDate, toDate }: In<typeof costPerLead>): Promise<Out<typeof costPerLead>> {
  const tx = crmTx(ctx);
  const within = and(gte(adSpend.fromDate, fromDate), lte(adSpend.toDate, toDate));
  const byCampaign = await tx.select({ id: campaigns.id, name: campaigns.name, spend: sum(adSpend.amount) }).from(adSpend)
    .innerJoin(campaigns, eq(campaigns.id, adSpend.campaignId)).where(within).groupBy(campaigns.id, campaigns.name).orderBy(asc(campaigns.name));
  const bySource = await tx.select({ id: leadSources.id, name: leadSources.name, spend: sum(adSpend.amount) }).from(adSpend)
    .innerJoin(leadSources, eq(leadSources.id, adSpend.sourceId)).where(within).groupBy(leadSources.id, leadSources.name)
    .orderBy(asc(leadSources.name));
  const counts = await enquiryCounts(ctx, fromDate, toDate);
  const row = (r: { id: string; name: string; spend: string | null }, n: number) => {
    const spend = roundMoney(r.spend ?? '0');
    return { id: r.id, name: r.name, spend, enquiries: n, costPerLead: per(spend, n) };
  };
  return { campaigns: byCampaign.map((r) => row(r, counts.byCampaign.get(r.id) ?? 0)),
    sources: bySource.map((r) => row(r, counts.bySource.get(r.id) ?? 0)) };
}
