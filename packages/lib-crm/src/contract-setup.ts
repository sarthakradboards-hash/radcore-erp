// CRM setup (M3-06, RAD-110; the architect's rulings), re-exported by contract.ts: lead sources and their "ignore"
// (leads:setup), the enquiries an ignored source set aside (leads:setup), and campaigns, their links and ad spend,
// with cost per lead (campaigns:read and campaigns:write). Like every contract file it imports only zod and
// lib-common (D5).
import { dateString, dec, defineContract, idString, listInput, listOf, momentString, moneyString } from '@radcore/lib-common';
import { z } from 'zod';

const read = { readOnly: true, isolation: 'read committed' } as const;
const write = { readOnly: false, isolation: 'read committed' } as const;
const name = () => z.string().trim().min(1).max(80);
const CHANNELS = ['manual', 'walk_in', 'form', 'meta', 'google', 'whatsapp', 'qr'] as const;

const source = z.object({
  id: idString(), name: z.string(), channel: z.enum(CHANNELS),
  // A door's own source, seeded with it; the rest a person added, for capture by hand or at the counter.
  door: z.boolean(), active: z.boolean(), ignored: z.boolean(),
});

/** Every lead source, doors' first, then by name. */
export const listLeadSources = defineContract({
  method: 'GET', path: '/crm/lead-sources', auth: 'session', perm: 'leads:setup', tx: read,
  input: z.object({}), output: z.object({ sources: z.array(source) }),
});
/** A source for capture by hand or at the counter (a referral, a trade fair). A door's own source is seeded. */
export const createLeadSource = defineContract({
  method: 'POST', path: '/crm/lead-sources', auth: 'session', perm: 'leads:setup', tx: write,
  input: z.object({ name: name(), channel: z.enum(['manual', 'walk_in']) }), output: z.object({ id: idString() }),
  errors: ['name_taken'], dbErrors: { '23505:ux_lead_sources_name_key': { code: 'name_taken', message: 'Another source already has this name' } },
});
/**
 * A source renamed, switched off or on, or ignored. An ignored source's new enquiries are stored and set aside, never
 * made leads, and un-ignoring it brings none back. Only an outside door's source can be ignored (the form, campaigns,
 * Google, Meta and WhatsApp): a person typed the rest, and orders never come in through a source (RC-212).
 */
export const updateLeadSource = defineContract({
  method: 'PUT', path: '/crm/lead-sources/:id', auth: 'session', perm: 'leads:setup', tx: write,
  input: z.object({ id: idString(), name: name(), active: z.boolean(), ignored: z.boolean() }), output: z.object({}),
  errors: ['name_taken', 'source_not_ignorable'],
  dbErrors: {
    '23505:ux_lead_sources_name_key': { code: 'name_taken', message: 'Another source already has this name' },
    '23514:ck_lead_sources_ignorable': { code: 'source_not_ignorable', message: 'Only an outside door’s source can be ignored: a person typed this one' },
  },
});

/** The enquiries ignored sources set aside, newest first. Each phone is the mask itself, its last 4 kept, as on every
 * lead list (RC-041): nothing disappears unseen, and nothing here is a lead. */
export const listSetAside = defineContract({
  method: 'GET', path: '/crm/set-aside', auth: 'session', perm: 'leads:setup', tx: read,
  input: listInput(z.object({ sourceId: idString().optional() })),
  output: listOf(z.object({
    id: idString(), sourceId: idString(), campaignId: idString().nullable(), phone: z.object({ masked: z.string() }),
    name: z.string().nullable(), message: z.string().nullable(), receivedAt: momentString(),
  })),
});

const campaign = z.object({
  id: idString(), name: z.string(), sourceId: idString(),
  // The public enquiry page with the campaign's token: the link, and what the screen draws as the QR code.
  path: z.string(), endedAt: momentString().nullable(),
});

/** Campaigns, newest first. */
export const listCampaigns = defineContract({
  method: 'GET', path: '/crm/campaigns', auth: 'session', perm: 'campaigns:read', tx: read,
  input: listInput(z.object({ ended: z.boolean().optional() })), output: listOf(campaign),
});
/** A campaign, counted under a form or QR source: its link carries a new random token, which grants nothing. */
export const createCampaign = defineContract({
  method: 'POST', path: '/crm/campaigns', auth: 'session', perm: 'campaigns:write', tx: write,
  input: z.object({ name: name(), sourceId: idString() }), output: z.object({ id: idString(), path: z.string() }),
  errors: ['name_taken', 'unknown_source'],
  dbErrors: { '23505:ux_campaigns_name_key': { code: 'name_taken', message: 'Another campaign already has this name' } },
});
/** Ends a campaign: enquiries through its link still come in, with no campaign. */
export const endCampaign = defineContract({
  method: 'POST', path: '/crm/campaigns/:id/end', auth: 'session', perm: 'campaigns:write', tx: write,
  input: z.object({ id: idString() }), output: z.object({}), errors: ['campaign_ended'],
});

const range = { fromDate: dateString(), toDate: dateString() };
const spend = z.object({
  id: idString(), campaignId: idString().nullable(), sourceId: idString().nullable(), ...range, amount: moneyString(),
  note: z.string().nullable(),
});

/** Ad spend entries, newest first: a campaign's or a source's, when given. */
export const listAdSpend = defineContract({
  method: 'GET', path: '/crm/ad-spend', auth: 'session', perm: 'campaigns:read', tx: read,
  input: listInput(z.object({ campaignId: idString().optional(), sourceId: idString().optional() })), output: listOf(spend),
});
/**
 * What was spent on one campaign or one source over a range of days. It feeds cost per lead only and posts nothing to
 * the books: the Meta or Google bill is booked through purchases, so nothing is counted twice (the architect).
 */
export const recordAdSpend = defineContract({
  method: 'POST', path: '/crm/ad-spend', auth: 'session', perm: 'campaigns:write', tx: write,
  input: z.object({ campaignId: idString().optional(), sourceId: idString().optional(), ...range, amount: moneyString(),
    note: z.string().trim().min(1).max(200).nullable() })
    .refine((s) => (s.campaignId === undefined) !== (s.sourceId === undefined), { path: ['campaignId'], error: 'Name a campaign or a source' })
    .refine((s) => s.toDate >= s.fromDate, { path: ['toDate'], error: 'The range ends on or after it starts' })
    // An amount that isn't money already has its own issue; only one that is can be judged above zero (e2e-2 on #355:
    // dec() threw on "", a 500, not a 422).
    .refine((s) => !moneyString().safeParse(s.amount).success || dec(s.amount).gt(0), { path: ['amount'], error: 'Enter what was spent' }),
  output: z.object({ id: idString() }), errors: ['unknown_campaign', 'unknown_source'],
});

const cost = z.object({ id: idString(), name: z.string(), spend: moneyString(), enquiries: z.number().int().nonnegative(),
  costPerLead: moneyString().nullable() });

/**
 * Cost per lead over a range of days, worked out on read: each campaign's and each source's spend recorded within the
 * range (entries starting and ending in it), divided by its enquiries received in it; none when it had none. A
 * campaign's enquiries are those through its link; a source's, all of its own.
 */
export const costPerLead = defineContract({
  method: 'GET', path: '/crm/cost-per-lead', auth: 'session', perm: 'campaigns:read', tx: read,
  input: z.object(range).refine((r) => r.toDate >= r.fromDate, { path: ['toDate'], error: 'The range ends on or after it starts' }),
  output: z.object({ campaigns: z.array(cost), sources: z.array(cost) }),
});
