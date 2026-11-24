import { describe, expect, it } from 'vitest';
import { blankReturn, returnSchema, type ReturnLineInput } from './return-values.ts';

const id = (n: number) => `0193b1c2-3d4e-7f80-9a1b-${String(n).padStart(12, '0')}`;
const filled = { ...blankReturn(), supplierId: id(1), businessDate: '2026-11-24', locationId: id(2), reason: 'Cracked casing' };
const line = (over: Partial<ReturnLineInput> = {}): ReturnLineInput => ({ receiptLineId: id(81), label: '48 V battery', serialOptions: [],
  batchOptions: [{ batchId: id(31), batchNo: 'B-17', qty: '3' }, { batchId: id(32), batchNo: 'B-18', qty: '2' }], batches: {}, serials: [], ...over });

describe('the supplier return form', () => {
  it('sends a line’s batches and adds them up exactly, leaving empty boxes and shown-only fields out', () => {
    const r = returnSchema.parse({ ...filled, lines: [line({ batches: { [id(31)]: '1.25', [id(32)]: '0.75' } })] });
    expect(r.lines).toEqual([{ receiptLineId: id(81), qty: '2', batches: [{ batchId: id(31), qty: '1.25' }, { batchId: id(32), qty: '0.75' }], serials: [] }]);
    expect(r.notes).toBeNull();
  });

  it('refuses a line with nothing picked, and a bad box, on their own boxes, without throwing', () => {
    expect(returnSchema.safeParse({ ...filled, lines: [line()] }).error?.issues.map((i) => i.path)).toEqual([['lines', 0, 'batches']]);
    expect(returnSchema.safeParse({ ...filled, lines: [line({ batches: { [id(31)]: 'two' } })] }).error?.issues.map((i) => i.path))
      .toEqual([['lines', 0, 'batches', id(31)]]);
  });
});
