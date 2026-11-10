// RAD-44 step 2 (ADR-002 §4, ADR-001 §8): the outbox on PostgreSQL 16 and real pg-boss, as the app login. A job sent
// in a committed transaction runs once; one sent in a rolled-back transaction never does; a row sent again after a
// crash is refused by pg-boss's job id; two relays never take the same row; a job pg-boss can't take waits.
// Here in tools/ because it reads pg-boss's and the outbox's tables as an operator would.
import { randomUUID } from 'node:crypto';
import { defineJob, loadConfig } from '@radcore/lib-platform';
import { createDatabase, createJobQueue, relayOutbox, runInTransaction, runJobs } from '@radcore/lib-platform/runtime';
import { factory, testPassword, testSettings } from '@radcore/test-helpers';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const url = process.env['TEST_DATABASE_URL'];
const settings = () => {
  const u = new URL(url ?? '');
  // The test database uses trust auth; config wants a password, which the server ignores.
  u.password = testPassword();
  return loadConfig(testSettings({ DATABASE_URL: u.toString() }), 'worker').database;
};
const name = factory((f) => ({ name: `test.outbox-${f.tag}` }));
const logger = () => ({ info: vi.fn<(m: string) => void>(), error: vi.fn<(m: string, e?: unknown) => void>() });
const user = { kind: 'user', userId: 'u-1', permissions: [] } as const;
const WRITE = { readOnly: false, isolation: 'read committed' } as const;

describe.skipIf(!url)('the outbox', () => {
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  const db = createDatabase(pool);
  const queue = createJobQueue(settings(), logger());
  const ran = vi.fn<(input: { n: number }) => void>();
  const contract = { ...name(), principal: { kind: 'system', name: 'test', permissions: [] }, input: z.object({ n: z.number() }) } as const;
  const job = defineJob(contract, async (input) => { ran(input); });
  const stops: { stop(): Promise<void> }[] = [];

  beforeAll(async () => {
    stops.push(await runJobs(queue, [job], logger()));
  });
  afterAll(async () => {
    for (const s of stops) await s.stop();
    await pool.end();
  });

  const send = (n: number, requestId = randomUUID()) =>
    runInTransaction(db, WRITE, user, requestId, (ctx) => ctx.jobs.send(contract, { n }));
  const outboxFor = async (requestId: string) => (await pool.query<{ id: string; name: string; principal: string }>(
    'select id, name, principal from radcore.jobs_outbox where request_id = $1', [requestId])).rows;
  const jobsWithIds = async (ids: string[]) => Number((await pool.query(
    'select count(*) from pgboss.job where id = any($1::uuid[])', [ids])).rows[0]?.count);

  it('queues a job sent in a committed transaction, runs it once, and empties the outbox', async () => {
    const requestId = randomUUID();
    await send(41, requestId);
    const [row] = await outboxFor(requestId);
    expect(row).toMatchObject({ name: job.name, principal: 'user:u-1' });
    await relayOutbox(db, queue, logger());
    expect(await outboxFor(requestId)).toEqual([]);
    expect(await jobsWithIds([row?.id ?? ''])).toBe(1);
    await vi.waitFor(() => expect(ran).toHaveBeenCalledWith({ n: 41 }), { timeout: 30_000, interval: 250 });
  }, 60_000);

  it('queues nothing when the save rolls back', async () => {
    const requestId = randomUUID();
    await expect(runInTransaction(db, WRITE, user, requestId, async (ctx) => {
      await ctx.jobs.send(contract, { n: 1 });
      throw new Error('the save failed');
    })).rejects.toThrow('the save failed');
    expect(await outboxFor(requestId)).toEqual([]);
  });

  it('refuses input the job\'s schema refuses, before anything is queued', async () => {
    const requestId = randomUUID();
    await expect(runInTransaction(db, WRITE, user, requestId, (ctx) =>
      ctx.jobs.send(contract, { n: 'one' } as unknown as { n: number }))).rejects.toThrow();
    expect(await outboxFor(requestId)).toEqual([]);
  });

  it('queues a row sent again after a crash only once: pg-boss refuses the same job id', async () => {
    const requestId = randomUUID();
    await send(7, requestId);
    const [row] = await outboxFor(requestId);
    const id = row?.id ?? '';
    await relayOutbox(db, queue, logger());
    // The crash: the job reached pg-boss, but the delete didn't commit, so the row is back.
    await runInTransaction(db, WRITE, user, requestId, (ctx) => ctx.jobs.send(contract, { n: 7 }));
    // The who-and-when stamp needs a principal (RA005, RAD-30).
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query("set local app.principal = 'system:test'");
      await c.query('update radcore.jobs_outbox set id = $1 where request_id = $2', [id, requestId]);
      await c.query('commit');
    } finally {
      c.release();
    }
    expect((await relayOutbox(db, queue, logger())).sent).toBeGreaterThanOrEqual(1);
    expect(await outboxFor(requestId)).toEqual([]);
    expect(await jobsWithIds([id])).toBe(1);
  }, 60_000);

  it('never lets two relays take the same row', async () => {
    const requestId = randomUUID();
    await runInTransaction(db, WRITE, user, requestId, async (ctx) => {
      for (const n of [1, 2, 3, 4, 5, 6]) await ctx.jobs.send(contract, { n });
    });
    const ids = (await outboxFor(requestId)).map((r) => r.id);
    await Promise.all([relayOutbox(db, queue, logger(), { batch: 3 }), relayOutbox(db, queue, logger(), { batch: 3 })]);
    await relayOutbox(db, queue, logger());
    expect(await outboxFor(requestId)).toEqual([]);
    expect(await jobsWithIds(ids)).toBe(6);
  }, 60_000);

  // A contract no worker runs, so pg-boss has no queue for it: every send of it fails.
  const poison = () => ({ ...name(), principal: { kind: 'system', name: 'test', permissions: [] }, input: z.object({}) } as const);

  it('never lets rows it can\'t queue block the jobs behind them (100+ ahead of a good one)', async () => {
    const lost = poison();
    const before = randomUUID();
    const after = randomUUID();
    await runInTransaction(db, WRITE, user, before, async (ctx) => {
      for (let i = 0; i < 101; i += 1) await ctx.jobs.send(lost, {});
    });
    await send(5, after);
    const [good] = await outboxFor(after);
    try {
      // The first pass takes the 100 oldest, all poison, and backs each off; the next one reaches the good job.
      expect(await relayOutbox(db, queue, logger())).toEqual({ taken: 100, sent: 0 });
      await relayOutbox(db, queue, logger());
      expect(await outboxFor(after)).toEqual([]);
      expect(await jobsWithIds([good?.id ?? ''])).toBe(1);
      const backedOff = await pool.query<{ n: number }>(
        'select count(*)::int as n from radcore.jobs_outbox where request_id = $1 and attempts = 1 and next_attempt_at > now()', [before]);
      expect(backedOff.rows[0]?.n).toBe(101);
    } finally {
      await pool.query('delete from radcore.jobs_outbox where request_id = $1', [before]);
    }
  }, 60_000);

  it('sets a row aside after its last try, with one alert, and takes it no more', async () => {
    const requestId = randomUUID();
    await runInTransaction(db, WRITE, user, requestId, (ctx) => ctx.jobs.send(poison(), {}));
    const [row] = await outboxFor(requestId);
    const alert = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    const options = { maxAttempts: 2, backoff: () => 0, alert };
    try {
      for (let pass = 0; pass < 3; pass += 1) await relayOutbox(db, queue, logger(), options);
      const [state] = (await pool.query<{ attempts: number; dead: boolean }>(
        'select attempts, dead_at is not null as dead from radcore.jobs_outbox where id = $1', [row?.id])).rows;
      expect(state).toEqual({ attempts: 2, dead: true });
      expect(alert.mock.calls.map((c) => c[0]).filter((m) => m.includes(row?.id ?? '-'))).toHaveLength(1);
    } finally {
      await pool.query('delete from radcore.jobs_outbox where request_id = $1', [requestId]);
    }
  }, 60_000);});
