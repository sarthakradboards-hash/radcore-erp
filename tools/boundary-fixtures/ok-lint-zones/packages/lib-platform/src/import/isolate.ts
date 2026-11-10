// L8 lifts node:worker_threads in the import isolate (ADR-002).
import { isMainThread, Worker } from 'node:worker_threads';
export const start = (u: URL) => (isMainThread ? new Worker(u, { env: {} }) : null);
