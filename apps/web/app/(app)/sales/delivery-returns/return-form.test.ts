import { expect, it } from 'vitest';
import { returnSchema } from './return-values.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const base = { deliveryId: id(1), locationId: id(2), businessDate: '2026-11-20', notes: '' };
const line = (over: object) => ({ deliveryLineId: id(3), itemId: id(4), qty: '1', pick: { [id(5)]: '1' }, serials: [] as string[], ...over });

it('sends each batch the goods go back into with its quantity, "batch unknown" as a null batch, and leaves empty boxes out', () => {
  const out = returnSchema.parse({ ...base, lines: [line({ qty: '3', pick: { [id(5)]: '2', unknown: '1', [id(6)]: '' } })] });
  expect(out.lines[0]).toEqual({ deliveryLineId: id(3), qty: '3', batches: [{ batchId: id(5), qty: '2' }, { batchId: null, qty: '1' }], serials: [] });
  expect(out.notes).toBeNull();
});

it('refuses a line that names no batch, and a quantity that isn’t one', () => {
  const none = returnSchema.safeParse({ ...base, lines: [line({ pick: { [id(5)]: '' } })] });
  expect(none.success).toBe(false);
  // The refusal sits on the line's quantity box, which is always drawn: the form never shows a bare path.
  expect(!none.success && none.error.issues.some((i) => i.path.join('.') === 'lines.0.qty')).toBe(true);
  expect(returnSchema.safeParse({ ...base, lines: [line({ pick: { [id(5)]: 'one' } })] }).success).toBe(false);
});

it('needs a delivery, a place and a line, and carries the serials coming back', () => {
  expect(returnSchema.safeParse({ ...base, deliveryId: '', lines: [line({})] }).success).toBe(false);
  expect(returnSchema.safeParse({ ...base, locationId: '', lines: [line({})] }).success).toBe(false);
  expect(returnSchema.safeParse({ ...base, lines: [] }).success).toBe(false);
  expect(returnSchema.parse({ ...base, lines: [line({ qty: '2', serials: ['SN-1', 'SN-2'] })] }).lines[0]?.serials).toEqual(['SN-1', 'SN-2']);
});
