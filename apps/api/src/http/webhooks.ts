// Webhooks' own lane (ADR-001 §6, §8a; RAD-45): a signature is over the raw bytes, so these routes keep the body as
// received, skip the browser's guards (no session, no Origin, no Idempotency-Key: the provider's delivery id does that
// job), and answer as soon as the delivery is stored. The work runs from the queue (lib-platform's webhooks.ts).
// shortcut: no rate guard yet; RAD-39 (M1-21) adds the per-IP limits to this lane as to the others.
import { randomUUID } from 'node:crypto';
import type { Principal, Webhook } from '@radcore/lib-platform';
import { takeDelivery } from '@radcore/lib-platform';
import { runInTransaction, type Alerter, type Logger } from '@radcore/lib-platform/runtime';
import express, { type Express, type Response } from 'express';

type Database = Parameters<typeof runInTransaction>[0];

// The intake writes only the delivery and its outbox row; the job runs as the webhook's own system principal.
const INTAKE: Principal = Object.freeze({ kind: 'system', name: 'webhook-intake', permissions: Object.freeze([]) });
const WRITE = { readOnly: false, isolation: 'read committed' } as const;

const answer = (res: Response, status: number, code: string, message: string, requestId: string) =>
  res.status(status).json({ code, message, issues: [], requestId });

/** Mounts each webhook before the browser routes' guards and body parser. */
export function mountWebhooks(app: Express, hooks: readonly Webhook[], deps: { db: Database; log: Logger; alert?: Alerter | undefined }): void {
  const router = express.Router();
  for (const hook of hooks) {
    router.post(hook.contract.path, express.raw({ type: () => true, limit: '1mb' }), async (req, res) => {
      const requestId = randomUUID();
      // Set here, not on the router: it sits at '/', and this lane answers only its own paths (auditor-2).
      res.set('Cache-Control', 'no-store');
      try {
        const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        const check = hook.verify(raw, (name) => req.get(name));
        // Refused before anything is stored: a forged or altered delivery leaves no trace but this answer.
        if (!check.valid) {
          answer(res, 401, 'signed_out', 'The signature does not match', requestId);
          return;
        }
        await runInTransaction(deps.db, WRITE, INTAKE, requestId, (ctx) => takeDelivery(ctx, hook, raw, check.deliveryId));
        // The same answer for a first delivery and a repeat: the provider stops resending either way.
        res.status(200).json({});
      } catch (err) {
        // Ids only, never the body (RAD-29).
        deps.log.error(`${hook.source} failed (request ${requestId})`, err);
        answer(res, 500, 'server_error', 'Something went wrong on our side', requestId);
        await deps.alert?.(`the ${hook.source} webhook failed (request ${requestId})`, `api webhook ${hook.contract.path}`);
      }
    });
  }
  app.use(router);
}
