// The isolate's zone lifts node:worker_threads only: http stays refused.
import { request } from 'node:http';
export { request };
