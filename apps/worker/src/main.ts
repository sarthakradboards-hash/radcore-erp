import { startProcess } from '@radcore/lib-platform/runtime';

await startProcess('worker', async ({ log }) => {
  // shortcut: no jobs until RAD-44 (pg-boss), so this timer keeps the process up until it is stopped, as pg-boss will.
  const idle = setInterval(() => undefined, 60_000);
  log.info('worker: started, no jobs yet');
  return [{ name: 'idle timer', stop: async () => clearInterval(idle) }];
});
