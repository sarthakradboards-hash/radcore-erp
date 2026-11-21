// Vehicle bookings (M3-13, RAD-117; ADR-007 §5; the architect's rulings on RAD-117). A booking holds one unit for a
// confirmed order line of quantity 1, promised to that line (a `reserved` unit event, so the stock engine knows the
// hold, RC-122), and takes its advance as a receipt held for it (lib-accounts' recordHeldReceipt), read live.
// - Making one, in ADR-006 §1's order: the period, the order, the booking, the lead, the party, the unit, numbering.
// - Cancelling one says what becomes of what's left of its advance (RC-127): refunded in full under
//   bookings:refund_full, in part under bookings:refund_part, or left as the customer's credit. Each refund is judged
//   against what's left at that moment, under the booking's row lock, after the period's, refunds still waiting for
//   approval counted as gone, so part refunds can't add up to all of it (the architect's two build rules). Then
//   lib-accounts' route-less refundHeld, one refund per receipt, each within its own cap.
// - Its delivery's side (the booking delivered, the hold ended) is in booking-holds.ts.
import { after, salesOrderLines, salesOrders, salesTx, vehicleBookings } from '@radcore/db/sales';
import { heldLeft, holdParty, holdPeriod, recordHeldReceipt, refundHeld } from '@radcore/lib-accounts';
import { dec, roundMoney } from '@radcore/lib-common';
import { bookingCancelled, bookingMade, holdLead } from '@radcore/lib-crm';
import {
  AppError, decodeCursor, defineSeries, encodeCursor, listScope, nextNumber, type Ctx,
} from '@radcore/lib-platform';
import { checkPlace, postUnitEvents, releasePromises, unitFor } from '@radcore/lib-stock';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type {
  addBookingAdvance, BOOKING_STATUSES, cancelBooking, createBooking, getBooking, listBookings, refundBooking,
} from '../contract.ts';
import { otherLiveBooking } from './booking-holds.ts';
import { checkDate } from './document-rules.ts';
import { today } from './document-lines.ts';
import { partyNames } from './party-names.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;
type Status = (typeof BOOKING_STATUSES)[number];

/** Bookings' numbers: BK/26-27/00001, drawn when one is made. */
export const BOOKING_SERIES = defineSeries('sales.booking', 'BK', { digits: 5, label: 'Vehicle bookings' });

const TABLE = 'vehicle_bookings';
const heldFor = (id: string) => ({ table: TABLE, id });
const notFound = () => new AppError('not_found', 'There is no such booking');
const own = { id: vehicleBookings.id, number: vehicleBookings.number, orderId: vehicleBookings.orderId,
  orderLineId: vehicleBookings.orderLineId, itemId: vehicleBookings.itemId, serialNo: vehicleBookings.serialNo,
  leadId: vehicleBookings.leadId, businessDate: vehicleBookings.businessDate, status: vehicleBookings.status };
const header = { ...own, partyId: salesOrders.partyId };
const PAGE_KEY = z.object({ date: z.iso.date(), id: z.uuid() });

/** The booking, locked when it's to be written, within the principal's scope for `permission` (else not_found), with its
 * order's party. Only the booking's row is locked: the order is read apart. */
async function bookingOf(ctx: Ctx, id: string, permission: string, forUpdate = false) {
  const q = salesTx(ctx).select({ ...own, cancelReason: vehicleBookings.cancelReason, owner: vehicleBookings.createdBy })
    .from(vehicleBookings).where(eq(vehicleBookings.id, id));
  const [row] = forUpdate ? await q.for('update') : await q;
  if (row === undefined) throw notFound();
  const { owner, ...booking } = row;
  ctx.see(permission, { owner });
  const [order] = await salesTx(ctx).select({ partyId: salesOrders.partyId }).from(salesOrders).where(eq(salesOrders.id, booking.orderId));
  if (order === undefined) throw new Error(`booking ${id}'s order is gone`);
  return { ...booking, partyId: order.partyId, status: booking.status as Status };
}

/** GET /sales/bookings (bookings:read): newest first, a page at a time, the principal's own when that's their scope. */
export async function listBookingsPage(ctx: Ctx, input: In<typeof listBookings>): Promise<Out<typeof listBookings>> {
  const key = input.after === undefined ? undefined : decodeCursor(PAGE_KEY, input.after);
  const f = input.filter;
  const rows = await salesTx(ctx).select(header).from(vehicleBookings).innerJoin(salesOrders, eq(salesOrders.id, vehicleBookings.orderId))
    .where(and(
      f.status === undefined ? undefined : eq(vehicleBookings.status, f.status),
      f.orderId === undefined ? undefined : eq(vehicleBookings.orderId, f.orderId),
      f.leadId === undefined ? undefined : eq(vehicleBookings.leadId, f.leadId),
      listScope(ctx, 'bookings:read', vehicleBookings.createdBy),
      after([vehicleBookings.businessDate, vehicleBookings.id], key && [key.date, key.id], 'desc'),
    )).orderBy(desc(vehicleBookings.businessDate), desc(vehicleBookings.id)).limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const names = await partyNames(ctx, page.map((r) => r.partyId));
  const last = page.at(-1);
  return {
    items: page.map((r) => ({ ...r, status: r.status as Status, partyName: names.get(r.partyId) ?? '' })),
    next: rows.length > input.limit && last ? encodeCursor({ date: last.businessDate, id: last.id }) : null,
  };
}

/** GET /sales/bookings/:id (bookings:read). */
export async function getBookingById(ctx: Ctx, { id }: In<typeof getBooking>): Promise<Out<typeof getBooking>> {
  const b = await bookingOf(ctx, id, 'bookings:read');
  const { taken, left } = await heldLeft(ctx, heldFor(id));
  const names = await partyNames(ctx, [b.partyId]);
  return { ...b, partyName: names.get(b.partyId) ?? '', advance: { taken, left } };
}

const positive = (amount: string) => {
  if (!dec(amount).gt(0)) throw new AppError('advance_required', 'An advance is more than 0', [{ path: ['amount'], code: 'too_small', message: 'Enter an amount' }]);
};

/** POST /sales/bookings (bookings:write). */
export async function addBooking(ctx: Ctx, input: In<typeof createBooking>): Promise<Out<typeof createBooking>> {
  const { advance } = input;
  positive(advance.amount);
  checkDate(advance.businessDate, today());
  await holdPeriod(ctx, advance.businessDate);
  const tx = salesTx(ctx);
  // The order, locked, within the principal's sight, then its line.
  const [line] = await tx.select({ orderId: salesOrderLines.orderId, itemId: salesOrderLines.itemId, qty: salesOrderLines.qty })
    .from(salesOrderLines).where(eq(salesOrderLines.id, input.orderLineId));
  if (line === undefined) throw new AppError('not_found', 'There is no such order line');
  const [order] = await tx.select({ status: salesOrders.status, partyId: salesOrders.partyId, owner: salesOrders.createdBy })
    .from(salesOrders).where(eq(salesOrders.id, line.orderId)).for('update');
  if (order === undefined) throw new AppError('not_found', 'There is no such order line');
  ctx.see('sales:read', { owner: order.owner });
  // Again under the order's lock: a rewrite committed since the first read may have replaced the line (auditor-2 on #286).
  const [still] = await tx.select({ id: salesOrderLines.id }).from(salesOrderLines).where(eq(salesOrderLines.id, input.orderLineId));
  if (still === undefined) throw new AppError('not_found', 'There is no such order line');
  if (order.status !== 'confirmed') throw new AppError('wrong_status', `This order is ${order.status}: only a confirmed order's line is booked`);
  if (!dec(line.qty).eq(1)) {
    throw new AppError('booking_one_unit', 'A booking holds one vehicle: book a line of quantity 1',
      [{ path: ['orderLineId'], code: 'booking_one_unit', message: 'Split the line into lines of 1' }]);
  }
  // The booking: one live booking per line, its unique index the lock on the line.
  const [made] = await tx.insert(vehicleBookings).values({ orderId: line.orderId, orderLineId: input.orderLineId, itemId: line.itemId,
    serialNo: input.serialNo, leadId: input.leadId ?? null, businessDate: advance.businessDate })
    .onConflictDoNothing().returning({ id: vehicleBookings.id });
  if (made === undefined) throw new AppError('line_booked', 'This order line is booked already', [{ path: ['orderLineId'], code: 'line_booked', message: 'Cancel its booking first' }]);
  if (input.leadId !== undefined) await bookingMade(ctx, input.leadId, `Booked ${input.serialNo}`);
  await holdParty(ctx, order.partyId);
  // The unit: one a delivery would take, promised to no one, then promised to this line.
  // Judged under the unit's own lock (§1's step 5, after the party), so a booking or move at the same time waits for it.
  const { serialised, unit } = await unitFor(ctx, line.itemId, input.serialNo, { lock: true });
  if (!serialised) throw new AppError('not_serialised', 'Only a serialised item is booked by its unit');
  if (unit === null || unit.ownership !== 'ours' || unit.locationId === null || !['new', 'used'].includes(unit.condition)) {
    throw new AppError('unit_unavailable', `${input.serialNo} isn’t a unit we can sell`,
      [{ path: ['serialNo'], code: 'unit_unavailable', message: 'Choose a unit of ours, new or used, at a sellable place' }]);
  }
  if (unit.promisedTo !== null) {
    throw new AppError('unit_held', `${input.serialNo} is held for another order`, [{ path: ['serialNo'], code: 'unit_held', message: 'Choose another unit' }]);
  }
  await checkPlace(ctx, unit.locationId, { sellable: true });
  await postUnitEvents(ctx, { sourceTable: TABLE, sourceId: made.id, businessDate: advance.businessDate,
    changes: [{ kind: 'reserved', itemId: line.itemId, serialNo: input.serialNo, promisedTo: input.orderLineId }] });
  const receipt = await recordHeldReceipt(ctx, { partyId: order.partyId, ...advance }, heldFor(made.id));
  const number = await nextNumber(ctx, BOOKING_SERIES, advance.businessDate);
  await tx.update(vehicleBookings).set({ number }).where(eq(vehicleBookings.id, made.id));
  return { id: made.id, number, receipt };
}

/** POST /sales/bookings/:id/advance (bookings:write): another receipt held for a live booking. */
export async function addAdvance(ctx: Ctx, { id, ...advance }: In<typeof addBookingAdvance>): Promise<Out<typeof addBookingAdvance>> {
  positive(advance.amount);
  checkDate(advance.businessDate, today());
  await holdPeriod(ctx, advance.businessDate);
  const b = await bookingOf(ctx, id, 'bookings:write', true);
  if (b.status !== 'booked') throw new AppError('wrong_status', `This booking is ${b.status}: an advance is taken on a live booking`);
  return recordHeldReceipt(ctx, { partyId: b.partyId, ...advance }, heldFor(id));
}

/**
 * Pays back `amount` of what's left of a booking's advance, its row already locked: which key it needs is judged here
 * against what's left now, refunds waiting for approval counted, then one refund per receipt, oldest first.
 */
async function refundLeft(ctx: Ctx, b: { id: string; partyId: string },
  r: { amount: string; accountId: string; businessDate: string; narration?: string | undefined }) {
  const { left, receipts } = await heldLeft(ctx, heldFor(b.id));
  if (dec(r.amount).gt(left)) {
    throw new AppError('exceeds_receipt', `Only ${left} of the advance is left to refund`,
      [{ path: ['refund', 'amount'], code: 'exceeds_receipt', message: `At most ${left}` }]);
  }
  const key = dec(r.amount).eq(left) ? 'bookings:refund_full' : 'bookings:refund_part';
  if (!ctx.can(key)) {
    throw new AppError('forbidden', key === 'bookings:refund_full' ? 'Refunding all of what’s left needs bookings:refund_full'
      : 'Refunding part of the advance needs bookings:refund_part');
  }
  const refunds: Out<typeof refundBooking>['refunds'] = [];
  let rest = dec(r.amount);
  for (const receipt of receipts) {
    if (rest.lte(0)) break;
    const take = dec(receipt.left).lt(rest) ? dec(receipt.left) : rest;
    if (take.lte(0)) continue;
    refunds.push(await refundHeld(ctx, { receiptId: receipt.id, owner: heldFor(b.id), partyId: b.partyId, businessDate: r.businessDate,
      amount: roundMoney(take), accountId: r.accountId, ...(r.narration === undefined ? {} : { narration: r.narration }) }));
    rest = rest.minus(take);
  }
  return refunds;
}

/** POST /sales/bookings/:id/cancel (bookings:write). The period, the booking, its lead, then the refund's and the unit's. */
export async function cancelBookingNow(ctx: Ctx, { id, businessDate, reason, refund }: In<typeof cancelBooking>):
  Promise<Out<typeof cancelBooking>> {
  checkDate(businessDate, today());
  await holdPeriod(ctx, businessDate);
  const b = await bookingOf(ctx, id, 'bookings:write', true);
  if (b.status !== 'booked') throw new AppError('wrong_status', `This booking is ${b.status}, so it can’t be cancelled`);
  checkDate(businessDate, today(), { date: b.businessDate, what: 'booking' });
  const tx = salesTx(ctx);
  // The lead, locked right after the booking, then judged under that lock: back to interested only when this was its
  // last live booking, so two cancels or a make at the same time take turns (the architect, auditor-2 on #286).
  if (b.leadId !== null) {
    await holdLead(ctx, b.leadId);
    if (!(await otherLiveBooking(ctx, b.leadId, id))) {
      await bookingCancelled(ctx, b.leadId, `Booking ${b.number ?? ''} cancelled: ${reason}`, businessDate);
    }
  }
  const refunds = refund === undefined ? [] : await refundLeft(ctx, b, { ...refund, businessDate });
  await releasePromises(ctx, { sourceTable: TABLE, sourceId: id, businessDate, orderLineIds: [b.orderLineId] });
  await tx.update(vehicleBookings).set({ status: 'cancelled', cancelReason: reason, cancelledOn: businessDate }).where(eq(vehicleBookings.id, id));
  return { refunds, credit: (await heldLeft(ctx, heldFor(id))).left };
}

/** POST /sales/bookings/:id/refund (bookings:write): later, from a cancelled booking, under the same keys and rule. */
export async function refundBookingNow(ctx: Ctx, { id, ...r }: In<typeof refundBooking>): Promise<Out<typeof refundBooking>> {
  checkDate(r.businessDate, today());
  await holdPeriod(ctx, r.businessDate);
  const b = await bookingOf(ctx, id, 'bookings:write', true);
  if (b.status !== 'cancelled') throw new AppError('wrong_status', `This booking is ${b.status}: refund from a cancelled booking`);
  const refunds = await refundLeft(ctx, b, r);
  return { refunds, credit: (await heldLeft(ctx, heldFor(id))).left };
}

