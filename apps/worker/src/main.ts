// The worker (ADR-001 §8, RAD-44): runs every job on pg-boss, raises dead-letter alerts to ALERT_WEBHOOK_URL and sends
// the heartbeat to HEARTBEAT_URL (ADR-004 §2; both unset in development, where alerts are log lines), and relays the
// outbox: jobs queued by ctx.jobs.send in a committed transaction (ADR-002 §4). pg-boss's
// schema comes from the migrations (0001, RAD-25), so run `npm run db:migrate` first; without it the worker refuses
// to start ("pg-boss is not installed").
import type { JobDefinition } from '@radcore/lib-platform';
import {
  createAlerter, createDatabase, createJobQueue, runJobs, startHeartbeat, startOutboxRelay, startProcess,
} from '@radcore/lib-platform/runtime';

// Each module's job file in ./jobs/ (ADR-001 §8) default-exports its defineJob list; spread them in here.
const jobs: readonly JobDefinition[] = [];

await startProcess('worker', async ({ config, pool, log }) => {
  const alert = createAlerter(config.alertWebhookUrl, log);
  const queue = createJobQueue(config.database, log);
  const running = await runJobs(queue, jobs, log, { alert });
  // Stopped in this order: the relay finishes its pass while the queue can still take its jobs (ADR-002 §4).
  return [startHeartbeat(config.heartbeatUrl, log), startOutboxRelay(createDatabase(pool), queue, log, { alert }), running];
});
