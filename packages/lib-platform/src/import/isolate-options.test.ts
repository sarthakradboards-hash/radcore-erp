// ADR-003 §7: the import worker carries no database or S3 credentials, and only a few run at once. A Worker copies
// process.env unless told not to, so this records the options each real Worker is started with, and how many are
// alive together.
import { beforeEach, expect, it, vi } from 'vitest';
import { readTable } from '../index.ts';

// Each test here starts real import workers, and each worker loads the parser and lib-common afresh (about 1 s cold,
// several on a loaded machine), at most two at a time: vitest's 5 s default is less than that start-up (RAD-46).
vi.setConfig({ testTimeout: 30_000 });

const seen = vi.hoisted(() => ({ options: [] as unknown[], live: 0, most: 0 }));
vi.mock('node:worker_threads', async (importOriginal) => {
  const real = await importOriginal<{ Worker: new (...a: unknown[]) => { once(event: string, f: () => void): unknown } }>();
  return { ...real, Worker: class extends real.Worker {
    constructor(...a: unknown[]) {
      super(...a);
      seen.options.push(a[1]);
      seen.live++;
      seen.most = Math.max(seen.most, seen.live);
      this.once('exit', () => { seen.live--; });
    }
  } };
});

const csv = new TextEncoder().encode('Narration,Amount\nTea,10\n');

beforeEach(() => {
  seen.options.length = 0;
  seen.most = seen.live;
});

it('starts the worker with an empty environment and its memory caps', async () => {
  await readTable(csv);
  expect(seen.options).toEqual([expect.objectContaining({ env: {},
    resourceLimits: { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 64 } })]);
});

it('parses at most two files at once, and every one in its turn (auditor-2 SHOULD on #56)', async () => {
  const tables = await Promise.all(Array.from({ length: 6 }, () => readTable(csv)));
  expect(tables).toHaveLength(6);
  expect(seen.options).toHaveLength(6);
  expect(seen.most).toBeLessThanOrEqual(2);
});
