import { expect, it } from 'vitest';
import { holdChoiceState, quickBillSchema, rateAfterPrice, rateFor } from './quick-bill-values.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const line = (over: object = {}) => ({ itemId: id(1), qty: '2', rate: '500.00', discountPercent: '0', pick: { [id(2)]: '2' }, serials: [] as string[], ...over });
const noBuyer = { name: '', phone: '', addressLine1: '', city: '', pincode: '' };
const base = { mode: 'save', buyer: noBuyer, businessDate: '2026-11-22', locationId: id(3), customer: 'counter', partyId: '', notes: '', lines: [line()], payments: [] as object[] };
const pay = (over: object) => ({ method: 'cash', amount: '', accountId: '', reference: '', approvalCode: '', ...over });
const paths = (r: ReturnType<typeof quickBillSchema.safeParse>) => (r.success ? [] : r.error.issues.map((i) => i.path.join('.')));

it('sends the Counter customer as no party, and a named one with its id', () => {
  expect(quickBillSchema.parse(base).bill).not.toHaveProperty('partyId');
  expect(quickBillSchema.parse({ ...base, customer: 'named', partyId: id(9) }).bill).toHaveProperty('partyId', id(9));
  expect(paths(quickBillSchema.safeParse({ ...base, customer: 'named' }))).toEqual(['partyId']);
});

it('sends each line with its batches, and refuses a line with none on its quantity box', () => {
  expect(quickBillSchema.parse(base).bill.lines[0]).toEqual({ itemId: id(1), qty: '2', rate: '500.00', discountPercent: '0', batches: [{ batchId: id(2), qty: '2' }], serials: [] });
  expect(paths(quickBillSchema.safeParse({ ...base, lines: [line({ pick: {} })] }))).toEqual(['lines.0.qty']);
});

it('sends cash, UPI as a bank payment with its account and reference, and a card by its approval code alone', () => {
  const out = quickBillSchema.parse({ ...base, payments: [
    pay({ amount: '300' }), pay({ method: 'upi', amount: '500', accountId: id(4), reference: 'UTR123' }), pay({ method: 'card', amount: '200', approvalCode: 'A1B2C3' }),
  ] });
  expect(out.bill.payments).toEqual([
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

it('fills an empty rate box from the list, replaces what it filled when the list rate changes, and never touches a typed rate', () => {
  expect(rateAfterPrice('', null, '500.00')).toEqual({ rate: '500.00', filled: '500.00' });
  // filled, then the customer or day changes the list rate: the filled rate follows; with no list rate it is cleared
  expect(rateAfterPrice('500.00', '500.00', '450.00')).toEqual({ rate: '450.00', filled: '450.00' });
  expect(rateAfterPrice('500.00', '500.00', null)).toEqual({ rate: '', filled: null });
  // a rate someone typed (or edited) stays
  expect(rateAfterPrice('499.00', '500.00', '450.00')).toEqual({ rate: '499.00', filled: '500.00' });
  expect(rateAfterPrice('499.00', null, '450.00')).toEqual({ rate: '499.00', filled: null });
});

it('starts a new item from an empty box and fills its list rate at once, also when that rate was read before', () => {
  // item A filled 500, then item C whose rate (800) is already known: the old rate goes and 800 is in, in one step
  expect(rateFor(true, '500.00', '500.00', '800.00')).toEqual({ rate: '800.00', filled: '800.00' });
  // a new item with no list rate (or not read yet) leaves the box empty, even if a rate had been typed for the old one
  expect(rateFor(true, '499.00', null, null)).toEqual({ rate: '', filled: null });
  // the same item: a typed rate stays
  expect(rateFor(false, '499.00', '500.00', '800.00')).toEqual({ rate: '499.00', filled: '500.00' });
});

it('sends a held bill with its buyer only on a hold for the Counter customer, and asks for both a name and a mobile', () => {
  const buyer = { ...noBuyer, name: 'Asha', phone: '98765 43210', pincode: '400001' };
  expect(quickBillSchema.parse({ ...base, mode: 'hold', buyer })).toMatchObject({ mode: 'hold', buyer: { name: 'Asha', phone: '98765 43210', pincode: '400001' } });
  // an empty buyer is no buyer: the Counter customer pays in full
  expect(quickBillSchema.parse({ ...base, mode: 'hold' })).not.toHaveProperty('buyer');
  // a save, or a named customer, never carries one
  expect(quickBillSchema.parse({ ...base, buyer })).not.toHaveProperty('buyer');
  expect(quickBillSchema.parse({ ...base, mode: 'hold', customer: 'named', partyId: id(9), buyer })).not.toHaveProperty('buyer');
  expect(paths(quickBillSchema.safeParse({ ...base, mode: 'hold', buyer: { ...noBuyer, name: 'Asha' } }))).toEqual(['buyer.phone']);
  expect(paths(quickBillSchema.safeParse({ ...base, mode: 'hold', buyer: { ...buyer, pincode: '012345' } }))).toEqual(['buyer.pincode']);
});

it('on a hold neither asks for a card’s approval code nor sends it (the code is given when the bill is completed)', () => {
  const card = pay({ method: 'card', amount: '200' });
  expect(quickBillSchema.parse({ ...base, mode: 'hold', payments: [card] }).bill.payments).toEqual([{ method: 'card', amount: '200' }]);
  expect(quickBillSchema.parse({ ...base, mode: 'hold', payments: [{ ...card, approvalCode: 'A1B2C3' }] }).bill.payments).toEqual([{ method: 'card', amount: '200' }]);
  expect(paths(quickBillSchema.safeParse({ ...base, mode: 'save', payments: [card] }))).toEqual(['payments.0.approvalCode']);
});

it('draws the hold choice for a check, a refusal a hold answers, or a balance left by someone who may leave one, and defaults to hold only after a refusal', () => {
  const o = { issues: 0, refused: null, counter: true, mayCredit: true, leftOver: false } as const;
  expect(holdChoiceState(o)).toEqual({ shown: false, holdByDefault: false });
  expect(holdChoiceState({ ...o, issues: 1 })).toEqual({ shown: true, holdByDefault: false });
  expect(holdChoiceState({ ...o, leftOver: true })).toEqual({ shown: true, holdByDefault: false });
  // a balance for a named customer, or for someone who may not leave one, is not this choice's business
  expect(holdChoiceState({ ...o, leftOver: true, counter: false }).shown).toBe(false);
  expect(holdChoiceState({ ...o, leftOver: true, mayCredit: false }).shown).toBe(false);
  // a refused save draws it; an override refusal defaults to hold, a walk-in one only for someone who may leave a balance
  expect(holdChoiceState({ ...o, refused: 'override' })).toEqual({ shown: true, holdByDefault: true });
  expect(holdChoiceState({ ...o, refused: 'walk_in' })).toEqual({ shown: true, holdByDefault: true });
  expect(holdChoiceState({ ...o, refused: 'walk_in', mayCredit: false })).toEqual({ shown: true, holdByDefault: false });
});
