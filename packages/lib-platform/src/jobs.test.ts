// RC-082: every job has retries, a timeout, an optional overlap guard and a dead-letter queue, declared as data.
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { defineJob, queueSettings, type JobContract } from './jobs.ts';

const contract = (over: Partial<JobContract<{ n: number }>> = {}): JobContract<{ n: number }> => ({
  name: 'sales.shopify-order', principal: { kind: 'system', name: 'online-orders', permissions: ['sales:write'] },
  input: z.object({ n: z.number() }), ...over,
});

describe('queueSettings', () => {
  it('gives every job retries with backoff, a timeout and a dead-letter queue by default', () => {
    expect(queueSettings(contract())).toEqual({ policy: 'standard', retryLimit: 3, retryDelay: 30, retryBackoff: true,
      expireInSeconds: 300, deleteAfterSeconds: 7 * 86_400, deadLetter: 'sales.shopify-order.dead' });
  });

  it('takes the overlap guard, the limits, and delete-on-complete from the contract', () => {
    expect(queueSettings(contract({ oneAtATime: true, retries: 0, retryDelaySeconds: 5, timeoutSeconds: 60,
      deleteOnComplete: true }))).toMatchObject({ policy: 'singleton', retryLimit: 0, retryDelay: 5, expireInSeconds: 60,
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
  it('checks the payload against the input schema, then runs the service with the job id and principal', async () => {
    const service = vi.fn(async () => undefined);
    const job = defineJob(contract(), service);
    await job.handle({ n: 1 }, 'job-1');
    expect(service).toHaveBeenCalledWith({ n: 1 },
      { jobId: 'job-1', principal: { kind: 'system', name: 'online-orders', permissions: ['sales:write'] } });
    await expect(job.handle({ n: 'one' }, 'job-2')).rejects.toThrow();
    expect(service).toHaveBeenCalledTimes(1);
  });

  it('carries the schedule and delete-on-complete for the worker', () => {
    const job = defineJob(contract({ every: '* * * * *', deleteOnComplete: true }), async () => undefined);
    expect(job).toMatchObject({ name: 'sales.shopify-order', every: '* * * * *', deleteOnComplete: true });
  });
});
