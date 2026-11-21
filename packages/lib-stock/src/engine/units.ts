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
import { and, asc, eq, inArray, or } from 'drizzle-orm';
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

/** Each delivery line's units are of one condition (the architect on RAD-112), so an invoice line billing part of it
 * carries the line's one condition: a mixed line is refused (`mixed_condition`), naming the odd units. Read under the
 * units' locks; answers each unit's condition, by item and serial key, for its `delivered` event to record. */
export async function oneCondition(ctx: Ctx, lines: readonly { itemId: string; units?: readonly UnitOnLine[] }[]): Promise<Map<string, UnitCondition>> {
  const named = lines.flatMap((l) => (l.units ?? []).map((u) => ({ itemId: l.itemId, serialNo: u.serialNo })));
  if (named.length === 0) return new Map();
  const rows = await stockTx(ctx).select({ itemId: units.itemId, key: units.serialKey, condition: units.condition }).from(units)
    .where(or(...named.map((u) => and(eq(units.itemId, u.itemId), eq(units.serialKey, serialKey(u.serialNo))))));
  const conditions = new Map(rows.map((r) => [`${r.itemId}:${r.key}`, r.condition as UnitCondition]));
  for (const l of lines) {
    const own = (l.units ?? []).map((u) => ({ serialNo: u.serialNo, condition: conditions.get(`${l.itemId}:${serialKey(u.serialNo)}`) }));
    const count = (c: UnitCondition | undefined) => own.filter((u) => u.condition === c).length;
    const most = own.map((u) => u.condition).reduce((m, c) => (count(c) > count(m) ? c : m), own[0]?.condition);
    const odd = own.filter((u) => u.condition !== most);
    if (odd.length > 0) {
      const which = odd.map((u) => `${u.serialNo} is ${u.condition ?? 'unknown'}`).join(', ');
      throw new AppError('mixed_condition', `${which} and the rest are ${most ?? 'unknown'}: put each condition on its own line`);
    }
  }
  return conditions;
}

/** A sale line's one condition, as an invoice line carries it (the architect on RAD-112: the buyer is told): the
 * condition its units left with on their delivery (its `delivered` events), frozen then; none when they were new or the
 * line has no units. Worst first (damaged, used, demo), though a line holds one condition (oneCondition). */
export async function soldCondition(ctx: Ctx, saleLineIds: readonly string[]): Promise<Map<string, Exclude<UnitCondition, 'new'> | null>> {
  const rows = saleLineIds.length === 0 ? [] : await stockTx(ctx).select({ line: unitEvents.saleLineId, condition: unitEvents.condition })
    .from(unitEvents).where(and(eq(unitEvents.kind, 'delivered'), inArray(unitEvents.saleLineId, [...saleLineIds])));
  const worst = (['damaged', 'used', 'demo'] as const);
  return new Map(saleLineIds.map((id) => {
    const seen = new Set(rows.filter((r) => r.line === id).map((r) => r.condition));
    return [id, worst.find((c) => seen.has(c)) ?? null];
  }));
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
