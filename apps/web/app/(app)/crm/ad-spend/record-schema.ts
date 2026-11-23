// What the ad spend dialog sends (RAD-122 on RAD-110's recordAdSpend), out of the page so a test can read it.
import { recordAdSpend } from '@radcore/lib-crm/contract';
import { z } from 'zod';
import { t } from '../../../../lib/i18n/index.ts';

const spendShape = recordAdSpend.input.shape;
export const recordSchema = z.object({
  on: z.enum(['campaign', 'source']), campaignId: z.string(), sourceId: z.string(),
  fromDate: spendShape.fromDate, toDate: spendShape.toDate, note: z.string().trim(),
  // Checked here, before the contract pipe: its refine reads the amount as a decimal and throws on "" (e2e-2 on #355).
  amount: z.string().trim().min(1, t('crm.adSpend.amountNeeded')).pipe(spendShape.amount),
}).transform((v, ctx) => {
  const target = v.on === 'campaign' ? v.campaignId : v.sourceId;
  if (target === '') {
    ctx.addIssue({ code: 'custom', path: [v.on === 'campaign' ? 'campaignId' : 'sourceId'], message: t(v.on === 'campaign' ? 'crm.adSpend.campaign.pick' : 'crm.adSpend.source.pick') });
    return z.NEVER;
  }
  const rest = { fromDate: v.fromDate, toDate: v.toDate, amount: v.amount, note: v.note === '' ? null : v.note };
  const out: z.input<typeof recordAdSpend.input> = v.on === 'campaign' ? { ...rest, campaignId: target } : { ...rest, sourceId: target };
  return out;
}).pipe(recordAdSpend.input);
