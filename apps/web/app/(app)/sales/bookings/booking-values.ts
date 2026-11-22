// A booking as its form holds it (RAD-127): the order line and unit, and the advance flat; it goes to the contract with the advance
// nested. The checks are the contract's own.
import { indiaDate } from '@radcore/lib-common';
import { createBooking } from '@radcore/lib-sales/contract';
import { z } from 'zod';
import { t } from '../../../../lib/i18n/index.ts';

const shape = createBooking.input.shape;
const advance = shape.advance.shape;

export const bookingSchema = z.object({
  orderLineId: z.string().min(1, t('sales.booking.form.line.none')).pipe(shape.orderLineId),
  serialNo: shape.serialNo,
  amount: advance.amount,
  accountId: z.string().min(1, t('sales.booking.advance.account.none')).pipe(advance.accountId),
  businessDate: advance.businessDate,
}).transform((v) => ({ orderLineId: v.orderLineId, serialNo: v.serialNo,
  advance: { amount: v.amount, accountId: v.accountId, businessDate: v.businessDate } }));
export type BookingInput = z.input<typeof bookingSchema>;
export type BookingValues = z.output<typeof bookingSchema>;

export const NEW_BOOKING: BookingInput = { orderLineId: '', serialNo: '', amount: '', accountId: '', businessDate: indiaDate(new Date()) };
