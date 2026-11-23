import { expect, it } from 'vitest';
import { arrivalSchema, leftToCome } from './arrival-values.ts';
import { qcSchema, qcStart } from './qc-values.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const paths = (r: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) => (r.success ? [] : (r.error?.issues ?? []).map((i) => i.path.join('.')));

const arrival = {
  orderId: id(1), businessDate: '2026-11-23', locationId: id(2), rejectsLocationId: id(3), supplierRef: '', notes: '',
  lines: [{ orderLineId: id(4), label: 'Hub motor (HM-1)', info: '', received: '3' }],
};

it('sends an arrival with empty boxes as nulls and each line as the order line and its quantity', () => {
  expect(arrivalSchema.parse(arrival)).toEqual({
    orderId: id(1), businessDate: '2026-11-23', locationId: id(2), rejectsLocationId: id(3), supplierRef: null, notes: null,
    lines: [{ orderLineId: id(4), received: '3' }],
  });
  expect(arrivalSchema.parse({ ...arrival, supplierRef: ' DC-17 ' }).supplierRef).toBe('DC-17');
});

it('asks for an order, both places and a quantity more than nothing on each line, and at least one line', () => {
  expect(paths(arrivalSchema.safeParse({ ...arrival, orderId: '', locationId: '', rejectsLocationId: '' })).sort()).toEqual(['locationId', 'orderId', 'rejectsLocationId']);
  expect(paths(arrivalSchema.safeParse({ ...arrival, lines: [{ ...arrival.lines[0]!, received: '0' }] }))).toEqual(['lines.0.received']);
  expect(paths(arrivalSchema.safeParse({ ...arrival, lines: [{ ...arrival.lines[0]!, received: '' }] }))).toEqual(['lines.0.received']);
  expect(paths(arrivalSchema.safeParse({ ...arrival, lines: [] }))).toEqual(['lines']);
});

it('starts the quantity at what is left on the order line, and at nothing when none is', () => {
  expect(leftToCome('10.000', '4.000')).toBe('6');
  expect(leftToCome('10', '10')).toBe('');
  expect(leftToCome('10', '12')).toBe('');
});

const received = [{ id: id(5), itemId: id(6), name: 'Hub motor', sku: 'HM-1', received: '5.000' }];

it('starts QC with the whole received quantity accepted in one batch of the receipt’s own', () => {
  const start = qcStart(received);
  expect(start.lines[0]).toMatchObject({ lineId: id(5), itemId: id(6), label: 'Hub motor (HM-1)', batches: [{ batchNo: '', accepted: '5', rejected: '' }] });
  expect(qcSchema.parse(start)).toEqual({ lines: [{ lineId: id(5), batches: [{ batchNo: null, accepted: '5', rejected: '0' }], serials: [], rejectReason: null }] });
});

it('splits a line by batch, with units, and sends empty boxes as nulls', () => {
  const start = qcStart(received).lines[0]!;
  const done = qcSchema.parse({ lines: [{ ...start, rejectReason: 'Dented', batches: [
    { batchNo: 'B-1', accepted: '3', rejected: '' }, { batchNo: 'B-2', accepted: '1', rejected: '1' },
  ], serials: [{ serialNo: 'S-1', chassisNo: '', batchNo: 'B-1', rejected: false }, { serialNo: 'S-2', chassisNo: 'CH-2', batchNo: '', rejected: true }] }] });
  expect(done.lines[0]).toEqual({ lineId: id(5), rejectReason: 'Dented',
    batches: [{ batchNo: 'B-1', accepted: '3', rejected: '0' }, { batchNo: 'B-2', accepted: '1', rejected: '1' }],
    serials: [{ serialNo: 'S-1', chassisNo: null, batchNo: 'B-1', rejected: false }, { serialNo: 'S-2', chassisNo: 'CH-2', batchNo: null, rejected: true }] });
});

it('shows a split that does not add up on the first batch, a missing reason on its box and a unit without a serial on the unit', () => {
  const start = qcStart(received).lines[0]!;
  expect(paths(qcSchema.safeParse({ lines: [{ ...start, batches: [{ batchNo: '', accepted: '3', rejected: '' }] }] }))).toEqual(['lines.0.batches.0.accepted']);
  expect(paths(qcSchema.safeParse({ lines: [{ ...start, batches: [{ batchNo: '', accepted: '4', rejected: '1' }] }] }))).toEqual(['lines.0.rejectReason']);
  expect(paths(qcSchema.safeParse({ lines: [{ ...start, serials: [{ serialNo: ' ', chassisNo: '', batchNo: '', rejected: false }] }] }))).toEqual(['lines.0.serials.0.serialNo']);
  expect(paths(qcSchema.safeParse({ lines: [{ ...start, batches: [{ batchNo: '', accepted: 'x', rejected: '' }] }] }))).toEqual(['lines.0.batches.0.accepted']);
});
