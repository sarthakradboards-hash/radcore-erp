// Every job the worker runs (ADR-001 §8): each module's job file, then the jobs built here: the one export job, with
// every module's exports and the masters workbook joined in ./masters.ts (RAD-92, ADR-001 §8b), and the jobs that need
// what only start-up has (the mailer and PUBLIC_ORIGIN, for the invite's and the reset's links). main.ts runs exactly
// this list, and the permission manifest test (RAD-37) checks it against its own table.
import { defineExportJob, type JobDefinition } from '@radcore/lib-platform';
import { inviteEmailJob, passwordResetEmailJob } from '@radcore/lib-platform/runtime';
import platform from './jobs/platform.ts';
import { masters } from './masters.ts';

// Each module's job file in ./jobs/ default-exports its defineJob list; spread them in here.
export const workerJobs = (start: Parameters<typeof passwordResetEmailJob>[0]): readonly JobDefinition[] =>
  [...platform, defineExportJob([masters]), passwordResetEmailJob(start), inviteEmailJob(start)];
