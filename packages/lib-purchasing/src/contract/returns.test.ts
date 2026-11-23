// RAD-140's contracts (ADR-008 §8, §13): read under purchasing:read, every change under supplier_returns:write, the
// debit note's print under purchasing:read; and the codes RAD-134's guard needs declared where a route can reach them.
import { describe, expect, it } from 'vitest';
import * as returns from './returns.ts';

const routes = Object.values(returns);
const id = '3f2b8c9e-1d4a-4f6b-9c2e-7a1b5d3e9f01';

describe('the supplier return contracts', () => {
  it('read and print under purchasing:read, and change under supplier_returns:write', () => {
    expect(routes.filter((c) => c.method === 'GET').every((c) => c.perm === 'purchasing:read')).toBe(true);
    expect(routes.filter((c) => c.method !== 'GET').every((c) => c.perm === 'supplier_returns:write')).toBe(true);
    expect(routes.every((c) => c.tx.readOnly === (c.method === 'GET'))).toBe(true);
    expect(returns.printSupplierReturn.path).toBe('/purchasing/returns/:id/pdf');
  });

  it('declare the refusals §8 names on the routes that reach them (RAD-134)', () => {
    expect(returns.createSupplierReturn.errors).toEqual(expect.arrayContaining(['not_a_rejects_place', 'over_received', 'other_supplier',
      'receipt_not_posted']));
    expect(returns.postSupplierReturn.errors).toEqual(expect.arrayContaining(['date_before_source', 'not_enough_stock', 'units_mismatch',
      'over_received', 'series_full']));
    expect(returns.cancelSupplierReturn.errors).toEqual(expect.arrayContaining(['replacement_received', 'still_applied']));
  });

  it('take a return only with a line, each named in its batches', () => {
    const draft = { supplierId: id, businessDate: '2026-11-20', locationId: id, reason: 'Dented in transit', notes: null,
      lines: [{ receiptLineId: id, qty: '1', batches: [{ batchId: id, qty: '1' }], serials: ['S-0005'] }] };
    expect(returns.createSupplierReturn.input.safeParse(draft).success).toBe(true);
    expect(returns.createSupplierReturn.input.safeParse({ ...draft, lines: [] }).success).toBe(false);
    expect(returns.createSupplierReturn.input.safeParse({ ...draft, lines: [{ ...draft.lines[0], batches: [] }] }).success).toBe(false);
    expect(returns.updateSupplierReturn.input.safeParse({ ...draft, id }).success).toBe(true);
  });
});
