// RC-078, RC-079, RC-081 for the process lifecycle, with a stand-in for Node's process: no real signals or exits.
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { startProcess, type Stoppable } from './runtime.ts';

const env = () => ({
  NODE_ENV: 'development', APP_ENV: 'development', PUBLIC_ORIGIN: 'http://127.0.0.1:3000', TRUST_PROXY: '127.0.0.1',
  DATABASE_URL: 'postgres://radcore:Zq3vR8kLm2Xp9TfW4yHs@127.0.0.1:1/radcore', DB_POOL_MAX: '2', DB_POOL_WAIT_MS: '500',
  DB_STATEMENT_TIMEOUT_MS: '1000', DB_LOCK_TIMEOUT_MS: '1000', DB_IDLE_TX_TIMEOUT_MS: '1000', S3_REGION: 'us-east-1',
  S3_BUCKET_FILES: 'radcore-files', S3_ENDPOINT: 'http://127.0.0.1:8333', S3_ACCESS_KEY_ID: 'AKIA0000000000000000',
  S3_SECRET_ACCESS_KEY: 'k3N9vQ2xR7mT4pW8zY1s', SECRETS_LOCAL_KEY: Buffer.alloc(32, 7).toString('base64url'),
  TURNSTILE_SITE_KEY: '1x00000000000000000000AA', LOG_LEVEL: 'info',
});

// A stand-in process: `exited` resolves with the first exit code, so a test waits on the exit itself.
const fakeHost = (vars: Record<string, string | undefined> = env()) => {
  const events = new EventEmitter();
  const exits: number[] = [];
  let resolveExit: (code: number) => void = () => undefined;
  const exited = new Promise<number>((r) => { resolveExit = r; });
  const host = { env: vars, on: (e: string, fn: (arg: unknown) => void) => events.on(e, fn),
    exit: (code: number) => { exits.push(code); resolveExit(code); } };
  return { host, exits, exited, emit: (e: string, arg?: unknown) => events.emit(e, arg) };
};
const logger = () => ({ info: vi.fn<(m: string) => void>(), error: vi.fn<(m: string, e?: unknown) => void>() });
const stoppable = (name: string, order: string[], stop: () => Promise<void> = async () => undefined): Stoppable =>
  ({ name, stop: async () => { order.push(name); await stop(); } });

describe('startProcess', () => {
  it('refuses to start on bad settings, naming them, and exits 1 (RC-081)', async () => {
    const { host, exits } = fakeHost({ APP_ENV: 'development' });
    const log = logger();
    const start = vi.fn(async () => []);
    await startProcess('api', start, { host, log });
    expect(start).not.toHaveBeenCalled();
    expect(exits).toEqual([1]);
    expect(log.error.mock.calls[0]?.[0]).toContain('DATABASE_URL is required');
  });

  it('on SIGTERM stops what the app started, in order, then the pool, and exits 0 (RC-079)', async () => {
    const { host, exited, emit } = fakeHost();
    const order: string[] = [];
    const pools: { ended: boolean }[] = [];
    await startProcess('api', async ({ pool }) => {
      pools.push(pool);
      return [stoppable('http server', order), stoppable('jobs', order)];
    }, { host, log: logger() });
    emit('SIGTERM');
    expect(await exited).toBe(0);
    expect(order).toEqual(['http server', 'jobs']);
    expect(pools[0]?.ended).toBe(true);
  });

  it('stops once when signalled twice', async () => {
    const { host, exited, emit, exits } = fakeHost();
    const order: string[] = [];
    await startProcess('worker', async () => [stoppable('jobs', order)], { host, log: logger() });
    emit('SIGINT');
    emit('SIGTERM');
    await exited;
    expect(order).toEqual(['jobs']);
    expect(exits).toEqual([0]);
  });

  it('still stops the rest when one piece fails to stop, and exits 1', async () => {
    const { host, exited, emit } = fakeHost();
    const order: string[] = [];
    const log = logger();
    await startProcess('api', async () => [stoppable('http server', order, async () => { throw new Error('busy'); }),
      stoppable('jobs', order)], { host, log });
    emit('SIGTERM');
    expect(await exited).toBe(1);
    expect(order).toEqual(['http server', 'jobs']);
    expect(log.error).toHaveBeenCalledWith('api: http server did not stop cleanly', expect.any(Error));
  });

  it('exits 1 when stopping takes longer than the grace period', async () => {
    vi.useFakeTimers();
    try {
      const { host, exited, emit } = fakeHost();
      await startProcess('api', async () => [{ name: 'stuck', stop: () => new Promise<void>(() => undefined) }],
        { host, log: logger(), graceMs: 1000 });
      emit('SIGTERM');
      await vi.advanceTimersByTimeAsync(1000);
      expect(await exited).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps running after an unhandled rejection, and logs it (RC-078)', async () => {
    const { host, emit, exits } = fakeHost();
    const log = logger();
    await startProcess('api', async () => [], { host, log });
    emit('unhandledRejection', new Error('stray'));
    expect(exits).toEqual([]);
    expect(log.error).toHaveBeenCalledWith('api: unhandled rejection, still running', expect.any(Error));
  });

  it('stops cleanly and exits 1 after an uncaught exception, so the container restarts', async () => {
    const { host, exited, emit } = fakeHost();
    const order: string[] = [];
    await startProcess('api', async () => [stoppable('http server', order)], { host, log: logger() });
    emit('uncaughtException', new Error('broken state'));
    expect(await exited).toBe(1);
    expect(order).toEqual(['http server']);
  });

  it('exits 1 when the app fails to start', async () => {
    const { host, exited } = fakeHost();
    await startProcess('api', async () => { throw new Error('port in use'); }, { host, log: logger() });
    expect(await exited).toBe(1);
  });
});
