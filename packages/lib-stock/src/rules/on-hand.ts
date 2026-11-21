// What's on hand, from movement sums (the architect on RAD-112): each direction's total, in less out. Pure, so the
// "batch unknown" row, which only a negative-stock delivery makes, is tested on its own.
import { dec, roundQty, sum, type Quantity } from '@radcore/lib-common';

/** A total of one direction's quantities, for one batch (null: batch unknown) or for the whole place. */
export type DirectionSum = Readonly<{ batchId?: string | null; direction: string; qty: string | null }>;

/** In less out; a revaluation moves no quantity. */
export const netQty = (rows: readonly DirectionSum[]): Quantity =>
  roundQty(sum(rows.map((r) => (r.direction === 'out' ? dec(r.qty ?? '0').neg() : dec(r.qty ?? '0')))), 3);

/** Each batch's net quantity, batch unknown (null) among them, leaving out those at nothing. */
export function batchQuantities(rows: readonly DirectionSum[]): { batchId: string | null; qty: Quantity }[] {
  return [...Map.groupBy(rows, (r) => r.batchId ?? null).entries()]
    .map(([batchId, own]) => ({ batchId, qty: netQty(own) })).filter((b) => !dec(b.qty).eq(0));
}
