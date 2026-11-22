// RAD-120's time-limit test: a print thread that never answers a job titled "stall", and renders any other as the
// real thread does (it loads render-thread.ts after this listener, so both hear each job).
import { parentPort } from 'node:worker_threads';

parentPort?.on('message', (job: { title: string }) => {
  // Blocks this thread for good, without spinning: only the pool's terminate() ends it.
  if (job.title === 'stall') Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
});
await import('../packages/lib-platform/src/print/render-thread.ts');
