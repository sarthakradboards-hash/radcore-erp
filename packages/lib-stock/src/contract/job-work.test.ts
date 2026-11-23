// RAD-142's contracts (ADR-008 §11, §13): job work sent and received under job_work:write, read and printed under
// stock:read; and the codes RAD-134's guard needs declared where a route can reach them.
import { describe, expect, it } from 'vitest';
import * as jobWork from './job-work.ts';

type Route = { method: string; path: string; perm: string | null; tx: { readOnly: boolean }; errors: readonly string[] };
const routes: Route[] = Object.values(jobWork);
const ID = '3f2b8c9e-1d4a-4f6b-9c2e-7a1b5d3e9f01';
const part = (qty: string, serials: string[] = []) => ({ qty, batches: qty === '0' ? [] : [{ batchId: null, qty }], serials });

describe('the job work contracts', () => {
  it('read and print under stock:read, and send, receive or cancel under job_work:write', () => {
    expect(routes.filter((c) => c.method === 'GET').every((c) => c.perm === 'stock:read')).toBe(true);
    expect(routes.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path} ${String(c.perm)}`)).toEqual([
      'POST /stock/job-work/challans job_work:write', 'POST /stock/job-work/challans/:id/cancel job_work:write',
      'POST /stock/job-work/receipts job_work:write', 'POST /stock/job-work/receipts/:id/cancel job_work:write',
    ]);
    expect(routes.every((c) => c.tx.readOnly === (c.method === 'GET'))).toBe(true);
  });

  it('declare each refusal on the route that makes it (RAD-134)', () => {
    // No challan from rejects or from a job worker's place, and only to a party with a job work place (§11; the
    // architect on RAD-141).
    expect(jobWork.createJobWorkChallan.errors).toEqual(expect.arrayContaining(['needs_qc', 'use_job_work', 'no_job_work_place',
      'unknown_party', 'units_mismatch', 'series_full']));
    expect(jobWork.cancelJobWorkChallan.errors).toEqual(expect.arrayContaining(['challan_answered', 'date_before_source']));
    // A serialised output without its serials, more than the challan line sent, and a date before the challan (RC-130).
    expect(jobWork.createJobWorkReceipt.errors).toEqual(expect.arrayContaining(['units_mismatch', 'over_challan', 'not_on_challan',
      'made_without_use', 'date_before_source', 'series_full']));
    expect(jobWork.cancelJobWorkReceipt.errors).toEqual(expect.arrayContaining(['goods_moved_on', 'charges_billed']));
    expect(jobWork.printJobWorkChallan.errors).toContain('wrong_status');
  });

  it('take a challan only with a line, and F16’s receipt: 3 made from 3 used, 1 lost, at 150.00 a frame', () => {
    const challan = { fromId: ID, partyId: ID, businessDate: '2026-11-15', notes: null, lines: [{ itemId: ID, ...part('4') }] };
    expect(jobWork.createJobWorkChallan.input.safeParse(challan).success).toBe(true);
    expect(jobWork.createJobWorkChallan.input.safeParse({ ...challan, lines: [] }).success).toBe(false);
    const line = { challanLineId: ID, made: { itemId: ID, qty: '3', chargeRate: '150', serials: [] }, used: part('3'), back: part('0'),
      lost: part('1') };
    const receipt = { challanId: ID, locationId: ID, businessDate: '2026-11-20', notes: null, lines: [line] };
    expect(jobWork.createJobWorkReceipt.input.safeParse(receipt).success).toBe(true);
    // A line that only takes inputs back makes nothing.
    expect(jobWork.createJobWorkReceipt.input.safeParse({ ...receipt, lines: [{ ...line, made: null, used: part('0'), back: part('4'),
      lost: part('0') }] }).success).toBe(true);
    expect(jobWork.cancelJobWorkReceipt.input.safeParse({ id: ID, businessDate: '2026-11-21', reason: ' ' }).success).toBe(false);
  });
});
