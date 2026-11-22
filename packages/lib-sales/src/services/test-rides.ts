// Test rides (M3-13, RAD-117; the architect's rulings): a lead the person may open takes a demo unit of ours out. Rides
// are records, not locks, so a unit's several rides a day all stand; each records its outcome once, when it's done.
import { after, salesTx, testRides } from '@radcore/db/sales';
import { leadOpens } from '@radcore/lib-crm';
import { AppError, decodeCursor, encodeCursor, listScope, momentKey, type Ctx } from '@radcore/lib-platform';
import { unitFor } from '@radcore/lib-stock';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { listTestRides, recordTestRide, scheduleTestRide, TEST_RIDE_OUTCOMES } from '../contract.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;
type Outcome = (typeof TEST_RIDE_OUTCOMES)[number];

const PAGE_KEY = z.object({ at: momentKey(), id: z.uuid() });
const row = { id: testRides.id, leadId: testRides.leadId, itemId: testRides.itemId, serialNo: testRides.serialNo,
  scheduledAt: testRides.scheduledAt, doneAt: testRides.doneAt, outcome: testRides.outcome, note: testRides.note };
const shown = <R extends { outcome: string | null; scheduledAt: string; doneAt: string | null }>(r: R) =>
  ({ ...r, outcome: r.outcome as Outcome | null, scheduledAt: new Date(r.scheduledAt).toISOString(),
    doneAt: r.doneAt === null ? null : new Date(r.doneAt).toISOString() });

/** GET /sales/test-rides (bookings:read): soonest first, a page at a time, the principal's own at `own` scope. */
export async function listTestRidesPage(ctx: Ctx, input: In<typeof listTestRides>): Promise<Out<typeof listTestRides>> {
  const key = input.after === undefined ? undefined : decodeCursor(PAGE_KEY, input.after);
  const f = input.filter;
  const rows = await salesTx(ctx).select(row).from(testRides).where(and(
    f.leadId === undefined ? undefined : eq(testRides.leadId, f.leadId),
    f.itemId === undefined ? undefined : eq(testRides.itemId, f.itemId),
    f.serialNo === undefined ? undefined : eq(testRides.serialNo, f.serialNo),
    listScope(ctx, 'bookings:read', testRides.createdBy),
    after([testRides.scheduledAt, testRides.id], key && [key.at, key.id], 'asc'),
  )).orderBy(asc(testRides.scheduledAt), asc(testRides.id)).limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return { items: page.map(shown), next: rows.length > input.limit && last ? encodeCursor({ at: last.scheduledAt, id: last.id }) : null };
}

/** POST /sales/test-rides (bookings:write). */
export async function scheduleRide(ctx: Ctx, input: In<typeof scheduleTestRide>): Promise<Out<typeof scheduleTestRide>> {
  await leadOpens(ctx, input.leadId);
  const { unit } = await unitFor(ctx, input.itemId, input.serialNo);
  if (unit === null || unit.ownership !== 'ours' || unit.condition !== 'demo') {
    throw new AppError('not_demo', `${input.serialNo} isn’t one of our demo units`,
      [{ path: ['serialNo'], code: 'not_demo', message: 'Choose a demo unit' }]);
  }
  const [made] = await salesTx(ctx).insert(testRides).values({ leadId: input.leadId, itemId: input.itemId, serialNo: input.serialNo,
    scheduledAt: input.scheduledAt, note: input.note ?? null }).returning({ id: testRides.id });
  if (made === undefined) throw new Error('an insert returned no row');
  return made;
}

/** POST /sales/test-rides/:id/outcome (bookings:write): once, when it's done; before its time, only `cancelled`. */
export async function recordRide(ctx: Ctx, { id, outcome, note }: In<typeof recordTestRide>): Promise<Out<typeof recordTestRide>> {
  const tx = salesTx(ctx);
  const [ride] = await tx.select({ doneAt: testRides.doneAt, scheduledAt: testRides.scheduledAt, owner: testRides.createdBy }).from(testRides)
    .where(eq(testRides.id, id)).for('update');
  if (ride === undefined) throw new AppError('not_found', 'There is no such test ride');
  ctx.see('bookings:write', { owner: ride.owner });
  if (ride.doneAt !== null) throw new AppError('wrong_status', 'This ride’s outcome is recorded already');
  const now = new Date();
  if (outcome !== 'cancelled' && new Date(ride.scheduledAt) > now) {
    throw new AppError('wrong_status', 'This ride hasn’t happened yet: it can only be cancelled');
  }
  await tx.update(testRides).set({ doneAt: now.toISOString(), outcome, ...(note === undefined ? {} : { note }) }).where(eq(testRides.id, id));
  return {};
}
