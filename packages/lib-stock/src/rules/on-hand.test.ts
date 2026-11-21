// RAD-112 (the architect's ruling): on hand is in less out, by batch, with "batch unknown" (a negative-stock delivery's
// part no batch covered) a row of its own, so the batches always add up to the position.
import { describe, expect, it } from 'vitest';
import { batchQuantities, netQty } from './on-hand.ts';

describe('on hand', () => {
  it('nets in against out, a revaluation moving nothing', () => {
    expect(netQty([{ direction: 'in', qty: '10' }, { direction: 'out', qty: '2.5' }, { direction: 'revalue', qty: '0' }])).toBe('7.500');
    expect(netQty([])).toBe('0.000');
  });

  it('gives each batch its own net, batch unknown included, and the batches add up to the position', () => {
    const rows = [{ batchId: 'a', direction: 'in', qty: '6' }, { batchId: 'a', direction: 'out', qty: '6' }, { batchId: 'b', direction: 'in', qty: '4' },
      { batchId: null, direction: 'out', qty: '1' }];
    expect(batchQuantities(rows)).toEqual([{ batchId: 'b', qty: '4.000' }, { batchId: null, qty: '-1.000' }]);
    expect(netQty(rows)).toBe('3.000');
  });
});
