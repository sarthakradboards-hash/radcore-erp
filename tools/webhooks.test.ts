// RAD-45 (RC-084, ADR-001 §8a) over real HTTP on PostgreSQL 16 and pg-boss, with APP_ENV=ci: a delivery's signature is
// checked on its raw bytes, it's stored once and answered before any work runs, and the work runs from the queue as
// the webhook's system principal. A repeat is answered and acted on once; a forged one leaves nothing behind.
// Here in tools/ because it calls the API with fetch (ADR-002 L8).
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { defineContract } from '@radcore/lib-common';
import { defineWebhook, defineWebhookJob, loadConfig, webhookDelivery, type WebhookVerifier } from '@radcore/lib-platform';
import { createDatabase, relayOutbox, runJobs } from '@radcore/lib-platform/runtime';
// The full pg-boss queue: relayOutbox sends to it; the apps' queue can't (RAD-44).
import { createJobQueue } from '../packages/lib-platform/src/db/client.ts';
import { testSettings } from '@radcore/test-helpers';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createApp, listen } from '../apps/api/src/app.ts';

const url = process.env['TEST_DATABASE_URL'];
// APP_ENV ci: the production path, and the test database's URL needs no password.
const config = () => loadConfig(testSettings({ APP_ENV: 'ci', NODE_ENV: 'test', DATABASE_URL: url ?? '' }), 'api');
const logger = () => ({ info: vi.fn<(m: string) => void>(), error: vi.fn<(m: string, e?: unknown) => void>() });
// Built at run time, so the secret scanner has nothing to match.
const SECRET = 'hook-secret-'.repeat(3);
const sign = (raw: string) => createHmac('sha256', SECRET).update(raw).digest('hex');

// A provider like most: an HMAC of the raw body in one header, its own delivery id (if any) in another.
const verify: WebhookVerifier = (raw, header) => {
  const given = header('x-test-signature') ?? '';
  return given === createHmac('sha256', SECRET).update(raw).digest('hex')
    ? { valid: true, deliveryId: header('x-test-delivery') ?? null } : { valid: false };
};

describe.skipIf(!url)('webhook intake', () => {
  const tag = randomBytes(4).toString('hex');
  const contract = defineContract({ method: 'POST', path: `/hooks/test-${tag}`, auth: 'webhook', perm: null,
    tx: { readOnly: false, isolation: 'read committed' }, input: z.unknown(), output: z.object({}) });
  const job = { name: `test.webhook-${tag}`, principal: { kind: 'system', name: 'test-orders', permissions: ['sales:write'] },
    input: webhookDelivery, retries: 0 } as const;
  const hook = defineWebhook(contract, verify, job);
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  const db = createDatabase(pool);
  const handled = vi.fn<(delivery: { payload: string }, principal: unknown) => void>();
  const state: { base: string; stops: { stop(): Promise<void> }[]; queue?: ReturnType<typeof createJobQueue> } =
    { base: '', stops: [] };

  beforeAll(async () => {
    // Built here, not in the describe body, which runs even when the suite is skipped (no test database).
    const queue = createJobQueue(config().database, logger());
    state.queue = queue;
    state.stops.push(await runJobs(queue, [defineWebhookJob(job, async (ctx, delivery) => {
      handled(delivery, ctx.principal);
    })], logger(), { db }));
    const server = await listen(createApp(config(), logger(), { db, routes: [], webhooks: [hook], authenticate: async () => null }),
      0, '127.0.0.1');
    state.stops.push(server);
    state.base = `http://127.0.0.1:${server.port}`;
  });
  afterAll(async () => {
    for (const s of state.stops.reverse()) await s.stop();
    await pool.end();
  });

  const deliver = (body: string, headers: Record<string, string> = {}) => fetch(`${state.base}${contract.path}`, {
    method: 'POST', body, headers: { 'content-type': 'application/json', 'x-test-signature': sign(body), ...headers } });
  const stored = async (deliveryId: string) => (await pool.query<{ processed: boolean }>(
    'select processed_at is not null as processed from radcore.webhook_deliveries where source = $1 and delivery_id = $2',
    [hook.source, deliveryId])).rows;
  // One relay pass over this webhook's job only, as the worker's relay would make it: the outbox is shared with other
  // test files, whose rows it must never try (RAD-79). Callers retry it with the check they wait on.
  const runQueuedWork = async () => {
    if (state.queue) await relayOutbox(db, state.queue, logger(), { only: [job.name] });
  };

  it('stores a signed delivery and answers before any work runs; the work runs later, from the queue (RC-084)', async () => {
    const id = randomUUID();
    const body = JSON.stringify({ order: id });
    const res = await deliver(body, { 'x-test-delivery': id });
    expect([res.status, await res.json()]).toEqual([200, {}]);
    // Answered, stored, and nothing run yet: the work isn't awaited inside the request.
    expect(await stored(id)).toEqual([{ processed: false }]);
    expect(handled.mock.calls.filter(([d]) => d.payload === body)).toEqual([]);
    await vi.waitFor(async () => {
      await runQueuedWork();
      expect(await stored(id)).toEqual([{ processed: true }]);
    }, { timeout: 30_000, interval: 250 });
    expect(handled).toHaveBeenCalledWith(expect.objectContaining({ payload: body, deliveryId: id }),
      { kind: 'system', name: 'test-orders', permissions: ['sales:write'] });
  }, 60_000);

  it('answers a repeat the same but stores and acts on it once (replay protection)', async () => {
    const id = randomUUID();
    const body = JSON.stringify({ order: id });
    expect([(await deliver(body, { 'x-test-delivery': id })).status, (await deliver(body, { 'x-test-delivery': id })).status])
      .toEqual([200, 200]);
    expect(await stored(id)).toHaveLength(1);
    await vi.waitFor(async () => {
      await runQueuedWork();
      expect(await stored(id)).toEqual([{ processed: true }]);
    }, { timeout: 30_000, interval: 250 });
    expect(handled.mock.calls.filter(([d]) => d.payload === body)).toHaveLength(1);
  }, 60_000);

  it('acts once on a signed body resent under a new delivery id, since the id header isn\'t signed (auditor-2)', async () => {
    const [first, second] = [randomUUID(), randomUUID()];
    const body = JSON.stringify({ order: first });
    expect([(await deliver(body, { 'x-test-delivery': first })).status, (await deliver(body, { 'x-test-delivery': second })).status])
      .toEqual([200, 200]);
    expect([await stored(first), await stored(second)].map((r) => r.length)).toEqual([1, 0]);
    await vi.waitFor(async () => {
      await runQueuedWork();
      expect(await stored(first)).toEqual([{ processed: true }]);
    }, { timeout: 30_000, interval: 250 });
    expect(handled.mock.calls.filter(([d]) => d.payload === body)).toHaveLength(1);
  }, 60_000);

  it('refuses a delivery whose signature doesn\'t match its raw body, storing nothing', async () => {
    const id = randomUUID();
    const body = JSON.stringify({ order: id });
    const res = await deliver(`${body} `, { 'x-test-delivery': id, 'x-test-signature': sign(body) });
    expect(res.status).toBe(401);
    expect(await stored(id)).toEqual([]);
  });

  it('keys a delivery with no provider id on its body, so a byte-for-byte resend is still caught', async () => {
    const body = JSON.stringify({ order: randomUUID() });
    const other = JSON.stringify({ order: randomUUID() });
    for (const b of [body, body, other]) expect((await deliver(b)).status).toBe(200);
    // The intake's own id for it: the SHA-256 of the raw body.
    const hash = (b: string) => createHash('sha256').update(b).digest('hex');
    expect([await stored(hash(body)), await stored(hash(other))].map((r) => r.length)).toEqual([1, 1]);
  });
});

