import { expect, it } from 'vitest';
import { allocateSchema, paymentSchema, sectionLabel } from './payment-values.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const base = { kind: 'receipt', partyId: id(1), businessDate: '2026-11-23', amount: '5000', tds: '', tdsSectionId: '', accountId: id(2), reference: '', narration: '' };
const paths = (r: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) => (r.success ? [] : (r.error?.issues ?? []).map((i) => i.path.join('.')));

it('sends only what was filled in: the TDS, the reference and the narration are left out when empty', () => {
  expect(paymentSchema.parse(base)).toEqual({ kind: 'receipt', partyId: id(1), businessDate: '2026-11-23', amount: '5000', accountId: id(2) });
  expect(paymentSchema.parse({ ...base, tds: '50', reference: 'UTR123', narration: 'Advance' }))
    .toMatchObject({ tds: '50', reference: 'UTR123', narration: 'Advance' });
});

it('sends a payment’s section with any typed check, and no TDS for a payment without one (RAD-158)', () => {
  const payment = { ...base, kind: 'payment' };
  expect(paymentSchema.parse({ ...payment, tdsSectionId: id(5) })).toMatchObject({ tdsSectionId: id(5) });
  expect(paymentSchema.parse({ ...payment, tdsSectionId: id(5), tds: '500' })).toMatchObject({ tdsSectionId: id(5), tds: '500' });
  expect(paths(paymentSchema.safeParse({ ...payment, tdsSectionId: id(5), tds: 'ten' }))).toEqual(['tds']);
  // The box is hidden without a section, so what was typed there is neither checked nor sent.
  expect(paymentSchema.parse({ ...payment, tds: 'ten' })).not.toHaveProperty('tds');
  expect(paymentSchema.parse({ ...base, tdsSectionId: id(5) })).not.toHaveProperty('tdsSectionId');
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

it('names each TDS section with the kind of payee it’s for (auditor-3 on #472)', () => {
  expect(sectionLabel({ code: '194C', name: 'Contractors', payee: 'individual' })).toBe('194C: Contractors (individuals and HUFs)');
  expect(sectionLabel({ code: '194J', name: 'Fees', payee: 'any' })).toBe('194J: Fees (any payee)');
});
