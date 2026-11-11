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

/** The input every webhook job takes: the stored delivery's id only, so its payload has one copy (auditor-2). */
export const webhookDelivery = z.strictObject({ id: z.uuid() });

/** What the owning library's service gets: the stored delivery, loaded by the job in its own transaction. */
export type WebhookDelivery = { id: string; source: string; deliveryId: string; payload: string };

export type Webhook = Readonly<{ contract: Contract; source: string; verify: WebhookVerifier; job: JobContract<{ id: string }> }>;

/** A webhook route: its contract (a POST with `auth: 'webhook'`), the provider's check, and the job that acts on it. */
export function defineWebhook(contract: Contract, verify: WebhookVerifier, job: JobContract<{ id: string }>): Webhook {
  const source = `${contract.method} ${contract.path}`;
  if (contract.auth !== 'webhook' || contract.method !== 'POST') throw new TypeError(`${source}: a webhook is a POST with auth: 'webhook'`);
  // ADR-001 §6a: a webhook's work runs as a named system principal with only its listed permissions.
  if (job.principal.kind !== 'system') throw new TypeError(`${job.name}: a webhook's job runs as a system principal`);
  return Object.freeze({ contract, source, verify, job });
}

/**
 * Stores a checked delivery once and queues its job, both in `ctx`'s transaction. Returns false for a repeat, which
 * was stored and queued already: it's answered the same and acted on once. A repeat is the same provider id, or the
 * same signed body under another id, since many providers put the id in an unsigned header (auditor-2, RC-084).
 */
export async function takeDelivery(ctx: Ctx, hook: Webhook, raw: Buffer, providerId: string | null): Promise<boolean> {
  const payload = raw.toString('utf8');
  const bodySha256 = createHash('sha256').update(raw).digest('hex');
  // A provider that sends no id is keyed on its body alone.
  const deliveryId = providerId ?? bodySha256;
  const [row] = await platformTx(ctx).insert(webhookDeliveries).values({ source: hook.source, deliveryId, bodySha256, payload })
    .onConflictDoNothing().returning({ id: webhookDeliveries.id });
  if (row === undefined) return false;
  await ctx.jobs.send(hook.job, { id: row.id });
  return true;
}

/**
 * A webhook's job: loads its delivery, runs the owning library's service on it, then marks the delivery processed,
 * all in the job's one transaction.
 */
export function defineWebhookJob(contract: JobContract<{ id: string }>,
  service: (ctx: Ctx, delivery: WebhookDelivery, meta: JobMeta) => Promise<void>): JobDefinition {
  return defineJob(contract, async (ctx, { id }, meta) => {
    const tx = platformTx(ctx);
    const [delivery] = await tx.select({ id: webhookDeliveries.id, source: webhookDeliveries.source,
      deliveryId: webhookDeliveries.deliveryId, payload: webhookDeliveries.payload }).from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, id));
    if (delivery === undefined) throw new Error(`${contract.name}: delivery ${id} isn't stored`);
    await service(ctx, delivery, meta);
    await tx.update(webhookDeliveries).set({ processedAt: new Date() }).where(eq(webhookDeliveries.id, id));
  });
}