import { createDatabase, newPasswordCheckFor, startProcess } from '@radcore/lib-platform/runtime';
import { createApp, listen } from './app.ts';
import platform from './routes/platform.ts';

// Each module's route file (apps/api/src/routes/<module>.ts) default-exports its defineRoute list; spread them in here.
const ROUTES = [...platform];

await startProcess('api', async ({ config, pool, log }) => {
  // shortcut: no one can sign in until sessions land (RAD-32), so every session route answers 401 signed_out.
  const api = { db: createDatabase(pool), routes: ROUTES, authenticate: async () => null,
    newPasswordCheck: newPasswordCheckFor(config, log) };
  const server = await listen(createApp(config, log, api), Number(process.env['API_PORT'] ?? 3001), '127.0.0.1');
  log.info(`api listening on http://127.0.0.1:${server.port}`);
  return [server];
});
