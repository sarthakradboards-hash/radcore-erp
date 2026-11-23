// RAD-137's contracts (ADR-008 §6, §13): arrivals recorded under inward:write, QC and posting and cancelling under
// inward:qc, read under purchasing:read; and the codes RAD-134's guard needs declared where a route can reach them.
import { describe, expect, it } from 'vitest';
import * as receipts from './receipts.ts';

const routes = Object.values(receipts);
const keyOf = (method: string, path: string) => routes.find((c) => c.method === method && c.path === path)?.perm;
const id = '3f2b8c9e-1d4a-4f6b-9c2e-7a1b5d3e9f01';

describe('the goods receipt contracts', () => {
  it('read under purchasing:read, record arrivals under inward:write, and post or cancel under inward:qc', () => {
    expect(routes.filter((c) => c.method === 'GET').every((c) => c.perm === 'purchasing:read')).toBe(true);
    expect(['POST /purchasing/receipts', 'PUT /purchasing/receipts/:id', 'DELETE /purchasing/receipts/:id']
      .map((r) => keyOf(...(r.split(' ') as [string, string])))).toEqual(Array(3).fill('inward:write'));
    expect([keyOf('POST', '/purchasing/receipts/:id/post'), keyOf('POST', '/purchasing/receipts/:id/cancel')]).toEqual(['inward:qc', 'inward:qc']);
    expect(routes.every((c) => c.tx.readOnly === (c.method === 'GET'))).toBe(true);
  });

  it('declare the refusals §6 names on the routes that reach them (RAD-134)', () => {
    expect(receipts.createGoodsReceipt.errors).toEqual(expect.arrayContaining(['over_ordered', 'not_a_rejects_place', 'place_not_sellable',
      'order_not_placed', 'date_before_source']));
    expect(receipts.postGoodsReceipt.errors).toEqual(expect.arrayContaining(['serial_sold', 'serial_in_stock', 'qc_mismatch',
      'reject_reason_required', 'chassis_required', 'over_ordered']));
    expect(receipts.cancelGoodsReceipt.errors).toContain('receipt_in_use');
  });

  it('take an arrival only with a line, and QC split by batch with serials accepted or rejected', () => {
    const arrival = { orderId: id, businessDate: '2026-11-15', locationId: id, rejectsLocationId: id, supplierRef: 'DC-17', notes: null,
      lines: [{ orderLineId: id, received: '3' }] };
    expect(receipts.createGoodsReceipt.input.safeParse(arrival).success).toBe(true);
    expect(receipts.createGoodsReceipt.input.safeParse({ ...arrival, lines: [] }).success).toBe(false);
    const qc = { id, lines: [{ lineId: id, batches: [{ batchNo: null, accepted: '2', rejected: '1' }], rejectReason: 'Dented',
      serials: [{ serialNo: 'S-0005', chassisNo: null, batchNo: null, rejected: true }] }] };
    expect(receipts.postGoodsReceipt.input.safeParse(qc).success).toBe(true);
    expect(receipts.postGoodsReceipt.input.safeParse({ id, lines: [{ ...qc.lines[0], batches: [] }] }).success).toBe(false);
  });
});
