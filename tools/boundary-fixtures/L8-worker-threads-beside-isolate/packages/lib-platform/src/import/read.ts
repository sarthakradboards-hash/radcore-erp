// Outside the isolate, even in its own folder, node:worker_threads is refused.
import { Worker } from 'node:worker_threads';
export { Worker };
