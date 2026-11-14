// RAD-39 (ADR-001 §6 and §7a, ADR-003, RC-088, RC-194) over real HTTP on PostgreSQL 16: the request rate limits.
// A public or link route counts per client address for its class, before the principal, the token or the body; a
// signed-in route counts per person. The counts live in the shared store, so a second server sees the first's (RC-088),
// and an unreachable store refuses (fails closed). Each test uses addresses and people of its own, so the shuffled order
// doesn't matter. The test TRUST_PROXY is 127.0.0.1, so X-Forwarded-For names the client, as the proxy would.
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineContract } from '@radcore/lib-common';
import { ADDRESS_LIMITS, createRequestGuards, defineRoute, loadConfig, PERSON_LIMIT, type Principal, type RequestGuards }
  from '@radcore/lib-platform';
import { linkToken } from '@radcore/lib-platform/contract';
import { createDatabase } from '@radcore/lib-platform/runtime';
import { testPassword, testRateLimitKey, testSettings } from '@radcore/test-helpers';
import pg from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createApp, listen } from '../apps/api/src/app.ts';
import { createLimiterStore } from '../packages/lib-platform/src/db/client.ts';

const url = process.env['TEST_DATABASE_URL'];
// Collecting a skipped suite still builds its store; a pool connects only when used, so this is never reached.
const NO_DATABASE = 'postgres://unused@127.0.0.1:1/unused';
const config = (u = NO_DATABASE) => {
  const parsed = new URL(u);
  parsed.password = testPassword();
  return loadConfig(testSettings({ DATABASE_URL: parsed.toString() }), 'api');
};
const logger = () => ({ info: vi.fn<(m: string) => void>(), error: vi.fn<(m: string, e?: unknown) => void>() });
const READ = { readOnly: true, isolation: 'read committed' } as const;
// A client address of the documentation range, new per call, so no two tests (or runs) share a count.
const address = () => `2001:db8::${randomBytes(2).toString('hex')}:${randomBytes(2).toString('hex')}`;

const ping = defineContract({ method: 'GET', path: '/rl/ping', auth: 'public', rateLimit: 'password-reset', perm: null, tx: READ,
  input: z.object({}), output: z.object({}) });
const mine = defineContract({ method: 'GET', path: '/rl/mine', auth: 'session', perm: 'notes:read', tx: READ,
  input: z.object({}), output: z.object({}) });
const view = defineContract({ method: 'POST', path: '/rl/l/view', auth: 'link', action: 'sales.invoice_view',
  rateLimit: 'token-link', perm: null, tx: READ, input: z.object({ token: linkToken() }), output: z.object({}) });

describe.skipIf(!url)('the request rate limits', () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const db = createDatabase(pool);
  const store = createLimiterStore(config(url).database, logger(), testRateLimitKey());
  // A second server's store: the same database and RATE_LIMIT_KEY, its own process memory (none).
  const otherServer = createLimiterStore(config(url).database, logger(), testRateLimitKey());
  const elsewhere = createRequestGuards(otherServer);
  afterAll(async () => {
    await Promise.all([store.end(), otherServer.end()]);
    await pool.end();
  });

  const service = vi.fn(async () => ({}));
  async function serve(guards: RequestGuards, person: Principal | null,
    fn: (get: (path: string, from: string) => Promise<Response>, post: (path: string, from: string) => Promise<Response>) => Promise<void>) {
    // The real database: /health asks it.
    const app = createApp(config(url), logger(), { db, guards, authenticate: async () => person,
      routes: [defineRoute(ping, service), defineRoute(mine, service), defineRoute(view, service)] });
    const server = await listen(app, 0, '127.0.0.1');
    const base = `http://127.0.0.1:${server.port}`;
    try {
      await fn((path, from) => fetch(`${base}${path}`, { headers: { 'x-forwarded-for': from } }),
        (path, from) => fetch(`${base}${path}`, { method: 'POST', body: JSON.stringify({ token: 'x'.repeat(43) }),
          headers: { 'content-type': 'application/json', origin: config().publicOrigin, 'x-forwarded-for': from } }));
    } finally {
      await server.stop();
    }
  }
  const spend = async (n: number, hit: () => Promise<number>) => {
    for (let i = 0; i < n; i += 1) expect(await hit()).toBe(0);
  };
  const refusal = async (res: Response) => ({ status: res.status, retryAfter: Number(res.headers.get('retry-after')),
    code: ((await res.json()) as { code: string }).code });

  // RC-088: the other server's requests count here: the count is in the store, not in this process.
  it("limits a public route per address, counting another server's requests, and leaves other addresses alone", async () => {
    const { points, blockSeconds } = ADDRESS_LIMITS['password-reset'];
    const [mineAddress, theirs] = [address(), address()];
    await spend(points - 1, () => elsewhere.address('password-reset', mineAddress));
    await serve(createRequestGuards(store), null, async (get) => {
      expect((await get('/rl/ping', mineAddress)).status).toBe(200);
      const refused = await refusal(await get('/rl/ping', mineAddress));
      expect(refused).toMatchObject({ status: 429, code: 'rate_limited' });
      expect(refused.retryAfter).toBeGreaterThan(blockSeconds - 10);
      expect(refused.retryAfter).toBeLessThanOrEqual(blockSeconds);
      expect((await get('/rl/ping', theirs)).status).toBe(200);
    });
  });

  // RC-194: one person flooding the API is held, wherever they connect from; another person isn't.
  it('limits a signed-in person over every route, whatever their address, and not another person', async () => {
    const [x, y] = [randomUUID(), randomUUID()];
    await spend(PERSON_LIMIT.points - 1, () => elsewhere.person(x));
    const as = (userId: string): Principal => ({ kind: 'user', userId, permissions: ['notes:read'] });
    await serve(createRequestGuards(store), as(x), async (get) => {
      expect((await get('/rl/mine', address())).status).toBe(200);
      expect(await refusal(await get('/rl/mine', address()))).toMatchObject({ status: 429, code: 'rate_limited' });
    });
    await serve(createRequestGuards(store), as(y), async (get) => {
      expect((await get('/rl/mine', address())).status).toBe(200);
    });
  });

  // The architect: no link route goes live unlimited. The count comes before the token is even looked at.
  it('limits a link route per address before its token is checked', async () => {
    const from = address();
    await spend(ADDRESS_LIMITS['token-link'].points, () => elsewhere.address('token-link', from));
    await serve(createRequestGuards(store), null, async (_get, post) => {
      expect(await refusal(await post('/rl/l/view', from))).toMatchObject({ status: 429, code: 'rate_limited' });
      // Another address gets past the limit to the token, which is no link's.
      expect((await post('/rl/l/view', address())).status).not.toBe(429);
    });
  });

  // ADR-004 §2: the health check touches the database, so it's limited per address too.
  it('limits /health per address', async () => {
    const from = address();
    await spend(ADDRESS_LIMITS.health.points - 1, () => elsewhere.address('health', from));
    await serve(createRequestGuards(store), null, async (get) => {
      expect((await get('/health', from)).status).toBe(200);
      const held = await get('/health', from);
      expect([held.status, await held.json()]).toEqual([429, { ok: false }]);
      expect(Number(held.headers.get('retry-after'))).toBeGreaterThan(0);
      expect((await get('/health', address())).status).toBe(200);
    });
  });

  // ADR-003: when the store can't be reached, every limited request is refused for the whole block.
  it('fails closed: with the store down, a public route and a signed-in one are refused', async () => {
    const down = createLimiterStore(config(`postgres://radcore@127.0.0.1:1/radcore`).database, logger(), testRateLimitKey());
    try {
      await serve(createRequestGuards(down), { kind: 'user', userId: randomUUID(), permissions: ['notes:read'] }, async (get) => {
        expect(await refusal(await get('/rl/ping', address()))).toEqual({ status: 429, code: 'rate_limited',
          retryAfter: ADDRESS_LIMITS['password-reset'].blockSeconds });
        expect(await refusal(await get('/rl/mine', address()))).toEqual({ status: 429, code: 'rate_limited',
          retryAfter: PERSON_LIMIT.blockSeconds });
      });
    } finally {
      await down.end();
    }
  });
});

it("refuses to mount a public or link route whose class the guards don't count", () => {
  const db = createDatabase(new pg.Pool());
  const odd = defineContract({ method: 'GET', path: '/rl/odd', auth: 'public', rateLimit: 'no-such-class', perm: null, tx: READ,
    input: z.object({}), output: z.object({}) });
  const oddLink = defineContract({ method: 'POST', path: '/rl/l/odd', auth: 'link', action: 'sales.invoice_view',
    rateLimit: 'no-such-class', perm: null, tx: READ, input: z.object({ token: linkToken() }), output: z.object({}) });
  for (const contract of [odd, oddLink]) {
    expect(() => createApp(config(), logger(), { db, authenticate: async () => null, routes: [defineRoute(contract, async () => ({}))] }))
      .toThrow(/isn't a rate-limit class/);
  }
});

// The api builds its guards on createAuth's store and hands them to the handler; a test of the handler alone can't see
// whether main.ts does, so this reads it.
it('the api passes the guards to the handler', () => {
  expect(readFileSync('apps/api/src/main.ts', 'utf8')).toMatch(/\bguards: auth\.guards\b/);
});
