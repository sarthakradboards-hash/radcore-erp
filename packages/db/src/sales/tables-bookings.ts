// lib-sales's vehicle bookings (M3-13, RAD-117; ADR-007 §5, the architect's rulings on RAD-117), beside ./tables.ts,
// which is at E2's size limit. SQL zone (ADR-002 §3): `sql` only as a CHECK's argument.
import { isNull, sql } from 'drizzle-orm';
import { check, date, index, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { boundedText, id, radcoreTable } from '../columns.ts';
import { leads } from '../crm/tables.ts';
import { items } from '../stock/tables.ts';
import { salesOrderLines, salesOrders } from './tables.ts';

/**
 * A booking (M3-13): a confirmed order line of quantity 1, for a serialised item, holding one unit by its serial. The
 * unit is promised to the line (a `reserved` unit event), so the stock engine knows the hold, and the hold ends when
 * the line is done, whatever serial left from wherever (RC-122). Its advance is its receipts held for it in
 * lib-accounts (`held_for`), read live: there's no amount here (the architect). Cancelling it says what becomes of
 * what's left (ADR-007 §5, RC-127). At most one booking that isn't cancelled per order line. `lead_id` is the lead it
 * came from, if any: the lead is converted while a booking of it is live, and back to interested when none is.
 */
export const vehicleBookings = radcoreTable('vehicle_bookings', {
  id: id(),
  // Drawn last, as ADR-006 §1 orders numbering, in the same transaction as the booking: set on every committed row.
  number: text().unique(),
  orderId: uuid().notNull().references(() => salesOrders.id, { onDelete: 'restrict' }),
  orderLineId: uuid().notNull().references(() => salesOrderLines.id, { onDelete: 'restrict' }),
  itemId: uuid().notNull().references(() => items.id, { onDelete: 'restrict' }),
  serialNo: boundedText({ max: 60 }).notNull(),
  leadId: uuid().references(() => leads.id, { onDelete: 'restrict' }),
  businessDate: date({ mode: 'string' }).notNull(),
  status: text().notNull().default('booked'),
  cancelReason: boundedText({ max: 500 }),
  // The cancellation's day, null while it's live: the partial unique index's key.
  cancelledOn: date({ mode: 'string' }),
}, (t) => [
  uniqueIndex('ux_vehicle_bookings_live_line').on(t.orderLineId).where(isNull(t.cancelledOn)),
  index('ix_vehicle_bookings_order').on(t.orderId),
  index('ix_vehicle_bookings_item').on(t.itemId),
  index('ix_vehicle_bookings_lead').on(t.leadId),
  check('ck_vehicle_bookings_status', sql`${t.status} in ('booked', 'delivered', 'cancelled')`),
  check('ck_vehicle_bookings_cancelled', sql`(${t.status} = 'cancelled') = (${t.cancelReason} is not null) and (${t.status} = 'cancelled') = (${t.cancelledOn} is not null)`),
  check('ck_vehicle_bookings_serial', sql`${t.serialNo} ~ '^[ -~]*[!-~][ -~]*$'`),
]);
