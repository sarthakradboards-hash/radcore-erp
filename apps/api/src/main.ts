import { createSecrets, sessionCookieFor } from '@radcore/lib-platform';
import { authenticateSession, createAuth, createDatabase, newPasswordCheckFor, startFileStore, startProcess } from '@radcore/lib-platform/runtime';
import { createApp, listen } from './app.ts';
import fileRoutes from './routes/files.ts';
import platform from './routes/platform.ts';

// Each module's route file (apps/api/src/routes/<module>.ts) default-exports its defineRoute list; spread them in here.
const ROUTES = [...fileRoutes, ...platform];

await startProcess('api', async ({ config, pool, log }) => {
  const db = createDatabase(pool);
  const files = await startFileStore(config.s3, log);
  const auth = await createAuth(config, log);
  const session = sessionCookieFor(config.publicOrigin);
  // Sign-in and the password routes are built at start, with Argon2id and the lockout store (createAuth).
  const api = { db, routes: [...ROUTES, ...auth.routes], newPasswordCheck: newPasswordCheckFor(config, log), files: files.store,
    secrets: createSecrets(config.secrets),
    // GET /me isn't activity: the shell reads it every minute, and that mustn't keep an idle session alive (RAD-52).
    authenticate: (req: { get(name: string): string | undefined }, route: string) =>
      authenticateSession(db, session.tokenIn(req.get('cookie')), { touch: route !== 'GET /me' }) };
  const server = await listen(createApp(config, log, api), Number(process.env['API_PORT'] ?? 3001), '127.0.0.1');
  log.info(`api listening on http://127.0.0.1:${server.port}`);
  // The server stops first, so no request is left signing with stopped credentials.
  return [server, files, auth.store];
});
