// The worker (ADR-001 §8, RAD-44): runs every job on pg-boss. pg-boss's schema comes from the migrations (0001,
// RAD-25), so run `npm run db:migrate` first; without it the worker refuses to start ("pg-boss is not installed").
import type { JobDefinition } from '@radcore/lib-platform';
import { createJobQueue, runJobs, startProcess } from '@radcore/lib-platform/runtime';

// Each module's job file in ./jobs/ (ADR-001 §8) default-exports its defineJob list; spread them in here.
const jobs: readonly JobDefinition[] = [];

await startProcess('worker', async ({ config, log }) => [await runJobs(createJobQueue(config.database, log), jobs, log)]);
