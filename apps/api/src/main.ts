import { startProcess } from '@radcore/lib-platform/runtime';
import { createApp, listen } from './app.ts';

await startProcess('api', async ({ config, log }) => {
  const server = await listen(createApp(config, log), Number(process.env['API_PORT'] ?? 3001), '127.0.0.1');
  log.info(`api listening on http://127.0.0.1:${server.port}`);
  return [server];
});
