import { expect, it } from 'vitest';
import { bookingSchema } from './booking-values.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const base = { orderLineId: id(1), serialNo: ' MD2-001 ', amount: '5000', accountId: id(2), businessDate: '2026-11-22' };

it('sends the advance nested, with the serial number trimmed', () => {
  expect(bookingSchema.parse(base)).toEqual({
    orderLineId: id(1), serialNo: 'MD2-001', advance: { amount: '5000', accountId: id(2), businessDate: '2026-11-22' },
  });
});

it('asks for a line, a serial number, an amount and an account before it can be sent', () => {
  const bad = bookingSchema.safeParse({ ...base, orderLineId: '', serialNo: '', amount: '', accountId: '' });
  expect(bad.success ? [] : bad.error.issues.map((i) => i.path[0]).sort()).toEqual(['accountId', 'amount', 'orderLineId', 'serialNo']);
});
