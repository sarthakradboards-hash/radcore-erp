// lib-sales's held quick bills (M3-11, RAD-115; the architect's ruling on "hold, then complete"), beside ./tables.ts,
// which is at E2's size limit. SQL zone (ADR-002 §3): `sql` only as a CHECK's argument.
import { index, json, uuid } from 'drizzle-orm/pg-core';
import { radcoreTable } from '../columns.ts';
import { locations } from '../stock/tables.ts';
import { salesOrders } from './tables.ts';

/**
 * A quick bill held for an override (Sarthak: "Hold, then complete"): its draft order, the place its goods will leave
 * from, the payments planned (each a method and an amount, and a bank payment's account; no card code yet, the card
 * isn't charged), and each line's batches and serials, by the order's line number. Completing it takes these, never
 * new ones, so what was approved is what's sold, and deletes the row. Deleting the draft order deletes its hold.
 */
export const quickBillHolds = radcoreTable('quick_bill_holds', {
  orderId: uuid().primaryKey().references(() => salesOrders.id, { onDelete: 'cascade' }),
  locationId: uuid().notNull().references(() => locations.id, { onDelete: 'restrict' }),
  payments: json().notNull(),
  picks: json().notNull(),
}, (t) => [index('ix_quick_bill_holds_location').on(t.locationId)]);
