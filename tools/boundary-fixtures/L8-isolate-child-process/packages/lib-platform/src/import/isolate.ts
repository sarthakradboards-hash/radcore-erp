// The isolate's zone lifts node:worker_threads only: child_process stays refused.
import { spawn } from 'node:child_process';
export { spawn };
