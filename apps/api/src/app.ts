// The api's HTTP server. The generic handler (M1-08) mounts its routes on this app.
import express from 'express';
import { createHealthCheck, type Logger, type Stoppable } from '@radcore/lib-platform/runtime';
import type { Config, Route, Webhook } from '@radcore/lib-platform';
import { mountRoutes, type HandlerDeps } from './http/handler.ts';
import { mountWebhooks } from './http/webhooks.ts';

/** The routes and what the handler needs to run them; without it, the app serves only /health. */
export type Api = Omit<HandlerDeps, 'log' | 'publicOrigin'> & { routes: readonly Route[]; webhooks?: readonly Webhook[] };

export function createApp(config: Config, log: Logger, api?: Api): express.Express {
  const app = express();
  app.disable('x-powered-by');
  // The client's address, for the per-address limits (RAD-39): forwarded-for is believed only from TRUST_PROXY's fixed
  // addresses (proxy and web, ADR-004 §3), so a client can't name its own address and dodge its limit.
  app.set('trust proxy', config.trustProxy);
  const databaseAnswers = createHealthCheck(config.database);
  // ADR-004 §2: Caddy sends /api/health here; it answers only if the database does, so it's limited per address (RAD-39).
  app.get('/health', async (req, res) => {
    try {
      const wait = await api?.guards?.address('health', req.ip ?? '') ?? 0;
      if (wait > 0) {
        res.set('Retry-After', String(wait)).status(429).json({ ok: false });
        return;
      }
      await databaseAnswers();
      res.json({ ok: true });
    } catch (err) {
      log.error('health: the database did not answer', err);
      res.status(503).json({ ok: false });
    }
  });
  if (api !== undefined) {
    // Webhooks first: their own lane, with the raw body, ahead of the browser routes' guards and JSON parser.
    mountWebhooks(app, api.webhooks ?? [], { db: api.db, log });
    mountRoutes(app, api.routes, { db: api.db, log, authenticate: api.authenticate, publicOrigin: config.publicOrigin,
      newPasswordCheck: api.newPasswordCheck, files: api.files, secrets: api.secrets, guards: api.guards });
  }
  return app;
}

/** Listen, and return how to stop: no new connections, requests in flight finish, idle keep-alives close. */
export function listen(app: express.Express, port: number, host: string): Promise<Stoppable & { port: number }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host);
    server.once('error', reject);
    server.once('listening', () => {
      const address = server.address();
      resolve({
        name: 'http server',
        port: typeof address === 'object' && address !== null ? address.port : port,
        stop: () => new Promise((done, fail) => server.close((err) => (err ? fail(err) : done()))),
      });
    });
  });
}
