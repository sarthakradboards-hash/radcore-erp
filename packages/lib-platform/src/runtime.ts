// The runtime entry: starts and stops the api and worker processes. Only apps/api and apps/worker import it (L7).
// RAD-28: settings are checked before anything starts (RC-081), a stray error or a lost database connection doesn't
// end the process (RC-078), and a stop signal lets work in flight finish before exit (RC-079).
import { createAlerter, type Alerter } from './alerts.ts';
import { ConfigError, loadConfig, type Config, type ProcessName } from './config.ts';
import { createPool, type JobQueue, type Pool } from './db/client.ts';
import type { JobDefinition, QueueSettings } from './jobs.ts';
import type { Logger } from './log.ts';
import { createLog } from './log/logger.ts';

export { createAlerter, startHeartbeat, type Alerter } from './alerts.ts';
export { newPasswordCheckFor } from './auth/new-password.ts';
export { createDatabase, createHealthCheck, createJobQueue } from './db/client.ts';
export { runInTransaction } from './db/transaction.ts';
export { relayOutbox, startOutboxRelay } from './outbox.ts';
export type { Logger } from './log.ts';

type QueueOptions = Omit<QueueSettings, 'deadLetter'> & { deadLetter?: string };
// Create the queue if it's missing, then bring its options up to date. pg-boss's create_queue is INSERT … ON CONFLICT
// DO NOTHING under an advisory lock, so two workers starting together both succeed. updateQueue can't change a
// policy, so a changed one is refused rather than silently kept.
const ensureQueue = async (queue: JobQueue, name: string, { policy, retries, ...rest }: QueueOptions): Promise<void> => {
  const options = { ...rest, retryLimit: retries };
  await queue.createQueue(name, { policy, ...options });
  const stored = (await queue.getQueue(name))?.policy;
  if (stored !== policy) {
    throw new Error(`job queue ${name} has policy ${String(stored)} but the job now declares ${policy}; `
      + 'a policy change needs a new queue name');
  }
  await queue.updateQueue(name, options);
};

/**
 * RAD-44 (RC-082): start the queue and run every job: its queue with its retries, timeout, overlap guard and clean-up,
 * its dead-letter queue with the alert, and its schedule. Returns how to stop: no new work, attempts in flight finish.
 */
export async function runJobs(queue: JobQueue, jobs: readonly JobDefinition[], log: Logger,
  { alert = createAlerter(null, log), stopTimeoutMs = 20_000 }: { alert?: Alerter; stopTimeoutMs?: number } = {},
): Promise<Stoppable> {
  await queue.start();
  for (const job of jobs) {
    const { deadLetter, ...settings } = job.settings;
    // Dead letters keep the job's clean-up, so a deleteOnComplete payload doesn't linger there either.
    await ensureQueue(queue, deadLetter, { ...settings, policy: 'standard', retries: 0 });
    await ensureQueue(queue, job.name, job.settings);
    await queue.work(job.name, async ([attempt]) => {
      if (attempt === undefined) return;
      await job.handle(attempt.data, attempt.id);
      // pg-boss then marks the job complete with an update that finds no row; the payload is already gone.
      if (job.deleteOnComplete) await queue.deleteJob(job.name, attempt.id);
    });
    await queue.work(deadLetter, async ([dead]) => {
      if (dead === undefined) return;
      // The job's name and id, never its payload.
      await alert(`job ${job.name} failed after all its attempts (job ${dead.id})`);
      if (job.deleteOnComplete) await queue.deleteJob(deadLetter, dead.id);
    });
    if (job.every !== null) await queue.schedule(job.name, job.every);
  }
  log.info(`job queue: running ${jobs.length} job(s)`);
  return { name: 'job queue', stop: () => queue.stop({ graceful: true, timeout: stopTimeoutMs }) };
}

/** Something the process stops on the way out, in the order the app returns them; the pool is closed last. */
export type Stoppable = { name: string; stop(): Promise<void> };
/** What startProcess needs from Node's `process`; tests pass a stand-in. */
export type Host = {
  env: Record<string, string | undefined>;
  on(event: string, listener: (arg: unknown) => void): unknown;
  exit(code: number): void;
};
/** ADR-004 §2: both processes exit within 30 seconds of a stop signal; compose kills at 30. */
export const STOP_GRACE_MS = 25_000;

type Start = (deps: { config: Config; pool: Pool; log: Logger }) => Promise<Stoppable[]>;
const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

/** Check the settings, open the pool, run `start`, and stop everything cleanly on SIGTERM or SIGINT. */
export async function startProcess(name: ProcessName, start: Start,
  { host = process, log: given, graceMs = STOP_GRACE_MS }: { host?: Host; log?: Logger; graceMs?: number } = {},
): Promise<void> {
  // The logger is needed before the settings are checked, to report them; an unknown LOG_LEVEL logs at info and
  // loadConfig then refuses it.
  const log = given ?? createLog({ level: LOG_LEVELS.find((l) => l === host.env['LOG_LEVEL']) ?? 'info', service: name });
  let config: Config;
  try {
    config = loadConfig(host.env, name);
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    log.error(err.message);
    host.exit(1);
    return;
  }
  const pool = createPool(config.database, log);
  const stops: Stoppable[] = [];
  let stopping = false;

  const stop = async (code: number): Promise<void> => {
    if (stopping) return;
    stopping = true;
    log.info(`${name}: stopping`);
    const deadline = setTimeout(() => {
      log.error(`${name}: still stopping after ${graceMs} ms, exiting now`);
      host.exit(1);
    }, graceMs);
    deadline.unref();
    let clean = true;
    for (const s of [...stops, { name: 'database pool', stop: () => pool.end() }]) {
      try {
        await s.stop();
      } catch (err) {
        clean = false;
        log.error(`${name}: ${s.name} did not stop cleanly`, err);
      }
    }
    clearTimeout(deadline);
    host.exit(clean ? code : 1);
  };

  host.on('SIGTERM', () => void stop(0));
  host.on('SIGINT', () => void stop(0));
  // A promise nobody awaited failed: one piece of work is lost, the process and its other work carry on.
  host.on('unhandledRejection', (reason) => log.error(`${name}: unhandled rejection, still running`, reason));
  // A throw nothing caught leaves state unknown: stop cleanly and exit 1, so the container restarts.
  host.on('uncaughtException', (err) => {
    log.error(`${name}: uncaught exception, stopping`, err);
    void stop(1);
  });

  try {
    stops.push(...(await start({ config, pool, log })));
  } catch (err) {
    log.error(`${name}: failed to start`, err);
    await stop(1);
    return;
  }
  log.info(`${name}: started (APP_ENV ${config.appEnv})`);
}
