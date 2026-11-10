// RAD-44 step 4: the dead-letter alert and the heartbeat go out through the outbound client, logging only the origin
// of their secret URLs (ADR-004 §5), and a failed send never throws.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Transport } from './index.ts';
import { createAlerter, startHeartbeat } from './alerts.ts';

// Built at run time: the path stands in for the token a real webhook URL carries.
const HOOK = `https://hooks.example.in/services/${'t0k'.repeat(8)}`;
const BEAT = `https://monitor.example.in/ping/${'b3at'.repeat(6)}`;
const logger = () => ({ info: vi.fn<(m: string) => void>(), error: vi.fn<(m: string, e?: unknown) => void>() });
const fake = (status = 200) => {
  const sent: { url: string; method: string; body: unknown }[] = [];
  const transport: Transport = {
    resolve: async () => [{ address: '157.240.1.1', family: 4 }],
    send: vi.fn<Transport['send']>(async (url, _to, init) => {
      sent.push({ url: url.href, method: init.method, body: init.body });
      return { status, headers: {}, body: Buffer.alloc(0) };
    }),
  };
  return { transport, sent };
};
const lines = (log: ReturnType<typeof logger>) => [...log.info.mock.calls, ...log.error.mock.calls].map((c) => c[0]).join('\n');

afterEach(() => {
  vi.useRealTimers();
});

describe('createAlerter', () => {
  it('logs the alert, and with no webhook set sends nothing', async () => {
    const log = logger();
    await createAlerter(null, log)('job x failed');
    expect(log.error).toHaveBeenCalledWith('ALERT: job x failed');
  });

  it('logs the alert and posts it to the webhook, logging the origin only', async () => {
    const log = logger();
    const t = fake();
    await createAlerter(HOOK, log, t.transport)('job x failed after all its attempts (job 1)');
    expect(t.sent).toEqual([{ url: HOOK, method: 'POST', body: '{"text":"job x failed after all its attempts (job 1)"}' }]);
    expect(log.info).toHaveBeenCalledWith('outbound alert: POST https://hooks.example.in 200');
    expect(lines(log)).not.toContain('/services/');
  });

  it('logs a webhook that refuses or can\'t be reached, without throwing', async () => {
    const log = logger();
    await createAlerter(HOOK, log, fake(500).transport)('first');
    const down = fake();
    down.transport.send = async () => {
      throw new Error('connect ECONNREFUSED');
    };
    await createAlerter(HOOK, log, down.transport)('second');
    expect(log.error.mock.calls.map((c) => c[0])).toEqual(['ALERT: first',
      'alert: the webhook answered 500, so the alert above was not delivered', 'ALERT: second',
      'outbound alert: POST https://hooks.example.in the request failed',
      'alert: the webhook could not be reached, so the alert above was not delivered']);
    expect(lines(log)).not.toContain('/services/');
  });
});

describe('startHeartbeat', () => {
  it('pings now and every interval until stopped, logging the origin only', async () => {
    vi.useFakeTimers();
    const log = logger();
    const t = fake();
    const beat = startHeartbeat(BEAT, log, { everyMs: 1000, transport: t.transport });
    await vi.advanceTimersByTimeAsync(2500);
    await beat.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.sent.map((s) => [s.method, s.url])).toEqual([['GET', BEAT], ['GET', BEAT], ['GET', BEAT]]);
    expect(lines(log)).not.toContain('/ping/');
  });

  it('logs a missed ping and keeps going', async () => {
    vi.useFakeTimers();
    const log = logger();
    const beat = startHeartbeat(BEAT, log, { everyMs: 1000, transport: fake(503).transport });
    await vi.advanceTimersByTimeAsync(1500);
    await beat.stop();
    expect(log.error.mock.calls.map((c) => c[0])).toEqual(['heartbeat: the monitor answered 503',
      'heartbeat: the monitor answered 503']);
  });

  it('does nothing without HEARTBEAT_URL', async () => {
    const beat = startHeartbeat(null, logger());
    await expect(beat.stop()).resolves.toBeUndefined();
  });
});
