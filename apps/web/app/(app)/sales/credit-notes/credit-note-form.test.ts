import { expect, it } from 'vitest';
import { creditSchema } from './credit-values.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const base = { invoiceId: id(1), kind: 'value', businessDate: '2026-11-20', reason: 'Returned unused', locationId: '', refund: { amount: '', accountId: '' } };
const line = (over: object) => ({ invoiceLineId: id(2), itemId: id(3), label: 'Fan (FAN-1200)', invoiced: '1850.50', taxable: '100.00', qty: '', pick: {}, serials: [] as string[], ...over });

it('credits the lines that have a taxable value, leaves the empty ones out, and writes a value credit with no place or refund', () => {
  const out = creditSchema.parse({ ...base, lines: [line({}), line({ invoiceLineId: id(4), taxable: '' })] });
  expect(out).toEqual({ invoiceId: id(1), kind: 'value', businessDate: '2026-11-20', locationId: null, reason: 'Returned unused', refund: null,
    lines: [{ invoiceLineId: id(2), taxable: '100.00' }] });
});

it('needs at least one credited line, an invoice and a reason, and an amount that is money', () => {
  expect(creditSchema.safeParse({ ...base, lines: [line({ taxable: '' })] }).success).toBe(false);
  expect(creditSchema.safeParse({ ...base, invoiceId: '', lines: [line({})] }).success).toBe(false);
  expect(creditSchema.safeParse({ ...base, reason: '', lines: [line({})] }).success).toBe(false);
  expect(creditSchema.safeParse({ ...base, lines: [line({ taxable: 'ten' })] }).success).toBe(false);
});

it('takes a counter refund with both its amount and its account, or neither', () => {
  const both = creditSchema.parse({ ...base, refund: { amount: '50.00', accountId: id(9) }, lines: [line({})] });
  expect(both.refund).toEqual({ amount: '50.00', accountId: id(9) });
  expect(creditSchema.safeParse({ ...base, refund: { amount: '50.00', accountId: '' }, lines: [line({})] }).success).toBe(false);
  expect(creditSchema.safeParse({ ...base, refund: { amount: '', accountId: id(9) }, lines: [line({})] }).success).toBe(false);
  // The issue is at refund.amount / refund.accountId, where the server's own refusals land too (exceeds_credit, not_money_account).
  const missing = creditSchema.safeParse({ ...base, refund: { amount: '50.00', accountId: '' }, lines: [line({})] });
  expect(missing.success ? [] : missing.error.issues.map((i) => i.path.join('.'))).toEqual(['refund.accountId']);
});

const goods = { ...base, kind: 'goods', locationId: id(8) };

it('writes goods back to a place: the quantity, the batches with a null one for batch unknown, and the serials when there are any', () => {
  const out = creditSchema.parse({ ...goods, lines: [
    line({ taxable: '', qty: '3', pick: { [id(5)]: '2', unknown: '1', [id(6)]: '' } }),
    line({ invoiceLineId: id(4), taxable: '', qty: '2', pick: { [id(7)]: '2' }, serials: ['SN-1', 'SN-2'] }),
    line({ invoiceLineId: id(9), taxable: '', qty: '' }),
  ] });
  expect(out.kind).toBe('goods');
  expect(out.locationId).toBe(id(8));
  expect(out.lines).toEqual([
    { invoiceLineId: id(2), qty: '3', batches: [{ batchId: id(5), qty: '2' }, { batchId: null, qty: '1' }] },
    { invoiceLineId: id(4), qty: '2', batches: [{ batchId: id(7), qty: '2' }], serials: ['SN-1', 'SN-2'] },
  ]);
});

it('needs a place for goods back, and a batch for each line that comes back, refused on the quantity box', () => {
  expect(creditSchema.safeParse({ ...goods, locationId: '', lines: [line({ taxable: '', qty: '1', pick: { [id(5)]: '1' } })] }).success).toBe(false);
  const none = creditSchema.safeParse({ ...goods, lines: [line({ taxable: '', qty: '1', pick: {} })] });
  expect(none.success).toBe(false);
  expect(!none.success && none.error.issues.some((i) => i.path.join('.') === 'lines.0.qty')).toBe(true);
  expect(creditSchema.safeParse({ ...goods, lines: [line({ taxable: '', qty: '' })] }).success).toBe(false);
});

it('refuses batches that do not add up to the quantity, on the quantity box', () => {
  const goods = (qty: string, pick: Record<string, string>) => creditSchema.safeParse({ ...base, kind: 'goods', locationId: id(8), lines: [line({ taxable: '', qty, pick })] });
  expect(goods('2', { [id(5)]: '2' }).success).toBe(true);
  const bad = goods('3', { [id(5)]: '2' });
  expect(bad.success ? [] : bad.error.issues.map((i) => i.path.join('.'))).toEqual(['lines.0.qty']);
});
