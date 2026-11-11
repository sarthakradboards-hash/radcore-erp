// RAD-31: GET /admin/security-events, mounted from apps/api/src/routes/platform.ts, over real HTTP on PostgreSQL as the
// app login. audit:read reads the list; anyone else is refused before the transaction, and a signed-out caller is 401.
// Here in tools/ because server code may not call fetch (ADR-002 L8).
import { randomUUID } from 'node:crypto';
import { loadConfig, type Principal } from '@radcore/lib-platform';
import { createDatabase } from '@radcore/lib-platform/runtime';
import { testPassword, testSettings } from '@radcore/test-helpers';
import pg from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createApp, listen } from '../apps/api/src/app.ts';
import platform from '../apps/api/src/routes/platform.ts';

const url = process.env['TEST_DATABASE_URL'];
const config = () => loadConfig(testSettings({ DATABASE_URL: `postgres://radcore:${testPassword()}@127.0.0.1:1/radcore` }), 'api');
const logger = () => ({ info: vi.fn<(m: string) => void>(), error: vi.fn<(m: string, e?: unknown) => void>() });
const as = (permissions: string[]): Principal => ({ kind: 'user', userId: randomUUID(), permissions });

it('mounts listSecurityEvents from the platform route file', () => {
  expect(platform.map((r) => `${r.contract.method} ${r.contract.path}`)).toEqual(['GET /admin/security-events']);
});

describe.skipIf(!url)('GET /admin/security-events', () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const db = createDatabase(pool);
  afterAll(async () => { await pool.end(); });

  async function get(principal: Principal | null, input: object) {
    const server = await listen(createApp(config(), logger(), { db, authenticate: async () => principal, routes: platform }),
      0, '127.0.0.1');
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/admin/security-events?input=${encodeURIComponent(JSON.stringify(input))}`);
      return { status: res.status, body: (await res.json()) as { items?: unknown[]; next?: unknown; code?: string } };
    } finally {
      await server.stop();
    }
  }
  // An account with no events, so the answer is the same however many other tests wrote.
  const input = { filter: { occurred: { from: '2026-11-01', to: '2026-11-30' }, principal: randomUUID() }, limit: 10 };

  it('lists for audit:read, and refuses anyone else and a signed-out caller', async () => {
    expect(await get(as(['audit:read']), input)).toEqual({ status: 200, body: { items: [], next: null } });
    expect((await get(as(['session:read']), input)).status).toBe(403);
    expect((await get(null, input)).status).toBe(401);
  });

  it('answers range_too_long past 92 days', async () => {
    const long = { ...input, filter: { ...input.filter, occurred: { from: '2026-01-01', to: '2026-04-03' } } };
    expect(await get(as(['audit:read']), long)).toMatchObject({ status: 422, body: { code: 'range_too_long' } });
  });
});
