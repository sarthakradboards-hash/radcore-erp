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
import { AppError, type Ctx } from '@radcore/lib-platform';
import { and, asc, eq, inArray, or } from 'drizzle-orm';

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

/** The units a posting names that already exist, locked `ORDER BY id FOR UPDATE` (§1's step 4, after the positions and
 * batches), so two postings naming the same units take turns in one order. */
export async function lockUnits(ctx: Ctx, named: readonly { itemId: string; serialNo: string }[]): Promise<void> {
  if (named.length === 0) return;
  await stockTx(ctx).select({ id: units.id }).from(units)
    .where(or(...named.map((u) => and(eq(units.itemId, u.itemId), eq(units.serialKey, serialKey(u.serialNo))))))
    .orderBy(asc(units.id)).for('update');
}

/** A delivery may not name a damaged unit (the architect on RAD-112; `stock.sell_damaged_units`, proposed to Sarthak,
 * would be its switch, off by default): to sell one, change its condition or move it. Checked under the units' locks, so
 * the on-hand read's picker isn't the only guard. */
export async function refuseDamaged(ctx: Ctx, named: readonly { itemId: string; serialNo: string }[]): Promise<void> {
  if (named.length === 0) return;
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
