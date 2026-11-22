import { expect, it } from 'vitest';
import { rideSchema } from './ride-values.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const base = { leadId: id(1), itemId: id(2), serialNo: ' DEMO-7 ', scheduledAt: '2026-11-24T15:30', note: '  ' };

it('sends India wall time as the UTC moment, the serial number trimmed, and an empty note left out', () => {
  expect(rideSchema.parse(base)).toEqual({ leadId: id(1), itemId: id(2), serialNo: 'DEMO-7', scheduledAt: '2026-11-24T10:00:00.000Z' });
});

it('asks for a lead, a model, a serial number and a time before it can be sent', () => {
  const bad = rideSchema.safeParse({ ...base, leadId: '', itemId: '', serialNo: '', scheduledAt: 'soon' });
  expect(bad.success ? [] : bad.error.issues.map((i) => i.path[0]).sort()).toEqual(['itemId', 'leadId', 'scheduledAt', 'serialNo']);
});
