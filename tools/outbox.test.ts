// RAD-44 step 2 (ADR-002 §4, ADR-001 §8): the outbox on PostgreSQL 16 and real pg-boss, as the app login. A job sent
// in a committed transaction runs once; one sent in a rolled-back transaction never does; a row sent again after a
// crash is refused by pg-boss's job id; two relays never take the same row; a job pg-boss can't take waits.
// Here in tools/ because it reads pg-boss's and the outbox's tables as an operator would.
// The outbox is shared with every other test file running at the same time, and the relay takes the oldest due rows
// of all of it. So each test relays until its own rows have gone, and asserts only on its own rows (RAD-79): other
// files' jobs may be ahead of it, and a fresh row may not be due on the first pass (the relay reads the app's clock,
// the row's time is the database's).
import { randomUUID } from 'node:crypto';
import { defineJob, loadConfig } from '@radcore/lib-platform';
import { createDatabase, relayOutbox, runInTransaction, runJobs } from '@radcore/lib-platform/runtime';
// The full pg-boss queue, to send to it directly as an operator; the apps' queue can't (RAD-44).
import { createJobQueue } from '../packages/lib-platform/src/db/client.ts';
import { factory, testPassword, testSettings } from '@radcore/test-helpers';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const url = process.env['TEST_DATABASE_URL'];
const settings = () => {
  // Without a test database the suite is skipped, but its body still runs: a placeholder keeps it from throwing, and
  // the queue built from it is never started.
  const u = new URL(url ?? 'postgres://skipped@127.0.0.1:1/skipped');
  // The test database uses trust auth; config wants a password, which the server ignores.
  u.password = testPassword();
  return loadConfig(testSettings({ DATABASE_URL: u.toString() }), 'worker').database;
};
const name = factory((f) => ({ name: `test.outbox-${f.tag}` }));
const logger = () => ({ info: vi.fn<(m: string) => void>(), error: vi.fn<(m: string, e?: unknown) => void>() });
const user = { kind: 'user', userId: 'u-1', permissions: [] } as const;
const WRITE = { readOnly: false, isolation: 'read committed' } as const;

describe.skipIf(!url)('the outbox', () => {
  const pool = new pg.Pool({ connectionString: url, max: 6 });
  const db = createDatabase(pool);
  const queue = createJobQueue(settings(), logger());
  const ran = vi.fn<(input: { n: number }) => void>();
  const contract = { ...name(), principal: { kind: 'system', name: 'test', permissions: [] }, input: z.object({ n: z.number() }) } as const;
  const job = defineJob(contract, async (_ctx, input) => { ran(input); });
  const stops: { stop(): Promise<void> }[] = [];

  beforeAll(async () => {
    stops.push(await runJobs(queue, [job], logger(), { db }));
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
  // Relay passes, as the worker's relay would make them, until `done` holds.
  const relayUntil = (done: () => Promise<void>, q = queue, options?: Parameters<typeof relayOutbox>[3]) =>
    vi.waitFor(async () => {
      await relayOutbox(db, q, logger(), options);
      await done();
    }, { timeout: 30_000, interval: 250 });
  const gone = (...requestIds: string[]) => async () => {
    for (const r of requestIds) expect(await outboxFor(r)).toEqual([]);
  };

  it('queues a job sent in a committed transaction, runs it once, and empties the outbox', async () => {
    const requestId = randomUUID();
    await send(41, requestId);
    const [row] = await outboxFor(requestId);
    expect(row).toMatchObject({ name: job.name, principal: 'user:u-1' });
    await relayUntil(gone(requestId));
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
    await relayUntil(gone(requestId));
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
    // The relay takes it again, pg-boss refuses the second job with that id, and the row is still cleared.
    await relayUntil(gone(requestId));
    expect(await jobsWithIds([id])).toBe(1);
  }, 60_000);

  it('never lets two relays take the same row', async () => {
    const requestId = randomUUID();
    await runInTransaction(db, WRITE, user, requestId, async (ctx) => {
      for (const n of [1, 2, 3, 4, 5, 6]) await ctx.jobs.send(contract, { n });
    });
    const ids = (await outboxFor(requestId)).map((r) => r.id);
    await Promise.all([relayOutbox(db, queue, logger(), { batch: 3 }), relayOutbox(db, queue, logger(), { batch: 3 })]);
    await relayUntil(gone(requestId));
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
      // A pass takes the oldest 100 due, the poison among them, and backs each off; a later pass reaches the good job.
      await relayUntil(gone(after));
      expect(await jobsWithIds([good?.id ?? ''])).toBe(1);
      // Every poison row was tried and is waiting its turn again: none was sent, none set aside.
      const poisoned = await pool.query<{ n: number }>('select count(*)::int as n from radcore.jobs_outbox '
        + 'where request_id = $1 and attempts >= 1 and dead_at is null', [before]);
      expect(poisoned.rows[0]?.n).toBe(101);
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
    const stateOf = async () => (await pool.query<{ attempts: number; dead: boolean }>(
      'select attempts, dead_at is not null as dead from radcore.jobs_outbox where id = $1', [row?.id])).rows[0];
    // These passes set aside after two tries, with no wait: other files' rows are held locked meanwhile, so the relay
    // skips them and only this row is tried that hard.
    const others = await pool.connect();
    try {
      await others.query('begin');
      await others.query('select id from radcore.jobs_outbox where request_id <> $1 for update skip locked', [requestId]);
      await relayUntil(async () => expect(await stateOf()).toEqual({ attempts: 2, dead: true }), queue, options);
      // A row set aside is taken no more: another pass leaves it as it is, and alerts no more.
      await relayOutbox(db, queue, logger(), options);
      expect(await stateOf()).toEqual({ attempts: 2, dead: true });
      expect(alert.mock.calls.map((c) => c[0]).filter((m) => m.includes(row?.id ?? '-'))).toHaveLength(1);
    } finally {
      await others.query('rollback');
      others.release();
      await pool.query('delete from radcore.jobs_outbox where request_id = $1', [requestId]);
    }
  }, 60_000);

  // ADR-001 §6a's "job for a user", end to end through the outbox: it runs as the person who queued it, loaded when
  // it runs, and only while they still hold its permission.
  const forUser = () => ({ ...name(), principal: { kind: 'user', perm: 'invoices:export' }, input: z.object({}) } as const);
  const person = (permissions: string[]) => ({ kind: 'user', userId: 'u-1', permissions }) as const;

  it('runs a job queued by a person as that person, loaded when it runs', async () => {
    const q = createJobQueue(settings(), logger());
    const job = forUser();
    const seen = vi.fn<(principal: unknown) => void>();
    const load = vi.fn(async (by: string) => (by === 'user:u-1' ? person(['invoices:export']) : null));
    const stop = await runJobs(q, [defineJob(job, async (ctx) => { seen(ctx.principal); })], logger(), { db, loadPrincipal: load });
    try {
      const requestId = randomUUID();
      await runInTransaction(db, WRITE, user, requestId, (ctx) => ctx.jobs.send(job, {}));
      await relayUntil(gone(requestId), q);
      await vi.waitFor(() => expect(seen).toHaveBeenCalledWith(person(['invoices:export'])), { timeout: 30_000, interval: 250 });
      expect(load).toHaveBeenCalledWith('user:u-1');
    } finally {
      await stop.stop();
    }
  }, 60_000);

  it('refuses a job queued by a person who lost its permission: it never runs, isn\'t retried, and alerts once', async () => {
    const q = createJobQueue(settings(), logger());
    const job = forUser();
    const ranAs = vi.fn();
    const alert = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    const stop = await runJobs(q, [defineJob(job, async () => { ranAs(); })], logger(),
      { db, alert, loadPrincipal: async () => person(['invoices:read']) });
    const requestId = randomUUID();
    try {
      await runInTransaction(db, WRITE, user, requestId, (ctx) => ctx.jobs.send(job, {}));
      const [row] = await outboxFor(requestId);
      await relayUntil(gone(requestId), q);
      await vi.waitFor(async () => expect((await pool.query<{ state: string; retries: number }>(
        'select state, retry_count as retries from pgboss.job where id = $1', [row?.id])).rows).toEqual([{ state: 'completed', retries: 0 }]),
      { timeout: 30_000, interval: 250 });
      expect(ranAs).not.toHaveBeenCalled();
      expect(alert.mock.calls.map((c) => c[0])).toEqual([
        `job ${job.name} refused (job ${row?.id ?? ''}): ${job.name}: user:u-1 no longer holds invoices:export`]);
    } finally {
      await stop.stop();
    }
  }, 60_000);});
