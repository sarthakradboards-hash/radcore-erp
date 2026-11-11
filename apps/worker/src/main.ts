// The worker (ADR-001 §8, RAD-44): runs every job on pg-boss, raises dead-letter alerts to ALERT_WEBHOOK_URL and sends
// the heartbeat to HEARTBEAT_URL (ADR-004 §2; both unset in development, where alerts are log lines), and relays the
// outbox: jobs queued by ctx.jobs.send in a committed transaction (ADR-002 §4). Each job attempt runs in one
// transaction with a Ctx for its principal (RAD-44 step 3). pg-boss's schema comes from the migrations (0001, RAD-25),
// so run `npm run db:migrate` first; without it the worker refuses to start ("pg-boss is not installed").
import type { JobDefinition } from '@radcore/lib-platform';
import {
  createAlerter, createDatabase, createJobQueue, mailerFor, passwordResetEmailJob, runJobs, startHeartbeat, startOutboxRelay,
  startProcess,
} from '@radcore/lib-platform/runtime';
import platform from './jobs/platform.ts';

// Each module's job file in ./jobs/ (ADR-001 §8) default-exports its defineJob list; spread them in here.
const jobs: readonly JobDefinition[] = [...platform];

await startProcess('worker', async ({ config, pool, log }) => {
  const alert = createAlerter(config.alertWebhookUrl, log);
  const db = createDatabase(pool);
  const queue = createJobQueue(config.database, log);
  // Jobs that need what only start-up has: the mailer and PUBLIC_ORIGIN, for links (RAD-32).
  const withMail = [...jobs, passwordResetEmailJob({ mailer: mailerFor(config, log), publicOrigin: config.publicOrigin })];
  const running = await runJobs(queue, withMail, log, { db, alert });
  // Stopped in this order: the relay finishes its pass while the queue can still take its jobs (ADR-002 §4).
  return [startHeartbeat(config.heartbeatUrl, log), startOutboxRelay(db, queue, log, { alert }), running];
});
