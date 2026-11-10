// RAD-44 (RC-082) on real pg-boss and PostgreSQL 16: jobs run, retry into the dead-letter alert, keep their overlap
// guard and timeout, follow their schedule, and a delete-on-complete job leaves no row behind. Runs where
// TEST_DATABASE_URL is set (CI's test job). Here in tools/ because creating pg-boss's schema is DDL, which the app
// never runs: until RAD-25's owner migration exists, this test installs it from pg-boss's own construction plan.
import { loadConfig } from '@radcore/lib-platform';
import { defineJob } from '@radcore/lib-platform';
import { createJobQueue, runJobs } from '@radcore/lib-platform/runtime';
import { factory, testPassword, testSettings } from '@radcore/test-helpers';
import pg from 'pg';
import { getConstructionPlans } from 'pg-boss';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const url = process.env['TEST_DATABASE_URL'];
const SCHEMA = 'pgboss';
const name = factory((f) => ({ name: `test.job-${f.tag}` }));
const logger = () => ({ info: vi.fn<(m: string) => void>(), error: vi.fn<(m: string, e?: unknown) => void>() });
const database = () => {
  const u = new URL(url ?? '');
  // The test database uses trust auth; config wants a password, which the server ignores.
  u.password = testPassword();
  return loadConfig(testSettings({ DATABASE_URL: u.toString() }), 'worker').database;
};
const system = { kind: 'system', name: 'test', permissions: [] } as const;

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
  beforeAll(async () => {
    const [found] = await asOperator<{ n: string }>('select count(*) as n from pg_namespace where nspname = $1', [SCHEMA]);
    if (found?.n === '0') await asOperator(getConstructionPlans(SCHEMA));
  });

  it('runs a job, and a delete-on-complete job leaves no row', async () => {
    const queue = createJobQueue(database(), logger());
    const ran = vi.fn(async () => undefined);
    const keep = defineJob({ ...name(), principal: system, input: z.object({ n: z.number() }) }, ran);
    const gone = defineJob({ ...name(), principal: system, input: z.object({ n: z.number() }), deleteOnComplete: true }, ran);
    const stop = await runJobs(queue, [keep, gone], logger());
    try {
      const keptId = await queue.send(keep.name, { n: 1 });
      const goneId = await queue.send(gone.name, { n: 2 });
      await vi.waitFor(async () => {
        const rows = await asOperator<{ id: string; state: string }>(`select id, state from ${SCHEMA}.job where id = any($1)`,
          [[keptId, goneId]]);
        expect(rows).toEqual([{ id: keptId, state: 'completed' }]);
      }, { timeout: 30_000, interval: 250 });
      expect(ran).toHaveBeenCalledWith({ n: 1 }, expect.objectContaining({ jobId: keptId, principal: system }));
      expect(ran).toHaveBeenCalledWith({ n: 2 }, expect.objectContaining({ jobId: goneId }));
    } finally {
      await stop.stop();
    }
  }, 60_000);

  it('sends a job that fails all its attempts to the dead-letter alert, without its payload', async () => {
    const queue = createJobQueue(database(), logger());
    const log = logger();
    const job = defineJob({ ...name(), principal: system, input: z.object({ card: z.string() }), retries: 0 },
      async () => { throw new Error('provider down'); });
    const stop = await runJobs(queue, [job], log);
    try {
      const id = await queue.send(job.name, { card: 'reset-link-payload' });
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
    const stop = await runJobs(queue, [job], logger());
    try {
      expect(await queue.getQueue(job.name)).toMatchObject({ policy: 'singleton', expireInSeconds: 45, retryLimit: 2,
        deadLetter: `${job.name}.dead` });
      expect(await queue.getSchedule(job.name)).toMatchObject({ name: job.name, cron: '* * * * *' });
    } finally {
      await stop.stop();
    }
  }, 60_000);
});
