import { expect, it } from 'vitest';
import { allocateSchema, paymentSchema } from './payment-values.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const base = { kind: 'receipt', partyId: id(1), businessDate: '2026-11-23', amount: '5000', tds: '', accountId: id(2), reference: '', narration: '' };
const paths = (r: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) => (r.success ? [] : (r.error?.issues ?? []).map((i) => i.path.join('.')));

it('sends only what was filled in: the TDS, the reference and the narration are left out when empty', () => {
  expect(paymentSchema.parse(base)).toEqual({ kind: 'receipt', partyId: id(1), businessDate: '2026-11-23', amount: '5000', accountId: id(2) });
  expect(paymentSchema.parse({ ...base, tds: '50', reference: 'UTR123', narration: 'Advance' }))
    .toMatchObject({ tds: '50', reference: 'UTR123', narration: 'Advance' });
});

it('asks for a party, an amount and an account, and refuses a reference that reads as card digits', () => {
  expect(paths(paymentSchema.safeParse({ ...base, partyId: '', amount: '', accountId: '' })).sort()).toEqual(['accountId', 'amount', 'partyId']);
  expect(paths(paymentSchema.safeParse({ ...base, reference: '4111 1111 1111 1111' }))).toEqual(['reference']);
  expect(paths(paymentSchema.safeParse({ ...base, tds: 'ten' }))).toEqual(['tds']);
  // an amount of nothing is refused, on a payment and on a bill's amount
  expect(paths(paymentSchema.safeParse({ ...base, amount: '0' }))).toEqual(['amount']);
  expect(paths(paymentSchema.safeParse({ ...base, amount: '0.00' }))).toEqual(['amount']);
});

it('applies a receipt to the bills that have an amount, and needs at least one', () => {
  const lines = [
    { documentTable: 'invoices', documentId: id(3), amount: '1200' }, { documentTable: 'invoices', documentId: id(4), amount: '' },
  ];
  expect(allocateSchema.parse({ businessDate: '2026-11-23', lines }).lines).toEqual([{ documentTable: 'invoices', documentId: id(3), amount: '1200' }]);
  expect(paths(allocateSchema.safeParse({ businessDate: '2026-11-23', lines: [lines[1]] }))).toEqual(['lines']);
  expect(paths(allocateSchema.safeParse({ businessDate: '2026-11-23', lines: [{ ...lines[0], amount: 'x' }] }))).toEqual(['lines.0.amount']);
  expect(paths(allocateSchema.safeParse({ businessDate: '2026-11-23', lines: [{ ...lines[0], amount: '0' }] }))).toEqual(['lines.0.amount']);
});
