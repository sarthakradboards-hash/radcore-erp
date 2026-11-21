// Vehicle bookings (M3-13, RAD-117; ADR-007 §5, the architect's rulings on RAD-117), re-exported by ../contract.ts. A
// booking holds one unit for a confirmed order line of quantity 1 and takes its advance as a receipt held for it.
// Cancelling says what becomes of what's left of the advance: refunded in full (bookings:refund_full), in part
// (bookings:refund_part), or left as the customer's credit (RC-127). Like every contract file it imports only zod,
// lib-common and other libraries' contract entries (D5).
import { dateString, defineContract, idString, listInput, listOf, moneyString, reason } from '@radcore/lib-common';
import { z } from 'zod';

const read = { readOnly: true, isolation: 'read committed' } as const;
const write = { readOnly: false, isolation: 'read committed' } as const;

export const BOOKING_STATUSES = ['booked', 'delivered', 'cancelled'] as const;
const status = z.enum(BOOKING_STATUSES);

/** Money in or out of the customer: how much, from or to which cash or bank account, on which day. */
const money = z.object({ amount: moneyString(), accountId: idString(), businessDate: dateString(),
  narration: z.string().trim().min(1).max(500).optional() });
/** A receipt or refund as lib-accounts answered it: posted with its number, or waiting for an owner past the cash limit. */
const payment = z.object({ id: idString(), status: z.enum(['posted', 'pending_approval']), number: z.string().nullable() });

// What taking or paying back money can refuse (lib-accounts' recordPayment), beyond a booking's own.
const MONEY_ERRORS = ['date_in_future', 'year_not_open', 'period_locked', 'unknown_account', 'not_money_account', 'account_inactive',
  'exceeds_receipt', 'date_before_source'] as const;

const bookingRow = z.object({
  id: idString(), number: z.string().nullable(), orderId: idString(), orderLineId: idString(), partyId: idString(), partyName: z.string(),
  itemId: idString(), serialNo: z.string(), leadId: idString().nullable(), businessDate: dateString(), status,
});

/** Bookings, newest first, a page at a time: the principal's own at `own` scope. */
export const listBookings = defineContract({
  method: 'GET', path: '/sales/bookings', auth: 'session', perm: 'bookings:read', tx: read,
  input: listInput(z.object({ status: status.optional(), orderId: idString().optional(), leadId: idString().optional(),
    // Delivered bookings whose checklist isn't complete (RC-208, the architect).
    checklist: z.literal('incomplete').optional() })),
  output: listOf(bookingRow),
});

/** One booking, with its advance read live from its held receipts: what it took in, and what's left of it (taken less
 * what's applied to an invoice or refunded, refunds waiting for approval included). `unitCondition` marks a damaged unit
 * booked under stock.sell_damaged_units. Once delivered, its checklist, and whether it's complete (RC-208). */
export const getBooking = defineContract({
  method: 'GET', path: '/sales/bookings/:id', auth: 'session', perm: 'bookings:read', tx: read,
  input: z.object({ id: idString() }),
  output: bookingRow.extend({ cancelReason: z.string().nullable(), advance: z.object({ taken: moneyString(), left: moneyString() }),
    unitCondition: z.string().nullable(),
    checklist: z.object({ inspected: z.boolean(), briefed: z.boolean(), warrantyRegistered: z.boolean(), photoId: idString().nullable(),
      noteId: idString().nullable(), complete: z.boolean() }) }),
});

/**
 * Books a unit for a confirmed order line of quantity 1 and takes its advance (more than 0). The unit must be one a
 * delivery would take: ours, at a sellable place, new or used, and promised to no one (`unit_held`). The lead it came
 * from, if named, must be one the person may open (else `not_found`), and becomes converted.
 */
export const createBooking = defineContract({
  method: 'POST', path: '/sales/bookings', auth: 'session', perm: 'bookings:write', tx: write,
  input: z.object({ orderLineId: idString(), serialNo: z.string().trim().min(1).max(60), leadId: idString().optional(), advance: money }),
  output: z.object({ id: idString(), number: z.string(), receipt: payment }),
  errors: ['wrong_status', 'booking_one_unit', 'not_serialised', 'unit_unavailable', 'unit_held', 'line_booked', 'advance_required',
    'place_not_sellable', 'location_inactive', ...MONEY_ERRORS],
});

/** Another advance on a live booking: a receipt held for it, like the first. */
export const addBookingAdvance = defineContract({
  method: 'POST', path: '/sales/bookings/:id/advance', auth: 'session', perm: 'bookings:write', tx: write,
  input: money.extend({ id: idString() }), output: payment, errors: ['wrong_status', 'advance_required', ...MONEY_ERRORS],
});

/**
 * Cancels a booked (not yet delivered) booking, with a reason: its unit is released, its lead goes back to interested
 * if it has no other live booking, and `refund`, if given, pays back that much of what's left. All of what's left needs
 * bookings:refund_full, less needs bookings:refund_part (refused `forbidden` naming the key). What isn't refunded stays
 * the customer's credit (`credit`). A cash refund past the day's limit waits for an owner (`pending_approval`); the
 * cancellation is done either way.
 */
export const cancelBooking = defineContract({
  method: 'POST', path: '/sales/bookings/:id/cancel', auth: 'session', perm: 'bookings:write', tx: write,
  input: z.object({ id: idString(), businessDate: dateString(), reason: reason(), refund: money.omit({ businessDate: true }).optional() }),
  output: z.object({ refunds: z.array(payment), credit: moneyString() }), errors: ['wrong_status', ...MONEY_ERRORS],
});

/** Later, from a cancelled booking: pays back some or all of what's still held, under the same keys and rule. */
export const refundBooking = defineContract({
  method: 'POST', path: '/sales/bookings/:id/refund', auth: 'session', perm: 'bookings:write', tx: write,
  input: money.extend({ id: idString() }), output: z.object({ refunds: z.array(payment), credit: moneyString() }),
  errors: ['wrong_status', ...MONEY_ERRORS],
});
