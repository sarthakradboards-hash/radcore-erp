import { expect, it } from 'vitest';
import { candidateLabel, chargeAccounts, matchTotals } from './match-values.ts';

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

it('totals each side of a several-line match, signed by direction, and balances only when both sides have lines and agree', () => {
  const out = (amount: string) => ({ direction: 'out' as const, amount });
  const into = (amount: string) => ({ direction: 'in' as const, amount });
  // Two payments out of the bank, one statement line for both.
  expect(matchTotals([out('7500.00')], [out('4500.00'), out('3000.00')])).toMatchObject({ balanced: true, difference: '0.00' });
  expect(matchTotals([out('7500.00')], [out('4500.00')])).toMatchObject({ balanced: false, difference: '3000.00' });
  // A deposit and a withdrawal net off against one receipt.
  expect(matchTotals([into('1000.00'), out('100.00')], [into('900.00')]).balanced).toBe(true);
  expect(matchTotals([], [into('900.00')]).balanced).toBe(false);
  expect(matchTotals([into('0.10'), into('0.20')], [into('0.30')]).balanced).toBe(true);
});

it('offers a charge the switched-on ordinary expense accounts, and interest the income ones', () => {
  const a = (id: string, type: 'expense' | 'income', controlKind: 'none' | 'party' = 'none', active = true) => ({ id, type, controlKind, active });
  const all = [a('charges', 'expense'), a('off', 'expense', 'none', false), a('control', 'expense', 'party'), a('interest', 'income')];
  expect(chargeAccounts(all, 'out').map((x) => x.id)).toEqual(['charges']);
  expect(chargeAccounts(all, 'in').map((x) => x.id)).toEqual(['interest']);
});
