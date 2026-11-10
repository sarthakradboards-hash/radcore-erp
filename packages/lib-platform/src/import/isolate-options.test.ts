// ADR-003 §7: the import worker carries no database or S3 credentials. A Worker copies process.env unless told not
// to, so this records the options each real Worker is started with.
import { expect, it, vi } from 'vitest';
import { readTable } from '../index.ts';

const seen = vi.hoisted(() => [] as unknown[]);
vi.mock('node:worker_threads', async (importOriginal) => {
  const real = await importOriginal<{ Worker: new (...a: unknown[]) => object }>();
  return { ...real, Worker: class extends real.Worker {
    constructor(...a: unknown[]) {
      super(...a);
      seen.push(a[1]);
    }
  } };
});

it('starts the worker with an empty environment and its memory caps', async () => {
  await readTable(new TextEncoder().encode('Narration,Amount\nTea,10\n'));
  expect(seen).toEqual([expect.objectContaining({ env: {},
    resourceLimits: { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 64 } })]);
});
