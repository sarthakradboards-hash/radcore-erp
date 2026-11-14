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
    await createAlerter(HOOK, log, { transport: t.transport })('job x failed after all its attempts (job 1)');
    expect(t.sent).toEqual([{ url: HOOK, method: 'POST', body: '{"text":"job x failed after all its attempts (job 1)"}' }]);
    expect(log.info).toHaveBeenCalledWith('outbound alert: POST https://hooks.example.in 200');
    expect(lines(log)).not.toContain('/services/');
  });

  it('logs a webhook that refuses or can\'t be reached, without throwing', async () => {
    const log = logger();
    await createAlerter(HOOK, log, { transport: fake(500).transport })('first');
    const down = fake();
    down.transport.send = async () => {
      throw new Error('connect ECONNREFUSED');
    };
    await createAlerter(HOOK, log, { transport: down.transport })('second');
    expect(log.error.mock.calls.map((c) => c[0])).toEqual(['ALERT: first',
      'alert: the webhook answered 500, so the alert above was not delivered', 'ALERT: second',
      'outbound alert: POST https://hooks.example.in the request failed',
      'alert: the webhook could not be reached, so the alert above was not delivered']);
    expect(lines(log)).not.toContain('/services/');
  });

  it('posts at most the burst per window, then one notice, and logs every alert', async () => {
    vi.useFakeTimers();
    const log = logger();
    const t = fake();
    const alert = createAlerter(HOOK, log, { transport: t.transport, burst: 2, windowMs: 60_000 });
    for (const n of [1, 2, 3, 4]) await alert(`job ${n} failed`);
    await vi.advanceTimersByTimeAsync(60_000);
    await alert('job 5 failed');
    expect(t.sent.map((s) => s.body)).toEqual(['job 1 failed', 'job 2 failed',
      'more than 2 alerts within 1 minutes: the rest until then are in the logs only', 'job 5 failed']
      .map((text) => JSON.stringify({ text })));
    expect(log.error.mock.calls.map((c) => c[0]).filter((m) => m.startsWith('ALERT: '))).toHaveLength(5);
  });

  // RC-158: repeats are keyed on what failed (a route template), counted in the shared store, never in this process.
  it('posts one alert per key while the store holds it, logs every one, and always posts an alert with no key', async () => {
    const log = logger();
    const t = fake();
    const seen = new Map<string, number>();
    const specs: unknown[] = [];
    const repeats = { end: async () => undefined, limiter: (spec: unknown) => {
      specs.push(spec);
      const hit = async (key: string) => {
        seen.set(key, (seen.get(key) ?? 0) + 1);
        return (seen.get(key) ?? 0) > 1 ? 1800 : 0;
      };
      return { hit, wait: hit, reset: async () => undefined };
    } };
    const alert = createAlerter(HOOK, log, { transport: t.transport, repeats });
    await alert('GET /notes/:id failed (request r1)', 'api GET /notes/:id server_error');
    await alert('GET /notes/:id failed (request r2)', 'api GET /notes/:id server_error');
    await alert('POST /notes failed (request r3)', 'api POST /notes server_error');
    await alert('job x failed');
    await alert('job x failed');
    expect(t.sent.map((s) => s.body)).toEqual(['GET /notes/:id failed (request r1)', 'POST /notes failed (request r3)',
      'job x failed', 'job x failed'].map((text) => JSON.stringify({ text })));
    expect(log.error.mock.calls.map((c) => c[0]).filter((m) => m.startsWith('ALERT: '))).toHaveLength(5);
    expect(log.info).toHaveBeenCalledWith('alert: posted already within the hour, so this one is in the logs only');
    // One hour per key, and a store that can't answer lets the alert through.
    expect(specs).toEqual([{ prefix: 'alert', points: 1, windowSeconds: 3600, blockSeconds: 0, failOpen: true }]);
  });

  it('counts no repeats without a webhook: the alert is a log line only', async () => {
    const hit = vi.fn(async () => 0);
    const repeats = { limiter: () => ({ hit, wait: hit, reset: async () => undefined }), end: async () => undefined };
    await createAlerter(null, logger(), { repeats })('x', 'k');
    expect(hit).not.toHaveBeenCalled();
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
