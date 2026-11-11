import { createDatabase, newPasswordCheckFor, startFileStore, startProcess } from '@radcore/lib-platform/runtime';
import { createApp, listen } from './app.ts';
import fileRoutes from './routes/files.ts';

// Each module's route file (apps/api/src/routes/<module>.ts) joins this list as modules land.
const ROUTES = [...fileRoutes];

await startProcess('api', async ({ config, pool, log }) => {
  // shortcut: no one can sign in until sessions land (RAD-32), so every session route answers 401 signed_out.
  const files = await startFileStore(config.s3, log);
  const api = { db: createDatabase(pool), routes: ROUTES, authenticate: async () => null,
    newPasswordCheck: newPasswordCheckFor(config, log), files: files.store };
  const server = await listen(createApp(config, log, api), Number(process.env['API_PORT'] ?? 3001), '127.0.0.1');
  log.info(`api listening on http://127.0.0.1:${server.port}`);
  // The server stops first, so no request is left signing with stopped credentials.
  return [server, files];
});
