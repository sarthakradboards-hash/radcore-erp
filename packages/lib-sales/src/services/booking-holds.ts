// What a booking means to the documents around it (M3-13, RAD-117, RC-122; the architect's rulings): its order can't be
// rewritten, cancelled or closed short while it's live (`booking_live`); its line's delivery locks it in the documents
// step, before the units, and marks it delivered; a cancelled delivery puts it back to booked, with the unit that came
// back promised to the line again.
// E7's exemption (the architect on RAD-117, on delivered.ts's terms): these read past the principal's own bookings,
// since someone delivering or changing an order may hold no bookings key. Each is keyed by an order, order lines or a
// lead the calling service already has in scope, and answers only booleans, counts and ids: no booking row leaves here.
import { salesOrderLines, salesTx, vehicleBookings } from '@radcore/db/sales';
import { dec } from '@radcore/lib-common';
import { AppError, type Ctx } from '@radcore/lib-platform';
import { postUnitEvents } from '@radcore/lib-stock';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { netDelivered } from './delivered.ts';

/** A live booking as the documents around it see it: its id, its line and item, and whether it's delivered. */
export type LiveBooking = Readonly<{ id: string; orderLineId: string; itemId: string; delivered: boolean }>;

/** The live (not cancelled) bookings of these order lines, locked `ORDER BY id FOR UPDATE`. Answers ids and a flag. */
export async function lockLiveBookings(ctx: Ctx, orderLineIds: readonly string[]): Promise<LiveBooking[]> {
  if (orderLineIds.length === 0) return [];
  const rows = await salesTx(ctx).select({ id: vehicleBookings.id, orderLineId: vehicleBookings.orderLineId, itemId: vehicleBookings.itemId,
    status: vehicleBookings.status }).from(vehicleBookings)
    .where(and(inArray(vehicleBookings.orderLineId, [...new Set(orderLineIds)]), ne(vehicleBookings.status, 'cancelled')))
    .orderBy(asc(vehicleBookings.id)).for('update');
  return rows.map((r) => ({ id: r.id, orderLineId: r.orderLineId, itemId: r.itemId, delivered: r.status === 'delivered' }));
}

/** Whether a lead has a live booking besides `exceptId`, whoever made it: only then does it stay converted (RC-127).
 * Answers a boolean. */
export async function otherLiveBooking(ctx: Ctx, leadId: string, exceptId: string): Promise<boolean> {
  const [other] = await salesTx(ctx).select({ id: vehicleBookings.id }).from(vehicleBookings).where(and(eq(vehicleBookings.leadId, leadId),
    ne(vehicleBookings.id, exceptId), ne(vehicleBookings.status, 'cancelled'))).limit(1);
  return other !== undefined;
}

const NEXT_STEP = {
  // shortcut: changeOrder deletes and reinserts every line (new ids) and promised_to has no foreign key, so any rewrite
  // of a booked order is refused, not only one changing the booked line; upgrade when changeOrder keeps unchanged lines' ids.
  rewrite: 'make a new order for extras, or cancel its booking to change the vehicle',
  cancel: 'cancel its booking first, so its advance is explained',
  close: 'cancel its booking first, so its advance is explained',
} as const;

/** Refused while a booking still holds a unit for a line of the order. Names the line, not the booking: the caller may
 * hold no bookings key. Answers nothing, or refuses. */
export async function refuseWhileBooked(ctx: Ctx, orderId: string, change: keyof typeof NEXT_STEP): Promise<void> {
  const [live] = await salesTx(ctx).select({ lineNo: salesOrderLines.lineNo }).from(vehicleBookings)
    .innerJoin(salesOrderLines, eq(salesOrderLines.id, vehicleBookings.orderLineId))
    .where(and(eq(vehicleBookings.orderId, orderId), eq(vehicleBookings.status, 'booked'))).orderBy(asc(salesOrderLines.lineNo)).limit(1);
  if (live !== undefined) {
    throw new AppError('booking_live', `Line ${String(live.lineNo)} has a vehicle booked on it: ${NEXT_STEP[change]}`);
  }
}

/** The order lines a delivery of `lines` finishes: what was delivered before, with this, reaches what was ordered.
 * Reads no booking: answers order line ids. */
export async function linesDone(ctx: Ctx, lines: readonly { orderLineId: string; qty: string }[]): Promise<string[]> {
  if (lines.length === 0) return [];
  const ids = [...new Set(lines.map((l) => l.orderLineId))];
  const ordered = await salesTx(ctx).select({ id: salesOrderLines.id, qty: salesOrderLines.qty }).from(salesOrderLines)
    .where(inArray(salesOrderLines.id, ids));
  const before = await netDelivered(ctx, ids);
  return ordered.filter((o) => dec(before.get(o.id) ?? '0')
    .plus(lines.filter((l) => l.orderLineId === o.id).reduce((s, l) => s.plus(dec(l.qty)), dec('0'))).gte(dec(o.qty))).map((o) => o.id);
}

/** A delivery's finished booked lines: their bookings are delivered. Answers nothing. */
export async function bookingsDelivered(ctx: Ctx, bookings: readonly LiveBooking[], done: readonly string[]): Promise<void> {
  const ids = bookings.filter((b) => !b.delivered && done.includes(b.orderLineId)).map((b) => b.id);
  if (ids.length > 0) await salesTx(ctx).update(vehicleBookings).set({ status: 'delivered' }).where(inArray(vehicleBookings.id, ids));
}

/** A cancelled delivery's booked lines: each booking is booked again, holding the unit that came back on its line.
 * Answers nothing. */
export async function bookingsBack(ctx: Ctx, doc: { sourceTable: string; sourceId: string; businessDate: string },
  bookings: readonly LiveBooking[], back: readonly { orderLineId: string; serials: readonly string[] }[]): Promise<void> {
  for (const b of bookings.filter((x) => x.delivered)) {
    const serialNo = back.find((l) => l.orderLineId === b.orderLineId)?.serials[0];
    if (serialNo === undefined) continue;
    await postUnitEvents(ctx, { ...doc, changes: [{ kind: 'reserved', itemId: b.itemId, serialNo, promisedTo: b.orderLineId }] });
    await salesTx(ctx).update(vehicleBookings).set({ status: 'booked', serialNo }).where(eq(vehicleBookings.id, b.id));
  }
}
