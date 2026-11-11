// The stuck-delivery watch (RAD-45, RC-084): a stored webhook delivery is processed by its job within minutes, retries
// included. One still unprocessed after half an hour was lost on the way (its job dead-lettered, the relay or worker
// down), so the worker alerts on it, as a system principal that only reads platform's own table. Each alert names the
// webhook, how many, and the oldest one's id and time, never a payload.
import { platformTx, webhookDeliveries } from '@radcore/db/platform';
import { and, count, eq, isNull, lt, min } from 'drizzle-orm';
import { z } from 'zod';
import type { Ctx } from './ctx.ts';
import type { JobContract, JobMeta } from './jobs.ts';

/** Unprocessed for this long, a delivery is stuck: well past its job's last retry (30 s, 60 s, 120 s, each up to 5 min). */
export const STUCK_AFTER_MS = 30 * 60_000;

export const webhookStuckWatch: JobContract<object | null> = {
  name: 'platform.webhook-stuck',
  principal: { kind: 'system', name: 'webhook-stuck', permissions: [] },
  // A schedule sends no payload.
  input: z.strictObject({}).nullable(),
  // Every 15 minutes: a stuck delivery is reported within 45 minutes of arriving, and again each run until it's dealt with.
  every: '*/15 * * * *',
  oneAtATime: true,
};

/** Alerts once per webhook that has deliveries unprocessed for over half an hour. */
export async function watchStuckDeliveries(ctx: Ctx, _input: object | null, { alert }: JobMeta): Promise<void> {
  const tx = platformTx(ctx);
  const stuck = and(isNull(webhookDeliveries.processedAt), lt(webhookDeliveries.createdAt, new Date(Date.now() - STUCK_AFTER_MS)));
  const sources = await tx.select({ source: webhookDeliveries.source, n: count(), oldest: min(webhookDeliveries.createdAt) })
    .from(webhookDeliveries).where(stuck).groupBy(webhookDeliveries.source).orderBy(webhookDeliveries.source);
  for (const s of sources) {
    // Ties (one transaction stores several at once) go to the lower id, so each run names the same one.
    const [first] = await tx.select({ id: webhookDeliveries.id }).from(webhookDeliveries)
      .where(and(stuck, eq(webhookDeliveries.source, s.source)))
      .orderBy(webhookDeliveries.createdAt, webhookDeliveries.id).limit(1);
    await alert(`webhook ${s.source}: ${s.n} deliver${s.n === 1 ? 'y' : 'ies'} unprocessed for over 30 minutes; the oldest `
      + `is ${first?.id ?? 'unknown'}, received ${s.oldest?.toISOString() ?? 'at an unknown time'}`);
  }
}
