import { expect, it } from 'vitest';
import { deliverySchema } from './delivery-values.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const base = { orderId: id(1), locationId: id(2), businessDate: '2026-11-20', notes: '' };
const line = (over: object) => ({ orderLineId: id(3), itemId: id(4), qty: '2', pick: { [id(5)]: '2' }, serials: [] as string[], ...over });

it('sends each batch with a quantity, "batch unknown" as a null batch, and leaves the empty boxes out', () => {
  const out = deliverySchema.parse({ ...base, lines: [line({ qty: '3', pick: { [id(5)]: '2', unknown: '1', [id(6)]: '' } })] });
  expect(out.lines[0]).toEqual({ orderLineId: id(3), qty: '3', batches: [{ batchId: id(5), qty: '2' }, { batchId: null, qty: '1' }], serials: [] });
  expect(out.notes).toBeNull();
});

it('refuses a line that names no batch, and a quantity that isn\'t one, on the line', () => {
  const none = deliverySchema.safeParse({ ...base, lines: [line({ pick: { [id(5)]: '' } })] });
  expect(none.success).toBe(false);
  const bad = deliverySchema.safeParse({ ...base, lines: [line({ pick: { [id(5)]: 'two' } })] });
  expect(bad.success).toBe(false);
});

it('needs an order, a place and at least one line', () => {
  expect(deliverySchema.safeParse({ ...base, orderId: '', lines: [line({})] }).success).toBe(false);
  expect(deliverySchema.safeParse({ ...base, locationId: '', lines: [line({})] }).success).toBe(false);
  expect(deliverySchema.safeParse({ ...base, lines: [] }).success).toBe(false);
});

it('carries the serials picked', () => {
  const out = deliverySchema.parse({ ...base, lines: [line({ qty: '2', serials: ['SN-1', 'SN-2'] })] });
  expect(out.lines[0]?.serials).toEqual(['SN-1', 'SN-2']);
});
