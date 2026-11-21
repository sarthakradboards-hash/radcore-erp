// Webhooks' own lane (ADR-001 §6, §8a; RAD-45): a signature is over the raw bytes, so these routes keep the body as
// received, skip the browser's guards (no session, no Origin, no Idempotency-Key: the provider's delivery id does that
// job), and answer as soon as the delivery is stored. The work runs from the queue (lib-platform's webhooks.ts).
// Each request is limited per client address first (RAD-39's `provider-hook` class, RAD-107), then refused if it
// couldn't pass anyway (the hook's precheck, no secret needed), and only then is its hook's stored secret read, outside
// any write, so a rotated secret applies at once, and the signature checked.
// A hook with a handshake also answers the provider's GET subscription check on the same path.
import { randomUUID } from 'node:crypto';
import type { Principal, RequestGuards, Secrets, Webhook } from '@radcore/lib-platform';
import { storedSecret, takeDelivery } from '@radcore/lib-platform';
import { runInTransaction, type Alerter, type Logger } from '@radcore/lib-platform/runtime';
import express, { type Express, type Response } from 'express';

type Database = Parameters<typeof runInTransaction>[0];

// The intake writes only the delivery and its outbox row; the job runs as the webhook's own system principal.
const INTAKE: Principal = Object.freeze({ kind: 'system', name: 'webhook-intake', permissions: Object.freeze([]) });
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
const READ = { readOnly: true, isolation: 'read committed' } as const;

const answer = (res: Response, status: number, code: string, message: string, requestId: string) =>
  res.status(status).json({ code, message, issues: [], requestId });

/** Mounts each webhook before the browser routes' guards and body parser. */
export function mountWebhooks(app: Express, hooks: readonly Webhook[], deps: { db: Database; log: Logger; alert?: Alerter | undefined;
  guards?: RequestGuards | undefined; secrets?: Secrets | undefined }): void {
  const router = express.Router();
  const read = <R>(work: Parameters<typeof runInTransaction<R>>[4]) => runInTransaction(deps.db, READ, INTAKE, randomUUID(), work);
  // A hook that names a secret can't be checked without the secrets library: it refuses rather than passes. A secret
  // that isn't stored refuses every delivery, so it alerts, once an hour per secret (the architect on RAD-107), before
  // the provider gives up retrying.
  const secretOf = async (name: string | undefined, source: string) => {
    if (name === undefined) return null;
    const value = deps.secrets === undefined ? null : await storedSecret(read, deps.secrets, name);
    if (value === null) await deps.alert?.(`${source} refuses every delivery: no ${name} is stored (tools/set-secret.ts)`, `webhook secret ${name}`);
    return value;
  };
  /** The seconds to wait, after counting this request against its address. */
  const wait = async (ip: string | undefined) => (await deps.guards?.address('provider-hook', ip ?? '')) ?? 0;
  for (const hook of hooks) {
    const handshake = hook.handshake;
    if (handshake !== undefined) {
      router.get(hook.contract.path, async (req, res) => {
        res.set('Cache-Control', 'no-store');
        try {
          const seconds = await wait(req.ip);
          if (seconds > 0) {
            res.set('Retry-After', String(seconds)).status(429).end();
            return;
          }
          const query = (name: string) => (typeof req.query[name] === 'string' ? req.query[name] : undefined);
          if (!handshake.asks(query)) {
            res.status(403).end();
            return;
          }
          const answer = handshake.answer(query, await secretOf(handshake.secret, `GET ${hook.contract.path}`));
          if (answer === null) res.status(403).end();
          else res.status(200).type('text/plain').send(answer);
        } catch (err) {
          deps.log.error(`GET ${hook.contract.path} failed`, err);
          res.status(500).end();
        }
      });
    }
    router.post(hook.contract.path, express.raw({ type: () => true, limit: '1mb' }), async (req, res) => {
      const requestId = randomUUID();
      // Set here, not on the router: it sits at '/', and this lane answers only its own paths (auditor-2).
      res.set('Cache-Control', 'no-store');
      try {
        const seconds = await wait(req.ip);
        if (seconds > 0) {
          res.set('Retry-After', String(seconds));
          answer(res, 429, 'rate_limited', 'Too many requests', requestId);
          return;
        }
        const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        const header = (name: string) => req.get(name);
        const check = hook.precheck !== undefined && !hook.precheck(raw, header) ? { valid: false as const }
          : hook.verify(raw, header, await secretOf(hook.secret, hook.source));
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
