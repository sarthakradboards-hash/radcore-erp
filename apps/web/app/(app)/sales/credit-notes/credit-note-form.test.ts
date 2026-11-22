import { expect, it } from 'vitest';
import { creditSchema } from './credit-values.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const base = { invoiceId: id(1), businessDate: '2026-11-20', reason: 'Returned unused', refundAmount: '', refundAccountId: '' };
const line = (over: object) => ({ invoiceLineId: id(2), itemId: id(3), label: 'Fan (FAN-1200)', invoiced: '1850.50', taxable: '100.00', ...over });

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
  const both = creditSchema.parse({ ...base, refundAmount: '50.00', refundAccountId: id(9), lines: [line({})] });
  expect(both.refund).toEqual({ amount: '50.00', accountId: id(9) });
  expect(creditSchema.safeParse({ ...base, refundAmount: '50.00', lines: [line({})] }).success).toBe(false);
  expect(creditSchema.safeParse({ ...base, refundAccountId: id(9), lines: [line({})] }).success).toBe(false);
});
