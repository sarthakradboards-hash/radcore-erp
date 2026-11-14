// Every job the worker runs (ADR-001 §8): each module's job file, then the jobs built at start with what only start-up
// has (the mailer and PUBLIC_ORIGIN, for the invite's and the reset's links). main.ts runs exactly this list, and the permission
// manifest test (RAD-37) checks it against its own table.
import type { JobDefinition } from '@radcore/lib-platform';
import { inviteEmailJob, passwordResetEmailJob } from '@radcore/lib-platform/runtime';
import exportJobs from './jobs/exports.ts';
import platform from './jobs/platform.ts';

// Each module's job file in ./jobs/ default-exports its defineJob list; spread them in here.
export const workerJobs = (start: Parameters<typeof passwordResetEmailJob>[0]): readonly JobDefinition[] =>
  [...platform, ...exportJobs, passwordResetEmailJob(start), inviteEmailJob(start)];
