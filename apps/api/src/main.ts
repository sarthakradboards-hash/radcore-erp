import { authenticateSession, createAuth, createDatabase, newPasswordCheckFor, startProcess, tokenFromCookie } from '@radcore/lib-platform/runtime';
import { createApp, listen } from './app.ts';
import platform from './routes/platform.ts';

await startProcess('api', async ({ config, pool, log }) => {
  const db = createDatabase(pool);
  const auth = await createAuth(config, log);
  // Each module's route file (apps/api/src/routes/<module>.ts) joins this list as modules land.
  const routes = [...platform, ...auth.routes];
  const api = { db, routes, newPasswordCheck: newPasswordCheckFor(config, log),
    // GET /me isn't activity: the shell reads it every minute, and that mustn't keep an idle session alive (RAD-52).
    authenticate: (req: { get(name: string): string | undefined }, route: string) =>
      authenticateSession(db, tokenFromCookie(req.get('cookie')), { touch: route !== 'GET /me' }) };
  const server = await listen(createApp(config, log, api), Number(process.env['API_PORT'] ?? 3001), '127.0.0.1');
  log.info(`api listening on http://127.0.0.1:${server.port}`);
  return [server, auth.store];
});
