// ADR-003 §7 on a real worker: a file that takes too long or needs too much memory is refused, and the parse
// itself crosses back intact. import.test.ts reads every other file through this same worker.
import { describe, expect, it, vi } from 'vitest';
import { ImportFileError, ISOLATE_LIMITS, readTable } from '../index.ts';

// Each test here starts real import workers, and each worker loads the parser and lib-common afresh (about 1 s cold,
// several on a loaded machine), at most two at a time: vitest's 5 s default is less than that start-up (RAD-46).
vi.setConfig({ testTimeout: 30_000 });

const csv = (rows: number) => new TextEncoder().encode(
  ['Narration,Amount', ...Array.from({ length: rows }, (_, i) => `"Line ${String(i)} with some text",${String(i)}.50`)].join('\n'));

describe('readTable in its worker', () => {
  it('gives back the table the worker read', async () => {
    expect(await readTable(csv(2))).toEqual({ header: ['Narration', 'Amount'],
      rows: [['Line 0 with some text', '0.50'], ['Line 1 with some text', '1.50']] });
  });

  it('terminates a worker past its time limit and says so', async () => {
    await expect(readTable(csv(40_000), { ...ISOLATE_LIMITS, timeoutMs: 1 }))
      .rejects.toThrow(new ImportFileError('The file took too long to read. Split it and import each part.'));
  });

  it('refuses a file that needs more memory than the cap', async () => {
    await expect(readTable(csv(49_000), { ...ISOLATE_LIMITS, maxOldGenerationSizeMb: 4, maxYoungGenerationSizeMb: 1 }))
      .rejects.toThrow(new ImportFileError('The file needs too much memory to read. Split it and import each part.'));
  });
});
