import { expect, it } from 'vitest';
import { candidateLabel } from './match-values.ts';

const base = { journalLineId: '00000000-0000-4000-8000-000000000001', entryId: '00000000-0000-4000-8000-000000000002',
  entryNumber: 'JV/26-27/00012', kind: 'payment_out', businessDate: '2026-11-03', source: { table: 'payments', id: '00000000-0000-4000-8000-000000000003' },
  reference: 'UTR123', party: 'Shree Transport', byReference: false, byParty: null, daysApart: 0 } as const;

it('names each candidate by its entry, kind, date and party, with the best reason it was offered', () => {
  expect(candidateLabel({ ...base, byReference: true })).toMatch(/^JV\/26-27\/00012, Payment made, .+, Shree Transport: the reference matches$/);
  expect(candidateLabel({ ...base, byParty: 'whole' })).toMatch(/: the party’s name is in the narration$/);
  expect(candidateLabel({ ...base, byParty: 'word', party: null })).toMatch(/^JV\/26-27\/00012, Payment made, [^,]+: a word of the party’s name/);
  expect(candidateLabel({ ...base, daysApart: 1 })).toMatch(/: 1 day apart$/);
  expect(candidateLabel({ ...base, daysApart: 3, kind: 'something_new' })).toMatch(/^JV\/26-27\/00012, something_new, .+: 3 days apart$/);
});
