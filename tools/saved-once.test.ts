// RAD-27 (M1-09, ADR-001 §6, §7a, RC-132): saved-once through the generic handler, over real HTTP, on a real
// PostgreSQL. A write sent twice with the same key runs once and replays its answer, even when both arrive together;
// the same key with another body is refused; a write that rolled back leaves its key free; a key is one principal's.
// Here in tools/ because it calls the API with fetch (ADR-002 L8). The routes' table lives in a schema of its own.
import { randomBytes, randomUUID } from 'node:crypto';
import { defineContract } from '@radcore/lib-common';
import { AppError, loadConfig, type Principal } from '@radcore/lib-platform';
import { testPassword, testSettings } from '@radcore/test-helpers';
import { integer, pgSchema, text, uuid } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createApp, listen } from '../apps/api/src/app.ts';
import { defineRoute } from '../apps/api/src/http/route.ts';
import { moduleTx } from '../packages/db/src/module-tx.ts';
import { createDatabase } from '../packages/lib-platform/src/db/client.ts';

// The owner login: this file makes a schema and a table of its own (RAD-24).
const url = process.env['TEST_DATABASE_OWNER_URL'];
const fixture = pgSchema(`saved_once_${randomBytes(6).toString('hex')}`);
const orders = fixture.table('orders', { id: uuid().primaryKey().defaultRandom(), item: text().notNull(), qty: integer().notNull() });
const ordersTx = moduleTx({ orders });

const write = { readOnly: false, isolation: 'read committed' } as const;
const placeOrder = defineContract({ method: 'POST', path: '/orders', auth: 'session', perm: 'orders:write', tx: write,
  input: z.object({ item: z.string().min(1), qty: z.number().int() }), output: z.object({ id: z.string(), n: z.number() }),
  errors: ['out_of_stock'] });
const countOrders = defineContract({ method: 'GET', path: '/orders/count', auth: 'session', perm: 'orders:write',
  tx: { readOnly: true, isolation: 'read committed' }, input: z.object({}), output: z.object({ n: z.number() }) });

// Two routes on lib-platform's fixed lists (ADR-001 §7a), at their real paths, since the handler refuses others.
const enrol = defineContract({ method: 'POST', path: '/sign-in/second-factor/enrolment', auth: 'session', perm: 'orders:write',
  storesAnswer: false, tx: write, input: z.object({}), output: z.object({ secret: z.string() }) });
const signOut = defineContract({ method: 'POST', path: '/sign-out', auth: 'session', perm: 'orders:write',
  idempotency: 'exempt', tx: write, input: z.object({}), output: z.object({ n: z.number() }) });

const asUser = (userId: string): Principal => ({ kind: 'user', userId, permissions: ['orders:write'] });
const logger = () => ({ info: vi.fn<(m: string) => void>(), error: vi.fn<(m: string, e?: unknown) => void>() });
const config = () => {
  const u = new URL(url ?? '');
  u.password = testPassword();
  return loadConfig(testSettings({ DATABASE_URL: u.toString() }), 'api');
};

// Every write comes from the app's own origin (ADR-001 §7a, RAD-39), as the browser sends it.
const ORIGIN = () => config().publicOrigin;

describe.skipIf(!url)('saved-once through the generic handler', () => {
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  const db = createDatabase(pool, { orders });

  beforeAll(async () => {
    await pool.query(`create schema ${fixture.schemaName}`);
    await pool.query(`create table ${fixture.schemaName}.orders (id uuid primary key default gen_random_uuid(),
      item text not null, qty int not null)`);
  });
  afterAll(async () => {
    await pool.query(`drop schema ${fixture.schemaName} cascade`);
    await pool.end();
  });

  // A server whose place-order service runs `before` first (a gate or a refusal), then inserts and answers with a
  // number that changes on every run, so a replay is told apart from a second run. The x-user header picks who.
  async function serve(fn: (base: string, runs: () => number) => Promise<void>,
    before: (qty: number) => Promise<void> = async () => undefined) {
    let runs = 0;
    const app = createApp(config(), logger(), {
      db, authenticate: async (req) => asUser(req.get('x-user') ?? 'u-1'), routes: [
        defineRoute(placeOrder, async (ctx, input) => {
          runs += 1;
          await before(input.qty);
          const [row] = await ordersTx(ctx).insert(orders).values(input).returning({ id: orders.id });
          return { id: row?.id ?? '', n: runs };
        }),
        defineRoute(countOrders, async (ctx) => ({ n: (await ordersTx(ctx).select({ id: orders.id }).from(orders)).length })),
        defineRoute(enrol, async () => {
          runs += 1;
          return { secret: `otpauth-secret-${runs}` };
        }),
        defineRoute(signOut, async () => {
          runs += 1;
          return { n: runs };
        }),
      ] });
    const server = await listen(app, 0, '127.0.0.1');
    try {
      await fn(`http://127.0.0.1:${server.port}`, () => runs);
    } finally {
      await server.stop();
    }
  }
  const order = async (base: string, key: string, body: unknown, user = 'u-1') => {
    const res = await fetch(`${base}/orders`, { method: 'POST', body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', 'idempotency-key': key, 'x-user': user, origin: ORIGIN() } });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };
  const rowsFor = async (key: string) => (await pool.query<{ principal: string; route: string; kept: boolean; hours: number }>(
    `select principal, route, kept, round(extract(epoch from expires_at - created_at) / 3600)::int as hours
     from radcore.saved_once where key = $1`, [key])).rows;

  it('runs a write once and replays its answer to a second request with the same key and body (RC-132)', async () => {
    await serve(async (base, runs) => {
      const key = randomUUID();
      const first = await order(base, key, { item: 'tea', qty: 1 });
      const again = await order(base, key, { item: 'tea', qty: 1 });
      expect(first.status).toBe(200);
      expect(again).toEqual(first);
      expect(runs()).toBe(1);
      expect(await rowsFor(key)).toEqual([{ principal: 'user:u-1', route: 'POST /orders', kept: true, hours: 48 }]);
    });
  });

  it('refuses the same key with a different body, and runs nothing (the ticket\'s proof)', async () => {
    await serve(async (base, runs) => {
      const key = randomUUID();
      await order(base, key, { item: 'tea', qty: 1 });
      const other = await order(base, key, { item: 'tea', qty: 2 });
      expect(other.status).toBe(409);
      expect(other.body['code']).toBe('idempotency_mismatch');
      expect(runs()).toBe(1);
    });
  });

  it('runs both requests\' work only once when they arrive together', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    await serve(async (base, runs) => {
      const key = randomUUID();
      const first = order(base, key, { item: 'chai', qty: 1 });
      // The first holds its claim at the gate; the second waits on the same key in the database.
      await vi.waitFor(() => expect(runs()).toBe(1));
      const second = order(base, key, { item: 'chai', qty: 1 });
      release();
      const [a, b] = await Promise.all([first, second]);
      expect(a.status).toBe(200);
      expect(b).toEqual(a);
      expect(runs()).toBe(1);
    }, async () => gate);
  });

  it('leaves the key free when the write rolled back, so the retry runs', async () => {
    await serve(async (base, runs) => {
      const key = randomUUID();
      const refused = await order(base, key, { item: 'tea', qty: -1 });
      expect(refused.status).toBe(422);
      expect(await rowsFor(key)).toEqual([]);
      const retried = await order(base, key, { item: 'tea', qty: -1 });
      expect(retried.status).toBe(422);
      expect(runs()).toBe(2);
    }, async (qty) => {
      if (qty < 0) throw new AppError('out_of_stock', 'None left');
    });
  });

  it('scopes a key to its principal, so another person\'s identical key runs their own write', async () => {
    await serve(async (base, runs) => {
      const key = randomUUID();
      const mine = await order(base, key, { item: 'tea', qty: 1 }, 'u-1');
      const theirs = await order(base, key, { item: 'tea', qty: 1 }, 'u-2');
      expect(theirs.status).toBe(200);
      expect(theirs.body['id']).not.toBe(mine.body['id']);
      expect(runs()).toBe(2);
    });
  });

  it('claims the key of a route whose answer holds a secret, keeps no answer, and refuses a repeat (RAD-32)', async () => {
    await serve(async (base, runs) => {
      const key = randomUUID();
      const send = () => fetch(`${base}/sign-in/second-factor/enrolment`, { method: 'POST', body: '{}',
        headers: { 'content-type': 'application/json', 'idempotency-key': key, origin: ORIGIN() } });
      const first = await send();
      expect(await first.json()).toEqual({ secret: 'otpauth-secret-1' });
      const again = await send();
      expect(again.status).toBe(409);
      expect((await again.json() as { code: string }).code).toBe('answer_not_kept');
      expect(runs()).toBe(1);
      const [row] = (await pool.query<{ kept: boolean; answer: unknown }>(
        'select kept, answer from radcore.saved_once where key = $1', [key])).rows;
      expect(row).toEqual({ kept: false, answer: null });
    });
  });

  it('claims nothing for a key-exempt route, which needs no key and runs each time', async () => {
    await serve(async (base, runs) => {
      const send = () => fetch(`${base}/sign-out`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json', origin: ORIGIN() } });
      expect([(await send()).status, (await send()).status]).toEqual([200, 200]);
      expect(runs()).toBe(2);
      const [{ n } = { n: -1 }] = (await pool.query<{ n: number }>(
        "select count(*)::int as n from radcore.saved_once where route = 'POST /sign-out'")).rows;
      expect(n).toBe(0);
    });
  });

  it('claims no key for a read', async () => {
    await serve(async (base) => {
      const key = randomUUID();
      const res = await fetch(`${base}/orders/count`, { headers: { 'idempotency-key': key } });
      expect(res.status).toBe(200);
      expect(await rowsFor(key)).toEqual([]);
    });
  });
});
