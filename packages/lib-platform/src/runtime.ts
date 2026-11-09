// The runtime entry: starts and stops the api and worker processes. Only apps/api and apps/worker import it (L7).
// RAD-28: settings are checked before anything starts (RC-081), a stray error or a lost database connection doesn't
// end the process (RC-078), and a stop signal lets work in flight finish before exit (RC-079).
import { ConfigError, loadConfig, type Config, type ProcessName } from './config.ts';
import { createPool, type Pool } from './db/client.ts';
import { consoleLogger, type Logger } from './log.ts';

export { createHealthCheck } from './db/client.ts';
export type { Logger } from './log.ts';

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

/** Check the settings, open the pool, run `start`, and stop everything cleanly on SIGTERM or SIGINT. */
export async function startProcess(name: ProcessName, start: Start,
  { host = process, log = consoleLogger, graceMs = STOP_GRACE_MS }: { host?: Host; log?: Logger; graceMs?: number } = {},
): Promise<void> {
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
