// Undoing unit events (ADR-006 §5, RC-124, RC-207): what reverseStock writes for each unit a cancelled document moved,
// and the checks that the unit is still where that document left it. Beside stock.ts, which posts and mirrors.
import { stockTx, unitEvents, units } from '@radcore/db/stock';
import type { UnitCondition } from '@radcore/lib-common';
import { AppError, type Ctx } from '@radcore/lib-platform';
import { and, desc, eq, isNotNull, lt, or } from 'drizzle-orm';
import { serialKey } from './units.ts';

// What undoes each unit event a cancelled document's movements carried, and where the unit must be for it: a delivery's
// unit is still the customer's; a move's is still where the move put it; a unit received is still ours where it came
// in; one scrapped or sent back to its supplier is still gone. Anything else has moved on since (`units_mismatch`).
const UNDO: Readonly<Record<string, { kind: 'delivered' | 'delivery_returned' | 'moved' | 'returned_to_supplier' | 'received';
  at: 'customer' | 'in' | 'gone' }>> = {
  delivered: { kind: 'delivery_returned', at: 'customer' }, delivery_returned: { kind: 'delivered', at: 'in' },
  returned: { kind: 'delivered', at: 'in' }, moved: { kind: 'moved', at: 'in' },
  // A unit received, then the receipt (or the adjustment that found it) cancelled, leaves as it came: gone, so the
  // same serial can be received again (ADR-008 §6). returned_to_supplier, not scrapped: both make it gone, and a
  // receipt's unit does go back to whoever sent it; neither is a write-off of goods we held.
  received: { kind: 'returned_to_supplier', at: 'in' },
  scrapped: { kind: 'received', at: 'gone' }, returned_to_supplier: { kind: 'received', at: 'gone' },
};

/** The event that undoes `kind`, or undefined for one no cancellation undoes. */
export const undoOf = (kind: string) => UNDO[kind]?.kind;

// Each unit is still where the event being undone left it (UNDO's `at`), else it has moved on since: refused by name,
// before the database's RA008 would refuse the mirror's event.
export async function unitsStillThere(ctx: Ctx, events: readonly { itemId: string; serialNo: string; kind: string; outMovementId: string | null;
  inMovementId: string | null }[], placeOf: ReadonlyMap<string, string>): Promise<void> {
  if (events.length === 0) return;
  const rows = await stockTx(ctx).select({ itemId: units.itemId, key: units.serialKey, ownership: units.ownership, locationId: units.locationId })
    .from(units).where(or(...events.map((e) => and(eq(units.itemId, e.itemId), eq(units.serialKey, serialKey(e.serialNo))))));
  const now = new Map(rows.map((r) => [`${r.itemId} ${r.key}`, r]));
  for (const e of events) {
    const u = now.get(`${e.itemId} ${serialKey(e.serialNo)}`);
    const at = UNDO[e.kind]?.at;
    const there = at === 'customer' ? u?.ownership === 'customer' : at === 'gone' ? u?.ownership === 'gone'
      : u?.ownership === 'ours' && u.locationId === placeOf.get(e.inMovementId ?? '');
    if (at !== undefined && !there) {
      throw new AppError('units_mismatch', `Unit ${e.serialNo} has moved on since, so this can’t be cancelled`);
    }
  }
}

// The condition a unit had before `e` changed it: the latest earlier event of the unit's that recorded one, else `new`,
// as a unit is received by default.
export async function conditionBefore(ctx: Ctx, e: { id: string; itemId: string; serialNo: string; postedAt: Date }): Promise<UnitCondition> {
  const [row] = await stockTx(ctx).select({ condition: unitEvents.condition }).from(unitEvents)
    .where(and(eq(unitEvents.itemId, e.itemId), eq(unitEvents.serialNo, e.serialNo), isNotNull(unitEvents.condition),
      or(lt(unitEvents.postedAt, e.postedAt), and(eq(unitEvents.postedAt, e.postedAt), lt(unitEvents.id, e.id)))))
    .orderBy(desc(unitEvents.postedAt), desc(unitEvents.id)).limit(1);
  return (row?.condition ?? 'new') as UnitCondition;
}

// A gone unit's batch and condition, which it comes back in.
export async function goneUnit(ctx: Ctx, itemId: string, serialNo: string): Promise<{ batchId: string | null; condition: UnitCondition }> {
  const [u] = await stockTx(ctx).select({ batchId: units.batchId, condition: units.condition }).from(units)
    .where(and(eq(units.itemId, itemId), eq(units.serialKey, serialKey(serialNo)))).limit(1);
  if (u === undefined) throw new AppError('not_reversible', `Unit ${serialNo} isn’t known`);
  return { batchId: u.batchId, condition: u.condition as UnitCondition };
}

// The sale a unit was last delivered on: where goods that came back go out again.
export async function lastSaleLine(ctx: Ctx, itemId: string, serialNo: string): Promise<string> {
  const [row] = await stockTx(ctx).select({ saleLineId: unitEvents.saleLineId }).from(unitEvents)
    .where(and(eq(unitEvents.itemId, itemId), eq(unitEvents.serialNo, serialNo), eq(unitEvents.kind, 'delivered')))
    .orderBy(desc(unitEvents.postedAt)).limit(1);
  if (row?.saleLineId == null) throw new AppError('not_reversible', `Unit ${serialNo} was never delivered on a sale`);
  return row.saleLineId;
}
