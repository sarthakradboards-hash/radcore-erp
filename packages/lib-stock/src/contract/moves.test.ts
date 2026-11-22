// RAD-141's contracts (ADR-008 §9, §10, §13): transfers under stock:move, counts and adjustments drafted under
// stock:count and approved or cancelled under stock:approve, all read under stock:read; and the codes RAD-134's guard
// needs declared where a route can reach them.
import { describe, expect, it } from 'vitest';
import * as moves from './moves.ts';

type Route = { method: string; path: string; perm: string | null; tx: { readOnly: boolean } };
// Each contract, and each route of an approval's bundle (approvalContracts).
const routes: Route[] = Object.values(moves).flatMap((c): Route[] => ('path' in c ? [c] : Object.values(c)));
const keyOf = (method: string, path: string) => routes.find((c) => c.method === method && c.path === path)?.perm;

describe('the stock moves contracts', () => {
  it('read under stock:read, move under stock:move, count under stock:count, and approve or cancel under stock:approve', () => {
    expect(routes.filter((c) => c.method === 'GET' && !c.path.startsWith('/approvals/')).every((c) => c.perm === 'stock:read')).toBe(true);
    expect([keyOf('POST', '/stock/transfers'), keyOf('POST', '/stock/transfers/:id/cancel')]).toEqual(['stock:move', 'stock:move']);
    expect(['POST /stock/counts', 'PUT /stock/counts/:id', 'DELETE /stock/counts/:id', 'POST /stock/counts/:id/approval',
      'POST /stock/adjustments', 'PUT /stock/adjustments/:id', 'DELETE /stock/adjustments/:id', 'POST /stock/adjustments/:id/approval']
      .map((r) => keyOf(...(r.split(' ') as [string, string])))).toEqual(Array(8).fill('stock:count'));
    expect([keyOf('POST', '/stock/counts/:id/cancel'), keyOf('POST', '/stock/adjustments/:id/cancel'),
      keyOf('POST', '/approvals/stock-count/:id/decision'), keyOf('POST', '/approvals/stock-adjustment/:id/decision')])
      .toEqual(Array(4).fill('stock:approve'));
    expect(routes.every((c) => c.tx.readOnly === (c.method === 'GET'))).toBe(true);
  });

  it('declare a transfer’s refusals on the route that makes it (RAD-134), and the undo’s on its cancel', () => {
    expect(moves.createStockTransfer.errors).toEqual(expect.arrayContaining(['transfer_same_location', 'needs_qc', 'use_job_work']));
    expect(moves.cancelStockTransfer.errors).toContain('goods_moved_on');
    expect(moves.createStockCount.errors).toEqual(expect.arrayContaining(['serial_elsewhere', 'counted_in_future']));
  });

  it('take a transfer only with a reason and a line, and a count at a moment', () => {
    const id = '3f2b8c9e-1d4a-4f6b-9c2e-7a1b5d3e9f01';
    const line = { itemId: id, qty: '1', batches: [{ batchId: null, qty: '1' }], serials: [] };
    const transfer = { fromId: id, toId: id, businessDate: '2026-11-15', reason: 'To the floor', requalified: null, lines: [line] };
    expect(moves.createStockTransfer.input.safeParse(transfer).success).toBe(true);
    expect(moves.createStockTransfer.input.safeParse({ ...transfer, reason: ' ' }).success).toBe(false);
    expect(moves.createStockTransfer.input.safeParse({ ...transfer, lines: [] }).success).toBe(false);
    const count = { locationId: id, countedAt: '2026-11-15T08:30:00Z', businessDate: '2026-11-15', reason: 'Month end',
      lines: [{ itemId: id, batchId: null, qty: '2', serials: [] }] };
    expect(moves.createStockCount.input.safeParse(count).success).toBe(true);
    expect(moves.createStockCount.input.safeParse({ ...count, countedAt: '2026-11-15' }).success).toBe(false);
  });
});
