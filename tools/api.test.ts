// RAD-28 over real HTTP: the api's health check touches the database, a stop lets requests in flight finish
// (RC-079), and a stray error in a route answers 500 without ending the server (RC-078). Here in tools/ because
// server code may not call fetch (ADR-002 L8).
import { loadConfig } from '@radcore/lib-platform';
import { testPassword, testSettings } from '@radcore/test-helpers';
import { describe, expect, it, vi } from 'vitest';
import { createApp, listen } from '../apps/api/src/app.ts';

const config = (databaseUrl: string) => loadConfig(testSettings({ DATABASE_URL: databaseUrl }), 'api');
const UNREACHABLE = `postgres://radcore:${testPassword()}@127.0.0.1:1/radcore`;
const logger = () => ({ info: vi.fn<(m: string) => void>(), error: vi.fn<(m: string, e?: unknown) => void>() });

it('health answers 503 when the database does not', async () => {
  const log = logger();
  const server = await listen(createApp(config(UNREACHABLE), log), 0, '127.0.0.1');
  try {
    const res = await fetch(`http://127.0.0.1:${server.port}/health`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false });
    expect(log.error).toHaveBeenCalledWith('health: the database did not answer', expect.any(Error));
  } finally {
    await server.stop();
  }
});

const url = process.env['TEST_DATABASE_URL'];
describe.skipIf(!url)('with the test database', () => {
  it('health answers 200 when the database does', async () => {
    const test = new URL(url ?? '');
    // The test database's admin URL has no password; config wants one, and trust auth ignores it.
    test.password = testPassword();
    const server = await listen(createApp(config(test.toString()), logger()), 0, '127.0.0.1');
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/health`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    } finally {
      await server.stop();
    }
  });
});

it('a stop lets the request in flight finish, then refuses new ones (RC-079)', async () => {
  const app = createApp(config(UNREACHABLE), logger());
  let arrive: () => void = () => undefined;
  let release: () => void = () => undefined;
  const arrived = new Promise<void>((r) => { arrive = r; });
  const gate = new Promise<void>((r) => { release = r; });
  app.get('/slow', async (_req, res) => {
    arrive();
    await gate;
    res.json({ done: true });
  });
  const server = await listen(app, 0, '127.0.0.1');
  const inFlight = fetch(`http://127.0.0.1:${server.port}/slow`);
  await arrived;
  const states: string[] = [];
  const stopped = server.stop().then(() => { states.push('stopped'); });
  await Promise.resolve();
  states.push('released');
  release();
  const res = await inFlight;
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ done: true });
  await stopped;
  expect(states).toEqual(['released', 'stopped']);
  await expect(fetch(`http://127.0.0.1:${server.port}/health`)).rejects.toThrow();
});

it('a stray error in a route answers 500 and the server keeps serving (RC-078)', async () => {
  const app = createApp(config(UNREACHABLE), logger());
  app.get('/boom', async () => {
    throw new Error('stray');
  });
  const server = await listen(app, 0, '127.0.0.1');
  try {
    expect((await fetch(`http://127.0.0.1:${server.port}/boom`)).status).toBe(500);
    expect((await fetch(`http://127.0.0.1:${server.port}/health`)).status).toBe(503);
  } finally {
    await server.stop();
  }
});
