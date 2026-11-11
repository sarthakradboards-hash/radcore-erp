// Webhook intake (ADR-001 §8a, RAD-45, RC-084): a delivery from an outside service is checked on its raw bytes,
// stored once, and answered at once; the work runs later, from the queue, with retries.
//   route ─► the provider's signature check on the raw body (refused: 401, nothing stored)
//   ─► one transaction: insert the delivery under unique (source, delivery id), a repeat stops here (answered 200,
//      nothing queued) ─► queue its job through the outbox ─► commit ─► 200
//   ─► the worker runs the owning library's service as the job's system principal, then marks the delivery processed
// lib-platform knows no provider: the route hands it the provider's check from lib-integrations (ADR-001 §8a).
import { createHash } from 'node:crypto';
import { platformTx, webhookDeliveries } from '@radcore/db/platform';
import type { Contract } from '@radcore/lib-common';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Ctx } from './ctx.ts';
import { defineJob, type JobContract, type JobDefinition, type JobMeta } from './jobs.ts';

/** A provider's check of one delivery: refused, or valid with the provider's delivery id (null when it sends none). */
export type WebhookCheck = { valid: false } | { valid: true; deliveryId: string | null };
/** The provider's signature check over the raw bytes, with the request's headers (lib-integrations supplies it). */
export type WebhookVerifier = (raw: Buffer, header: (name: string) => string | undefined) => WebhookCheck;

/** The input every webhook job takes: one stored delivery, with its raw body. */
export const webhookDelivery = z.object({ id: z.uuid(), source: z.string(), deliveryId: z.string(), payload: z.string() });
export type WebhookDelivery = z.output<typeof webhookDelivery>;

export type Webhook = Readonly<{ contract: Contract; source: string; verify: WebhookVerifier; job: JobContract<WebhookDelivery> }>;

/** A webhook route: its contract (a POST with `auth: 'webhook'`), the provider's check, and the job that acts on it. */
export function defineWebhook(contract: Contract, verify: WebhookVerifier, job: JobContract<WebhookDelivery>): Webhook {
  const source = `${contract.method} ${contract.path}`;
  if (contract.auth !== 'webhook' || contract.method !== 'POST') throw new TypeError(`${source}: a webhook is a POST with auth: 'webhook'`);
  // ADR-001 §6a: a webhook's work runs as a named system principal with only its listed permissions.
  if (job.principal.kind !== 'system') throw new TypeError(`${job.name}: a webhook's job runs as a system principal`);
  return Object.freeze({ contract, source, verify, job });
}

/**
 * Stores a checked delivery once and queues its job, both in `ctx`'s transaction. Returns false for a repeat (the same
 * source and delivery id), which was stored and queued already: it's answered the same and acted on once.
 */
export async function takeDelivery(ctx: Ctx, hook: Webhook, raw: Buffer, providerId: string | null): Promise<boolean> {
  const payload = raw.toString('utf8');
  // A provider that sends no id gets one from the body itself, so a byte-for-byte resend is still caught.
  const deliveryId = providerId ?? createHash('sha256').update(raw).digest('hex');
  const [row] = await platformTx(ctx).insert(webhookDeliveries).values({ source: hook.source, deliveryId, payload })
    .onConflictDoNothing().returning({ id: webhookDeliveries.id });
  if (row === undefined) return false;
  await ctx.jobs.send(hook.job, { id: row.id, source: hook.source, deliveryId, payload });
  return true;
}

/** A webhook's job: the owning library's service, then its delivery marked processed in the same transaction. */
export function defineWebhookJob(contract: JobContract<WebhookDelivery>,
  service: (ctx: Ctx, delivery: WebhookDelivery, meta: JobMeta) => Promise<void>): JobDefinition {
  return defineJob(contract, async (ctx, delivery, meta) => {
    await service(ctx, delivery, meta);
    await platformTx(ctx).update(webhookDeliveries).set({ processedAt: new Date() }).where(eq(webhookDeliveries.id, delivery.id));
  });
}
