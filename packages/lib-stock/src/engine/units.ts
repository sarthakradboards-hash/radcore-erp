// The units engine (ADR-006 §5; M2-06, RAD-94; RC-026, RC-027). Every change to a serialised unit is a row in
// `unit_events`, and the database's trigger applies it to `units`, which the runtime login can't write: so whatever
// path a document takes, it goes through here. A unit that moves rides on its stock movement: the stock engine
// (postStock) writes the events for a line's units with the line's movements. The changes that move no stock (a
// promise, a condition, a chassis number, a customer's vehicle in or out of service) are `postUnitEvents`. The
// database refuses an event its unit's state doesn't allow (RA008), and checks at commit that each movement has as
// many units as its quantity, batch by batch (RA007); this engine answers the plain mistakes first, by name.
import { items, stockTx, unitEvents, units } from '@radcore/db/stock';
import { holdPeriod } from '@radcore/lib-accounts';
import { dec, type UnitCondition, type UnitEventKind } from '@radcore/lib-common';
import { AppError, defineSetting, type Ctx } from '@radcore/lib-platform';
import { and, asc, eq, inArray, isNotNull, ne, or } from 'drizzle-orm';
import { z } from 'zod';

/** One unit on a stock line: its serial, and on goods in, which of the line's batches it came in (when the line has
 * more than one), its chassis number and its condition from QC. A move may change its condition (to `demo`, say). */
export type UnitOnLine = {
  readonly serialNo: string;
  readonly batchNo?: string | null;
  readonly chassisNo?: string | null;
  readonly condition?: UnitCondition;
};

/** The events a stock line's units take, by the line's direction (§5): goods in, goods out, or a move. */
export type InUnitEvent = Extract<UnitEventKind, 'received' | 'returned' | 'delivery_returned'>;
export type OutUnitEvent = Extract<UnitEventKind, 'delivered' | 'returned_to_supplier' | 'scrapped'>;
export type MoveUnitEvent = Extract<UnitEventKind, 'moved' | 'sent_to_job_work' | 'received_from_job_work'>;

/** A change to a unit that moves no stock. `chassis_recorded` needs the change's reason first (lib-platform's
 * recordChangeReason, RAD-36); `taken_in` names the service bay; `reserved` the order line. */
export type UnitChange = {
  readonly kind: Extract<UnitEventKind, 'reserved' | 'released' | 'condition_changed' | 'chassis_recorded' | 'taken_in' | 'handed_back'>;
  readonly itemId: string;
  readonly serialNo: string;
  readonly promisedTo?: string;
  readonly condition?: UnitCondition;
  readonly chassisNo?: string;
  readonly locationId?: string;
};

/** An event as the engine writes it; the trigger fills in the unit, where it ends up, the time and the reason. */
export type UnitEventRow = {
  itemId: string; serialNo: string; kind: UnitEventKind; outMovementId?: string; inMovementId?: string;
  locationId?: string; condition?: UnitCondition; promisedTo?: string; saleLineId?: string; batchId?: string | null;
  chassisNo?: string;
};

/** A serial as the database keys it (`serial_key`): upper case, without spaces (§5). A serial is printable ASCII
 * (`ck_units_serial`), so this and the database's expression always agree. */
export const serialKey = (serialNo: string): string => serialNo.toUpperCase().replace(/\s/g, '');
/** A chassis number as `units.chassis_key` holds it: upper case, without spaces or hyphens. */
export const chassisKey = (chassisNo: string): string => chassisNo.toUpperCase().replace(/[\s-]/g, '');

/** Whether an item is serialised, and its unit with this serial as it stands, or null: for another library judging a
 * unit before it promises it (a booking, RAD-117). With `lock`, the unit's row is held FOR UPDATE, so what's judged
 * stays true until the promise is written (auditor-2 on #286). */
export async function unitFor(ctx: Ctx, itemId: string, serialNo: string, o: { lock?: boolean } = {}): Promise<{ serialised: boolean; unit: {
  ownership: string; condition: string; locationId: string | null; promisedTo: string | null } | null }> {
  const [item] = await stockTx(ctx).select({ serialised: items.serialised }).from(items).where(eq(items.id, itemId)).limit(1);
  const q = stockTx(ctx).select({ ownership: units.ownership, condition: units.condition, locationId: units.locationId,
    promisedTo: units.promisedTo }).from(units).where(and(eq(units.itemId, itemId), eq(units.serialKey, serialKey(serialNo)))).limit(1);
  const [unit] = o.lock === true ? await q.for('update') : await q;
  return { serialised: item?.serialised === true, unit: unit ?? null };
}

/** The serialised items among `itemIds`. */
export async function serialisedItems(ctx: Ctx, itemIds: readonly string[]): Promise<Set<string>> {
  if (itemIds.length === 0) return new Set();
  const rows = await stockTx(ctx).select({ id: items.id }).from(items)
    .where(and(inArray(items.id, [...new Set(itemIds)]), eq(items.serialised, true)));
  return new Set(rows.map((r) => r.id));
}

/**
 * A serialised item's line names a unit for each piece, each serial once in the posting; any other item's line names
 * none. Answered by name before the database's commit check (RA007).
 */
export function checkUnits(lines: readonly { itemId: string; qty: string; units?: readonly UnitOnLine[] }[], serialised: ReadonlySet<string>): void {
  const seen = new Set<string>();
  lines.forEach((line, n) => {
    const named = line.units ?? [];
    if (!serialised.has(line.itemId)) {
      if (named.length > 0) {
        throw new AppError('not_serialised', 'This item isn’t serialised, so its lines name no units',
          [{ path: ['lines', n, 'units'], code: 'not_serialised', message: 'Leave the serial numbers out' }]);
      }
      return;
    }
    if (!dec(line.qty).eq(named.length)) {
      throw new AppError('units_mismatch', 'Each unit on the line needs its serial number',
        [{ path: ['lines', n, 'units'], code: 'mismatch', message: `${String(named.length)} serial numbers for a quantity of ${line.qty}` }]);
    }
    for (const u of named) {
      const k = `${line.itemId} ${serialKey(u.serialNo)}`;
      if (seen.has(k)) {
        throw new AppError('serial_twice', 'A serial number is named twice',
          [{ path: ['lines', n, 'units'], code: 'twice', message: `${u.serialNo} is named twice` }]);
      }
      seen.add(k);
    }
  });
}

/** The units a posting names that already exist, and those still promised to the order lines whose promises it ends,
 * locked together `ORDER BY id FOR UPDATE` (§1's step 4, after the positions and batches), so two postings naming the
 * same units take turns in one order (the architect on RAD-117: a release locked after the delivered units could
 * deadlock against another delivery naming both). Answers the promised ones, for their release. */
export async function lockUnits(ctx: Ctx, named: readonly { itemId: string; serialNo: string }[], endingPromisesOf: readonly string[] = []):
  Promise<{ itemId: string; serialNo: string; promisedTo: string }[]> {
  if (named.length === 0 && endingPromisesOf.length === 0) return [];
  const rows = await stockTx(ctx).select({ id: units.id, itemId: units.itemId, serialNo: units.serialNo, promisedTo: units.promisedTo })
    .from(units).where(or(...named.map((u) => and(eq(units.itemId, u.itemId), eq(units.serialKey, serialKey(u.serialNo)))),
      endingPromisesOf.length === 0 ? undefined : inArray(units.promisedTo, [...endingPromisesOf])))
    .orderBy(asc(units.id)).for('update');
  return rows.filter((r): r is typeof r & { promisedTo: string } => r.promisedTo !== null && endingPromisesOf.includes(r.promisedTo));
}

/** A unit going out that's held for another order line (a booking's, RC-122): answered by name, before the database's
 * RA008. Run under the units' locks. */
export async function checkHeld(ctx: Ctx, outs: readonly { itemId: string; orderLineId?: string; units?: readonly UnitOnLine[] }[]): Promise<void> {
  for (const [n, o] of outs.entries()) {
    const keys = (o.units ?? []).map((u) => serialKey(u.serialNo));
    if (keys.length === 0) continue;
    const [held] = await stockTx(ctx).select({ serialNo: units.serialNo }).from(units).where(and(eq(units.itemId, o.itemId),
      inArray(units.serialKey, keys), isNotNull(units.promisedTo),
      o.orderLineId === undefined ? undefined : ne(units.promisedTo, o.orderLineId))).limit(1);
    if (held !== undefined) {
      throw new AppError('unit_held', `${held.serialNo} is held for another order`,
        [{ path: ['lines', n, 'units'], code: 'unit_held', message: `${held.serialNo} is held for another order: choose another unit` }]);
    }
  }
}

/**
 * Ends every promise to these order lines (RC-122): a `released` event for each unit still promised to one. For a
 * document that ends a line's hold without delivering it, such as a cancelled booking; a delivery ends them through
 * postStock's `endingPromisesOf`, in the same lock as its own units. Route-less: the owning library decides when.
 */
export async function releasePromises(ctx: Ctx, p: { sourceTable: string; sourceId: string; businessDate: string;
  orderLineIds: readonly string[] }): Promise<void> {
  if (p.orderLineIds.length === 0) return;
  await holdPeriod(ctx, p.businessDate); // §1's step 1, as every posting
  const promised = await lockUnits(ctx, [], p.orderLineIds);
  await writeUnitEvents(ctx, p, promised.map((u) => ({ itemId: u.itemId, serialNo: u.serialNo, kind: 'released' })));
}

/** Whether a damaged unit may be sold as it is (Sarthak on RAD-112: "Setting, default off"; the architect's proposal). */
export const SELL_DAMAGED_UNITS = defineSetting('stock.sell_damaged_units', z.boolean(), false, {
  label: 'Sell damaged units as they are',
  description: 'Whether a delivery may take a unit marked damaged. Off: change its condition or move it first.',
  input: { kind: 'yes_no' },
});

/** A delivery may not name a damaged unit unless the setting allows it (the architect on RAD-112): to sell one, change
 * its condition or move it. Checked under the units' locks, so the on-hand read's picker isn't the only guard. */
export async function refuseDamaged(ctx: Ctx, named: readonly { itemId: string; serialNo: string }[]): Promise<void> {
  if (named.length === 0 || ctx.settings.get(SELL_DAMAGED_UNITS)) return;
  const [hit] = await stockTx(ctx).select({ serialNo: units.serialNo }).from(units)
    .where(and(eq(units.condition, 'damaged'), or(...named.map((u) => and(eq(units.itemId, u.itemId), eq(units.serialKey, serialKey(u.serialNo)))))))
    .limit(1);
  if (hit !== undefined) throw new AppError('unit_damaged', `Unit ${hit.serialNo} is damaged: change its condition or move it before you sell it`);
}

/** Writes a document's unit events, in the order given; the trigger applies each to its unit (RA008). */
export async function writeUnitEvents(ctx: Ctx, doc: { sourceTable: string; sourceId: string; businessDate: string },
  rows: readonly UnitEventRow[]): Promise<void> {
  if (rows.length === 0) return;
  await stockTx(ctx).insert(unitEvents).values(rows.map((r) => ({ ...doc, ...r })));
}

/**
 * A document's changes to units that move no stock (§5): promises, conditions, chassis numbers, and a customer's
 * vehicle taken in for service or handed back. The period lock is held first, then the units in id order.
 */
export async function postUnitEvents(ctx: Ctx, p: { sourceTable: string; sourceId: string; businessDate: string;
  changes: readonly UnitChange[] }): Promise<void> {
  await holdPeriod(ctx, p.businessDate); // §1's step 1, as every posting (auditor-2 on #216)
  await lockUnits(ctx, p.changes);
  await writeUnitEvents(ctx, p, p.changes.map((c) => ({ ...c })));
}
