// RAD-44 (RC-082) on real pg-boss and PostgreSQL 16: jobs run, retry into the dead-letter alert, keep their overlap
// guard and timeout, follow their schedule, and a delete-on-complete job leaves no row behind. Runs where
// TEST_DATABASE_URL is set (CI's test job), on the schema migration 0001 built (RAD-25): the app runs no DDL, so these
// fail if the migrations stop providing it. Here in tools/ because it reads pg-boss's tables as an operator would.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { loadConfig } from '@radcore/lib-platform';
import { defineJob } from '@radcore/lib-platform';
import { cleanSavedOnce, savedOnceCleanup } from '@radcore/lib-platform';
import { createDatabase, runInTransaction, runJobs } from '@radcore/lib-platform/runtime';
// The full pg-boss queue, to send to it directly as an operator; the apps' queue can't (RAD-44).
import { createJobQueue } from '../packages/lib-platform/src/db/client.ts';
import { platformTx, savedOnce } from '@radcore/db/platform';
import { factory, testPassword, testSettings } from '@radcore/test-helpers';
import pg from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import platform from '../apps/worker/src/jobs/platform.ts';

const url = process.env['TEST_DATABASE_URL'];
const SCHEMA = 'pgboss';
const name = factory((f) => ({ name: `test.job-${f.tag}` }));
const logger = () => ({ info: vi.fn<(m: string) => void>(), error: vi.fn<(m: string, e?: unknown) => void>() });
const databaseUrl = () => {
  const u = new URL(url ?? '');
  // The test database uses trust auth; config wants a password, which the server ignores.
  u.password = testPassword();
  return u.toString();
};
const database = () => loadConfig(testSettings({ DATABASE_URL: databaseUrl() }), 'worker').database;
const system = { kind: 'system', name: 'test', permissions: [] } as const;
// Every job's pg-boss data is its envelope: the input and who queued it (RAD-44 step 3).
const envelope = (input: unknown) => ({ input, by: 'system:test' });

// Query the queue's own tables, as an operator would; the app never does.
const asOperator = async <T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> => {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
};

describe.skipIf(!url)('jobs on pg-boss', () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
  });
  // A saved-once row, written as a job would write: through platform's module transaction.
  const claim = (key: string, expiresAt: Date) => ({ principal: 'user:u-1', route: 'POST /x', key,
    inputHash: '0'.repeat(64), expiresAt });
  const rowsFor = async (keys: string[]) => (await asOperator<{ key: string; createdBy: string }>(
    'select key, created_by as "createdBy" from radcore.saved_once where key = any($1::uuid[]) order by key', [keys]));

  it('runs a job\'s service in one transaction as its system principal: its writes commit together', async () => {
    const queue = createJobQueue(database(), logger());
    const key = randomUUID();
    const seen: { principal: unknown; requestId: string }[] = [];
    const job = defineJob({ ...name(), principal: system, input: z.object({}), retries: 0 }, async (ctx) => {
      seen.push({ principal: ctx.principal, requestId: ctx.requestId });
      await platformTx(ctx).insert(savedOnce).values(claim(key, new Date('2099-01-01T00:00:00Z')));
    });
    const stop = await runJobs(queue, [job], logger(), { db });
    try {
      const id = await queue.send(job.name, envelope({}));
      await vi.waitFor(async () => expect(await rowsFor([key])).toEqual([{ key, createdBy: 'system:test' }]),
        { timeout: 30_000, interval: 250 });
      expect(seen).toEqual([{ principal: system, requestId: id }]);
    } finally {
      await stop.stop();
      await asOperator('delete from radcore.saved_once where key = $1', [key]);
    }
  }, 60_000);

  it('rolls back a failing job\'s writes, so a retry starts clean', async () => {
    const queue = createJobQueue(database(), logger());
    const key = randomUUID();
    const log = logger();
    const job = defineJob({ ...name(), principal: system, input: z.object({}), retries: 0 }, async (ctx) => {
      await platformTx(ctx).insert(savedOnce).values(claim(key, new Date('2099-01-01T00:00:00Z')));
      throw new Error('the job failed after writing');
    });
    const stop = await runJobs(queue, [job], log, { db });
    try {
      await queue.send(job.name, envelope({}));
      await vi.waitFor(() => expect(log.error).toHaveBeenCalledWith(expect.stringContaining(`ALERT: job ${job.name} failed`)),
        { timeout: 30_000, interval: 250 });
      expect(await rowsFor([key])).toEqual([]);
    } finally {
      await stop.stop();
    }
  }, 60_000);

  it('deletes saved-once keys past their expiry, and keeps the rest (RAD-27\'s clean-up job)', async () => {
    const queue = createJobQueue(database(), logger());
    const [old, live] = [randomUUID(), randomUUID()].sort() as [string, string];
    await runInTransaction(db, { readOnly: false, isolation: 'read committed' }, system, randomUUID(), async (ctx) => {
      await platformTx(ctx).insert(savedOnce).values([claim(old, new Date('2000-01-01T00:00:00Z')),
        claim(live, new Date('2099-01-01T00:00:00Z'))]);
    });
    const stop = await runJobs(queue, [defineJob(savedOnceCleanup, cleanSavedOnce)], logger(), { db });
    try {
      await queue.send(savedOnceCleanup.name, envelope(null));
      await vi.waitFor(async () => expect((await rowsFor([old, live])).map((r) => r.key)).toEqual([live]),
        { timeout: 30_000, interval: 250 });
    } finally {
      await stop.stop();
      await asOperator('delete from radcore.saved_once where key = any($1::uuid[])', [[old, live]]);
    }
  }, 60_000);

  // Windows has no SIGTERM: kill() ends the child without running its handler, so there's no clean stop to see.
  it.skipIf(process.platform === 'win32')('the worker process starts the job queue on the migrated schema, and stops cleanly', async () => {
    const worker = spawn(process.execPath, ['apps/worker/src/main.ts'],
      { env: { PATH: process.env['PATH'], ...testSettings({ DATABASE_URL: databaseUrl() }) } });
    const out: string[] = [];
    worker.stdout.on('data', (b: Buffer) => out.push(b.toString()));
    worker.stderr.on('data', (b: Buffer) => out.push(b.toString()));
    const exited = once(worker, 'exit');
    try {
      await vi.waitFor(() => expect(out.join('')).toContain('worker: started'), { timeout: 30_000, interval: 250 });
      // What the worker runs: its job files' list, plus the jobs built at start with what only start-up has (RAD-32's
      // reset email). Counted from the list, so a new job doesn't need this line changed.
      expect(out.join('')).toContain(`job queue: running ${platform.length + 1} job(s)`);
    } finally {
      worker.kill('SIGTERM');
    }
    expect((await exited)[0]).toBe(0);
  }, 60_000);

  it('two workers starting together both create the same queues and run', async () => {
    const job = defineJob({ ...name(), principal: system, input: z.object({}).loose() }, async () => undefined);
    const [a, b] = [createJobQueue(database(), logger()), createJobQueue(database(), logger())];
    const stops = await Promise.all([runJobs(a, [job], logger(), { db }), runJobs(b, [job], logger(), { db })]);
    await Promise.all(stops.map((s) => s.stop()));
    expect(await asOperator(`select name from ${SCHEMA}.queue where name = $1`, [job.name])).toEqual([{ name: job.name }]);
  }, 60_000);

  it('refuses to start a job whose overlap guard changed, since pg-boss would keep the old policy', async () => {
    const { name: jobName } = name();
    const before = defineJob({ name: jobName, principal: system, input: z.object({}).loose() }, async () => undefined);
    await (await runJobs(createJobQueue(database(), logger()), [before], logger(), { db })).stop();
    const after = defineJob({ name: jobName, principal: system, input: z.object({}).loose(), oneAtATime: true },
      async () => undefined);
    const queue = createJobQueue(database(), logger());
    try {
      await expect(runJobs(queue, [after], logger(), { db })).rejects.toThrow(/policy change needs a new queue name/);
    } finally {
      await queue.stop({ graceful: false });
    }
  }, 60_000);

  it('runs a job, and a delete-on-complete job leaves no row', async () => {
    const queue = createJobQueue(database(), logger());
    const ran = vi.fn(async () => undefined);
    const keep = defineJob({ ...name(), principal: system, input: z.object({ n: z.number() }) }, ran);
    const gone = defineJob({ ...name(), principal: system, input: z.object({ n: z.number() }), deleteOnComplete: true }, ran);
    const stop = await runJobs(queue, [keep, gone], logger(), { db });
    try {
      const keptId = await queue.send(keep.name, envelope({ n: 1 }));
      const goneId = await queue.send(gone.name, envelope({ n: 2 }));
      await vi.waitFor(async () => {
        const rows = await asOperator<{ id: string; state: string }>(`select id, state from ${SCHEMA}.job where id = any($1)`,
          [[keptId, goneId]]);
        expect(rows).toEqual([{ id: keptId, state: 'completed' }]);
      }, { timeout: 30_000, interval: 250 });
      expect(ran).toHaveBeenCalledWith(expect.objectContaining({ principal: system }), { n: 1 }, { jobId: keptId, alert: expect.any(Function) });
      expect(ran).toHaveBeenCalledWith(expect.anything(), { n: 2 }, { jobId: goneId, alert: expect.any(Function) });
    } finally {
      await stop.stop();
    }
  }, 60_000);

  it('sends a job that fails all its attempts to the dead-letter alert, without its payload', async () => {
    const queue = createJobQueue(database(), logger());
    const log = logger();
    const job = defineJob({ ...name(), principal: system, input: z.object({ card: z.string() }), retries: 0 },
      async () => { throw new Error('provider down'); });
    const stop = await runJobs(queue, [job], log, { db });
    try {
      const id = await queue.send(job.name, envelope({ card: 'reset-link-payload' }));
      await vi.waitFor(() => {
        expect(log.error).toHaveBeenCalledWith(expect.stringContaining(`ALERT: job ${job.name} failed after all its attempts`));
      }, { timeout: 30_000, interval: 250 });
      const alert = log.error.mock.calls.map((c) => c[0]).join('\n');
      expect(alert).not.toContain('reset-link-payload');
      expect(id).not.toBeNull();
    } finally {
      await stop.stop();
    }
  }, 60_000);

  it('stores the overlap guard, timeout, retries and dead-letter queue, and the schedule', async () => {
    const queue = createJobQueue(database(), logger());
    const job = defineJob({ ...name(), principal: system, input: z.object({}).loose(), oneAtATime: true,
      timeoutSeconds: 45, retries: 2, every: '* * * * *' }, async () => undefined);
    const stop = await runJobs(queue, [job], logger(), { db });
    try {
      expect(await queue.getQueue(job.name)).toMatchObject({ policy: 'singleton', expireInSeconds: 45, retryLimit: 2,
        deadLetter: `${job.name}.dead` });
      expect(await queue.getSchedule(job.name)).toMatchObject({ name: job.name, cron: '* * * * *' });
    } finally {
      await stop.stop();
    }
  }, 60_000);
});
