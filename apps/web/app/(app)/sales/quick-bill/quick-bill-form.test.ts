import { expect, it } from 'vitest';
import { quickBillSchema } from './quick-bill-values.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const line = (over: object = {}) => ({ itemId: id(1), qty: '2', rate: '500.00', discountPercent: '0', pick: { [id(2)]: '2' }, serials: [] as string[], ...over });
const base = { businessDate: '2026-11-22', locationId: id(3), customer: 'counter', partyId: '', notes: '', lines: [line()], payments: [] as object[] };
const pay = (over: object) => ({ method: 'cash', amount: '', accountId: '', reference: '', approvalCode: '', ...over });
const paths = (r: ReturnType<typeof quickBillSchema.safeParse>) => (r.success ? [] : r.error.issues.map((i) => i.path.join('.')));

it('sends the Counter customer as no party, and a named one with its id', () => {
  expect(quickBillSchema.parse(base)).not.toHaveProperty('partyId');
  expect(quickBillSchema.parse({ ...base, customer: 'named', partyId: id(9) })).toHaveProperty('partyId', id(9));
  expect(paths(quickBillSchema.safeParse({ ...base, customer: 'named' }))).toEqual(['partyId']);
});

it('sends each line with its batches, and refuses a line with none on its quantity box', () => {
  expect(quickBillSchema.parse(base).lines[0]).toEqual({ itemId: id(1), qty: '2', rate: '500.00', discountPercent: '0', batches: [{ batchId: id(2), qty: '2' }], serials: [] });
  expect(paths(quickBillSchema.safeParse({ ...base, lines: [line({ pick: {} })] }))).toEqual(['lines.0.qty']);
});

it('sends cash, UPI as a bank payment with its account and reference, and a card by its approval code alone', () => {
  const out = quickBillSchema.parse({ ...base, payments: [
    pay({ amount: '300' }), pay({ method: 'upi', amount: '500', accountId: id(4), reference: 'UTR123' }), pay({ method: 'card', amount: '200', approvalCode: 'A1B2C3' }),
  ] });
  expect(out.payments).toEqual([
    { method: 'cash', amount: '300' }, { method: 'bank', amount: '500', accountId: id(4), reference: 'UTR123' }, { method: 'card', amount: '200', approvalCode: 'A1B2C3' },
  ]);
});

it('asks for what each payment needs, and refuses anything that reads as card digits', () => {
  expect(paths(quickBillSchema.safeParse({ ...base, payments: [pay({})] }))).toEqual(['payments.0.amount']);
  expect(paths(quickBillSchema.safeParse({ ...base, payments: [pay({ method: 'upi', amount: '5' })] }))).toEqual(['payments.0.accountId']);
  expect(paths(quickBillSchema.safeParse({ ...base, payments: [pay({ method: 'card', amount: '5' })] }))).toEqual(['payments.0.approvalCode']);
  expect(paths(quickBillSchema.safeParse({ ...base, payments: [pay({ method: 'card', amount: '5', approvalCode: '4111 1111 1111 1111' })] }))).toEqual(['payments.0.approvalCode']);
  expect(paths(quickBillSchema.safeParse({ ...base, payments: [pay({ method: 'upi', amount: '5', accountId: id(4), reference: '4111111111111111' })] }))).toEqual(['payments.0.reference']);
});
