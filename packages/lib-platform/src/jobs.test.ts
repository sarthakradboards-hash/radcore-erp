// RC-082: every job has retries, a timeout, an optional overlap guard and a dead-letter queue, declared as data.
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Principal } from './ctx.ts';
import { defineJob, queueSettings, type JobContract, type OpenJob } from './jobs.ts';

const contract = (over: Partial<JobContract<{ n: number }>> = {}): JobContract<{ n: number }> => ({
  name: 'sales.shopify-order', principal: { kind: 'system', name: 'online-orders', permissions: ['sales:write'] },
  input: z.object({ n: z.number() }), ...over,
});

describe('queueSettings', () => {
  it('gives every job retries with backoff, a timeout and a dead-letter queue by default', () => {
    expect(queueSettings(contract())).toEqual({ policy: 'standard', retries: 3, retryDelay: 30, retryBackoff: true,
      expireInSeconds: 300, deleteAfterSeconds: 7 * 86_400, deadLetter: 'sales.shopify-order.dead' });
  });

  it('takes the overlap guard, the limits, and delete-on-complete from the contract', () => {
    expect(queueSettings(contract({ oneAtATime: true, retries: 0, retryDelaySeconds: 5, timeoutSeconds: 60,
      deleteOnComplete: true }))).toMatchObject({ policy: 'singleton', retries: 0, retryDelay: 5, expireInSeconds: 60,
      deleteAfterSeconds: 1 });
  });

  it.each([
    [{ name: 'Sales.Order' }, /not valid/],
    [{ name: 'sales.order.dead' }, /not valid/],
    [{ name: '' }, /not valid/],
    [{ retries: -1 }, /retries must be a whole number of at least 0/],
    [{ retryDelaySeconds: 0 }, /retryDelaySeconds must be a whole number of at least 1/],
    [{ timeoutSeconds: 1.5 }, /timeoutSeconds must be a whole number of at least 1/],
  ])('refuses %j', (over, why) => {
    expect(() => queueSettings(contract(over))).toThrow(why);
  });
});

describe('defineJob', () => {
  // A stand-in for the worker's transaction: records who it would open as. The real Ctx reaching the service is
  // proved on PostgreSQL (tools/jobs.test.ts).
  const opener = () => {
    const opened: { principal: Principal; jobId: string }[] = [];
    const open: OpenJob = async (principal, jobId) => {
      opened.push({ principal, jobId });
    };
    return { open, opened };
  };

  it('checks the payload first, then runs the service in a transaction as the contract\'s system principal', async () => {
    const service = vi.fn(async () => undefined);
    const job = defineJob(contract(), service);
    const { open, opened } = opener();
    await job.handle({ n: 1 }, 'job-1', open);
    expect(opened).toEqual([{ principal: { kind: 'system', name: 'online-orders', permissions: ['sales:write'] }, jobId: 'job-1' }]);
    await expect(job.handle({ n: 'one' }, 'job-2', open)).rejects.toThrow();
    expect(opened).toHaveLength(1);
  });

  it('runs a job for a user as nobody until its enqueuer is rechecked (RAD-44 step 3b): it fails closed', async () => {
    const service = vi.fn(async () => undefined);
    const { open, opened } = opener();
    await expect(defineJob(contract({ principal: { kind: 'user' } }), service).handle({ n: 1 }, 'job-3', open))
      .rejects.toThrow(/can't run until its enqueuer is rechecked/);
    expect([opened, service.mock.calls]).toEqual([[], []]);
  });

  it('carries the schedule and delete-on-complete for the worker', () => {
    const job = defineJob(contract({ every: '* * * * *', deleteOnComplete: true }), async () => undefined);
    expect(job).toMatchObject({ name: 'sales.shopify-order', every: '* * * * *', deleteOnComplete: true });
  });
});
