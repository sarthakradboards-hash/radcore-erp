// What's on hand of an item at a place (the architect on RAD-112), for the delivery and return forms: the quantity,
// each batch's, and the serialised units free to pick. Quantities only, no cost. A convenience, never the guard:
// posting checks every batch and unit again (RA007, RA008), so a unit someone takes meanwhile is refused there.
import { batches, items, locations, stockMovementBatches, stockMovements, stockTx, units } from '@radcore/db/stock';
import { partyNames } from '@radcore/lib-accounts';
import { dec, LOCATION_KIND_CODES, LOCATION_KINDS, roundQty, UNIT_CONDITIONS, type Quantity } from '@radcore/lib-common';
import { AppError, decodeCursor, encodeCursor, type Ctx } from '@radcore/lib-platform';
import { and, asc, eq, gt, inArray, isNull, like, or, sum as total } from 'drizzle-orm';
import { z } from 'zod';
import type { getOnHand } from '../contract.ts';
import { chassisKey, SELL_DAMAGED_UNITS, serialKey } from '../engine/units.ts';
import { batchQuantities, netQty } from '../rules/on-hand.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;

// A unit in any of these can be picked, and a damaged one too where stock.sell_damaged_units allows it (Sarthak on RAD-112).
const PICKABLE = ['new', 'demo', 'used'] as const;
const conditionOf = z.enum(UNIT_CONDITIONS);
const BACKSLASH = String.fromCharCode(92);
/** A LIKE pattern for keys starting with `key`, its % and _ taken literally. */
const prefix = (key: string) => `${[...key].map((c) => ('%_'.includes(c) || c === BACKSLASH ? BACKSLASH + c : c)).join('')}%`;

/** GET /stock/on-hand. */
export async function onHand(ctx: Ctx, input: In<typeof getOnHand>): Promise<Out<typeof getOnHand>> {
  const tx = stockTx(ctx);
  const [item] = await tx.select({ serialised: items.serialised }).from(items).where(eq(items.id, input.itemId)).limit(1);
  if (item === undefined) throw new AppError('not_found', 'There is no such item');
  const here = and(eq(stockMovements.itemId, input.itemId), eq(stockMovements.locationId, input.locationId));
  // Each direction's total, here and by batch: rules/on-hand.ts nets them.
  const moved = await tx.select({ direction: stockMovements.direction, qty: total(stockMovements.qty) }).from(stockMovements)
    .where(here).groupBy(stockMovements.direction);
  const byBatch = await tx.select({ batchId: stockMovementBatches.batchId, direction: stockMovements.direction, qty: total(stockMovementBatches.qty) })
    .from(stockMovementBatches).innerJoin(stockMovements, eq(stockMovements.id, stockMovementBatches.movementId)).where(here)
    .groupBy(stockMovementBatches.batchId, stockMovements.direction);
  const held = batchQuantities(byBatch);
  const known = held.flatMap((b) => (b.batchId === null ? [] : [b.batchId]));
  const named = known.length === 0 ? [] : await tx.select({ id: batches.id, batchNo: batches.batchNo, supplierId: batches.supplierId })
    .from(batches).where(inArray(batches.id, known));
  const suppliers = await partyNames(ctx, named.flatMap((b) => (b.supplierId === null ? [] : [b.supplierId])));
  const batchRows = held.map((b) => {
    const n = named.find((x) => x.id === b.batchId);
    return { batchId: b.batchId, batchNo: n?.batchNo ?? null, supplierName: n?.supplierId == null ? null : suppliers.get(n.supplierId) ?? null,
      qty: b.qty };
  }).toSorted((a, b) => (a.batchNo ?? '').localeCompare(b.batchNo ?? ''));
  return { position: netQty(moved), batches: batchRows, units: item.serialised ? await pickable(ctx, input) : null };
}

/** The serialised units free to pick here: ours, in a pickable condition, here, and promised to no other order line. */
async function pickable(ctx: Ctx, input: In<typeof getOnHand>) {
  const line = input.forDocument?.split(':')[1] ?? null;
  const key = input.after === undefined ? undefined : decodeCursor(z.object({ serialKey: z.string().max(80), id: z.uuid() }), input.after);
  const rows = await stockTx(ctx).select({ id: units.id, serialNo: units.serialNo, serialKey: units.serialKey, chassisNo: units.chassisNo,
    condition: units.condition, promisedTo: units.promisedTo, batchId: units.batchId, batchNo: batches.batchNo }).from(units)
    .leftJoin(batches, eq(batches.id, units.batchId))
    .where(and(eq(units.itemId, input.itemId), eq(units.locationId, input.locationId), eq(units.ownership, 'ours'),
      inArray(units.condition, ctx.settings.get(SELL_DAMAGED_UNITS) ? [...PICKABLE, 'damaged'] : [...PICKABLE]),
      line === null ? isNull(units.promisedTo) : or(isNull(units.promisedTo), eq(units.promisedTo, line)),
      input.q === undefined ? undefined : or(like(units.serialKey, prefix(serialKey(input.q))), like(units.chassisKey, prefix(chassisKey(input.q)))),
      key === undefined ? undefined : or(gt(units.serialKey, key.serialKey), and(eq(units.serialKey, key.serialKey), gt(units.id, key.id)))))
    .orderBy(asc(units.serialKey), asc(units.id)).limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return { items: page.map((u) => ({ unitId: u.id, serialNo: u.serialNo, chassisNo: u.chassisNo, condition: conditionOf.parse(u.condition),
    heldForThis: line !== null && u.promisedTo === line, batchId: u.batchId, batchNo: u.batchNo })),
    next: rows.length > input.limit && last ? encodeCursor({ serialKey: last.serialKey, id: last.id }) : null };
}

/** Where each item is on hand at a sellable kind of location (LOCATION_KINDS, RAD-138): the positions holding more than
 * nothing, with their quantities, for spreading a bill's price difference over the stock still there (ADR-006 §4).
 * Quantities only, no values. Called after the positions are locked (holdStock), so it reads what the posting will. */
export async function sellableOnHand(ctx: Ctx, itemIds: readonly string[]): Promise<Map<string, { locationId: string; qty: Quantity }[]>> {
  const out = new Map(itemIds.map((id) => [id, [] as { locationId: string; qty: Quantity }[]]));
  if (itemIds.length === 0) return out;
  const sellable = LOCATION_KIND_CODES.filter((k) => LOCATION_KINDS[k].sellable);
  const rows = await stockTx(ctx).select({ itemId: stockMovements.itemId, locationId: stockMovements.locationId,
    direction: stockMovements.direction, qty: total(stockMovements.qty) }).from(stockMovements)
    .innerJoin(locations, eq(locations.id, stockMovements.locationId))
    .where(and(inArray(stockMovements.itemId, [...new Set(itemIds)]), inArray(locations.kind, [...sellable])))
    .groupBy(stockMovements.itemId, stockMovements.locationId, stockMovements.direction)
    .orderBy(asc(stockMovements.itemId), asc(stockMovements.locationId));
  for (const [key, own] of Map.groupBy(rows, (r) => `${r.itemId} ${r.locationId}`)) {
    const qty = netQty(own);
    const [itemId = '', locationId = ''] = key.split(' ');
    if (dec(qty).gt(0)) out.get(itemId)?.push({ locationId, qty });
  }
  return out;
}

/** What's on hand at each of these positions, keyed `itemId locationId` (RAD-138): a billed reject's price difference
 * goes onto what its rejects place still holds (ADR-008 §7). Quantities only. Called after the positions are locked. */
export async function quantitiesAt(ctx: Ctx, positions: readonly { itemId: string; locationId: string }[]): Promise<Map<string, Quantity>> {
  const out = new Map(positions.map((p) => [`${p.itemId} ${p.locationId}`, roundQty('0', 3)]));
  if (positions.length === 0) return out;
  const rows = await stockTx(ctx).select({ itemId: stockMovements.itemId, locationId: stockMovements.locationId,
    direction: stockMovements.direction, qty: total(stockMovements.qty) }).from(stockMovements)
    .where(and(inArray(stockMovements.itemId, [...new Set(positions.map((p) => p.itemId))]),
      inArray(stockMovements.locationId, [...new Set(positions.map((p) => p.locationId))])))
    .groupBy(stockMovements.itemId, stockMovements.locationId, stockMovements.direction);
  for (const [key, own] of Map.groupBy(rows, (r) => `${r.itemId} ${r.locationId}`)) if (out.has(key)) out.set(key, netQty(own));
  return out;
}
