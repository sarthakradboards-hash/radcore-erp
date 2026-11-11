// RC-082: every job has retries, a timeout, an optional overlap guard and a dead-letter queue, declared as data.
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Ctx, Principal } from './ctx.ts';
import { defineJob, JobRefused, queueSettings, type JobContract, type OpenJob } from './jobs.ts';

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

  const nobody = async () => null;
  const alert = async () => undefined;
  const asUser = (permissions: string[]): Principal => ({ kind: 'user', userId: 'u-1', permissions });

  it('checks the envelope and the payload first, then runs a system job as its contract\'s principal', async () => {
    const service = vi.fn(async () => undefined);
    const job = defineJob(contract(), service);
    const { open, opened } = opener();
    await job.handle({ input: { n: 1 }, by: 'system:online-orders' }, 'job-1', { open, load: nobody, alert });
    expect(opened).toEqual([{ principal: { kind: 'system', name: 'online-orders', permissions: ['sales:write'] }, jobId: 'job-1' }]);
    await expect(job.handle({ input: { n: 'one' }, by: 'system:x' }, 'job-2', { open, load: nobody, alert })).rejects.toThrow();
    // A bare payload, not an envelope, never runs either.
    await expect(job.handle({ n: 1 }, 'job-3', { open, load: nobody, alert })).rejects.toThrow();
    expect(opened).toHaveLength(1);
  });

  it('runs a job for a user as that person, loaded now, when they still hold its permission (ADR-001 §6a)', async () => {
    const { open, opened } = opener();
    const load = vi.fn(async () => asUser(['invoices:export']));
    await defineJob(contract({ principal: { kind: 'user', perm: 'invoices:export' } }), async () => undefined)
      .handle({ input: { n: 1 }, by: 'user:u-1' }, 'job-4', { open, load, alert });
    expect(load).toHaveBeenCalledWith('user:u-1');
    expect(opened).toEqual([{ principal: asUser(['invoices:export']), jobId: 'job-4' }]);
  });

  it.each([
    ['who lost the permission', 'user:u-1', async () => asUser(['invoices:read'])],
    ['who is gone', 'user:u-1', async () => null],
    ['that no person queued', 'system:online-orders', async () => asUser(['invoices:export'])],
  ])('refuses a job for a user %s, without opening a transaction', async (_why, by, load) => {
    const { open, opened } = opener();
    await expect(defineJob(contract({ principal: { kind: 'user', perm: 'invoices:export' } }), async () => undefined)
      .handle({ input: { n: 1 }, by }, 'job-5', { open, load, alert })).rejects.toThrow(JobRefused);
    expect(opened).toEqual([]);
  });

  // RAD-32: a job that calls out (an email) must do it outside its transaction (ADR-001 §8), then record the result.
  it('runs an after-commit step with the service result, outside the transaction, which may open one more', async () => {
    const steps: string[] = [];
    const open: OpenJob = async (_principal, jobId, work) => {
      steps.push(`open ${jobId}`);
      await work({} as Ctx);
      steps.push('commit');
    };
    const job = defineJob({ name: 'test.mail', principal: { kind: 'system', name: 'mail', permissions: [] }, input: z.object({ n: z.number() }) },
      async (_ctx, input) => {
        steps.push('service');
        return `item ${input.n}`;
      },
      { afterCommit: async (result, again) => {
        steps.push(`after ${result}`);
        await again(async () => {
          steps.push('second');
        });
      } });
    await job.handle({ input: { n: 2 }, by: 'system:x' }, 'job-9', { open, load: nobody, alert: async () => undefined });
    expect(steps).toEqual(['open job-9', 'service', 'commit', 'after item 2', 'open job-9', 'second', 'commit']);
  });

  it('refuses a scheduled job that would run as a user', () => {
    expect(() => defineJob(contract({ principal: { kind: 'user', perm: 'invoices:export' }, every: '* * * * *' }),
      async () => undefined)).toThrow(/scheduled job must declare a system principal/);
  });
  it('carries the schedule and delete-on-complete for the worker', () => {
    const job = defineJob(contract({ every: '* * * * *', deleteOnComplete: true }), async () => undefined);
    expect(job).toMatchObject({ name: 'sales.shopify-order', every: '* * * * *', deleteOnComplete: true });
  });
});
