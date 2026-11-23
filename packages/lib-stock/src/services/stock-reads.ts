// Stock's reads for the stock screens (RAD-144): what's on hand, item by place, with each position's value and batches;
// and the serialised units, with each one's trail. Quantities and values come from the movements, as getOnHand's do
// (the architect on RAD-112): in less out, a revaluation moving value and no quantity.
import { after, batches, items, locations, searchWords, stockMovementBatches, stockMovements, stockTx, unitEvents, units } from '@radcore/db/stock';
import { dec, LOCATION_KIND_CODES, roundMoney, UNIT_CONDITIONS, UNIT_EVENT_KINDS, UNIT_OWNERSHIPS } from '@radcore/lib-common';
import { AppError, decodeCursor, encodeCursor, type Ctx } from '@radcore/lib-platform';
import { and, asc, eq, inArray, isNull, like, ne, or, sum as total } from 'drizzle-orm';
import { z } from 'zod';
import type { getStockUnit, listStockOnHand, listStockUnits } from '../contract.ts';
import { chassisKey, serialKey } from '../engine/units.ts';
import { batchQuantities, netQty } from '../rules/on-hand.ts';
import { prefix } from './on-hand.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;

const POSITION_KEY = z.object({ sku: z.string().max(200), code: z.string().max(80), itemId: z.uuid(), locationId: z.uuid() });
const UNIT_KEY = z.object({ serialKey: z.string().max(80), id: z.uuid() });
const kindOf = z.enum(LOCATION_KIND_CODES);
const ownershipOf = z.enum(UNIT_OWNERSHIPS);
const conditionOf = z.enum(UNIT_CONDITIONS);
const eventKindOf = z.enum(UNIT_EVENT_KINDS);
const pairKey = (itemId: string, locationId: string) => `${itemId} ${locationId}`;

/**
 * GET /stock/positions. A position is held while its ins and outs differ: each side summed by item and place, and a
 * place with only outs (a negative-stock sale) or only ins counted too.
 * shortcut: each page sums every movement of the filtered items and places; when that's slow, keep positions in a table.
 */
export async function listPositions(ctx: Ctx, input: In<typeof listStockOnHand>): Promise<Out<typeof listStockOnHand>> {
  const tx = stockTx(ctx);
  const f = input.filter;
  const key = input.after === undefined ? undefined : decodeCursor(POSITION_KEY, input.after);
  const m = stockMovements;
  const within = and(f.itemId === undefined ? undefined : eq(m.itemId, f.itemId), f.locationId === undefined ? undefined : eq(m.locationId, f.locationId));
  const side = (direction: 'in' | 'out') => tx.select({ itemId: m.itemId, locationId: m.locationId, qty: total(m.qty).as(`${direction}_qty`) })
    .from(m).where(and(eq(m.direction, direction), within)).groupBy(m.itemId, m.locationId).as(`${direction}s`);
  const [ins, outs] = [side('in'), side('out')];
  const held = tx.select({ itemId: m.itemId, locationId: m.locationId }).from(m)
    .where(and(inArray(m.direction, ['in', 'out']), within)).groupBy(m.itemId, m.locationId).as('held');
  const rows = await tx.select({ itemId: held.itemId, locationId: held.locationId, sku: items.sku, skuKey: items.skuKey, name: items.name,
    unit: items.unit, locationName: locations.name, kind: locations.kind, codeKey: locations.codeKey, inQty: ins.qty, outQty: outs.qty })
    .from(held).innerJoin(items, eq(items.id, held.itemId)).innerJoin(locations, eq(locations.id, held.locationId))
    .leftJoin(ins, and(eq(ins.itemId, held.itemId), eq(ins.locationId, held.locationId)))
    .leftJoin(outs, and(eq(outs.itemId, held.itemId), eq(outs.locationId, held.locationId)))
    .where(and(or(isNull(ins.qty), isNull(outs.qty), ne(ins.qty, outs.qty)), searchWords([items.sku, items.name], f.search),
      after([items.skuKey, locations.codeKey, items.id, locations.id], key && [key.sku, key.code, key.itemId, key.locationId], 'asc')))
    .orderBy(asc(items.skuKey), asc(locations.codeKey), asc(items.id), asc(locations.id)).limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const [values, batchRows] = await Promise.all([positionValues(ctx, page), positionBatches(ctx, page)]);
  const last = page.at(-1);
  return {
    items: page.map((r) => ({ itemId: r.itemId, sku: r.sku, name: r.name, unit: r.unit, locationId: r.locationId, locationName: r.locationName,
      locationKind: kindOf.parse(r.kind), qty: netQty([{ direction: 'in', qty: r.inQty }, { direction: 'out', qty: r.outQty }]),
      value: values.get(pairKey(r.itemId, r.locationId)) ?? roundMoney('0'), batches: batchRows.get(pairKey(r.itemId, r.locationId)) ?? [] })),
    next: rows.length > input.limit && last
      ? encodeCursor({ sku: last.skuKey, code: last.codeKey, itemId: last.itemId, locationId: last.locationId }) : null,
  };
}

type Pair = { itemId: string; locationId: string };
// The page's own pairs, not every item with every place on it (auditor-2 and backend-3 on #394): one match per row.
const pairsWhere = (page: readonly Pair[]) => or(...page.map((p) => and(eq(stockMovements.itemId, p.itemId), eq(stockMovements.locationId, p.locationId))));

/** Each position's value: in, plus revaluations (signed), less out. */
async function positionValues(ctx: Ctx, page: readonly Pair[]): Promise<Map<string, string>> {
  if (page.length === 0) return new Map();
  const rows = await stockTx(ctx).select({ itemId: stockMovements.itemId, locationId: stockMovements.locationId, direction: stockMovements.direction,
    value: total(stockMovements.value) }).from(stockMovements).where(pairsWhere(page))
    .groupBy(stockMovements.itemId, stockMovements.locationId, stockMovements.direction);
  const out = new Map<string, string>();
  for (const r of rows) {
    const k = pairKey(r.itemId, r.locationId);
    const v = dec(r.value ?? '0');
    out.set(k, roundMoney(dec(out.get(k) ?? '0').plus(r.direction === 'out' ? v.neg() : v)));
  }
  return out;
}

/** Each position's batches with stock, "batch unknown" (null) among them, by batch number. */
async function positionBatches(ctx: Ctx, page: readonly Pair[]) {
  const out = new Map<string, { batchId: string | null; batchNo: string | null; qty: string }[]>();
  if (page.length === 0) return out;
  const tx = stockTx(ctx);
  const rows = await tx.select({ itemId: stockMovements.itemId, locationId: stockMovements.locationId, batchId: stockMovementBatches.batchId,
    direction: stockMovements.direction, qty: total(stockMovementBatches.qty) }).from(stockMovementBatches)
    .innerJoin(stockMovements, eq(stockMovements.id, stockMovementBatches.movementId)).where(pairsWhere(page))
    .groupBy(stockMovements.itemId, stockMovements.locationId, stockMovementBatches.batchId, stockMovements.direction);
  const ids = [...new Set(rows.flatMap((r) => (r.batchId === null ? [] : [r.batchId])))];
  const named = new Map((ids.length === 0 ? [] : await tx.select({ id: batches.id, batchNo: batches.batchNo }).from(batches)
    .where(inArray(batches.id, ids))).map((b) => [b.id, b.batchNo]));
  for (const [k, own] of Map.groupBy(rows, (r) => pairKey(r.itemId, r.locationId))) {
    out.set(k, batchQuantities(own).map((b) => ({ ...b, batchNo: b.batchId === null ? null : named.get(b.batchId) ?? null }))
      .toSorted((a, b) => (a.batchNo ?? '').localeCompare(b.batchNo ?? '')));
  }
  return out;
}

const unitColumns = {
  id: units.id, serialNo: units.serialNo, serialKey: units.serialKey, chassisNo: units.chassisNo, itemId: units.itemId, sku: items.sku,
  name: items.name, ownership: units.ownership, locationId: units.locationId, locationName: locations.name, condition: units.condition,
  batchNo: batches.batchNo, promisedTo: units.promisedTo,
};
const unitsFrom = (ctx: Ctx) => stockTx(ctx).select(unitColumns).from(units).innerJoin(items, eq(items.id, units.itemId))
  .leftJoin(locations, eq(locations.id, units.locationId)).leftJoin(batches, eq(batches.id, units.batchId));
const unitOut = (u: { id: string; serialNo: string; chassisNo: string | null; itemId: string; sku: string; name: string; ownership: string;
  locationId: string | null; locationName: string | null; condition: string; batchNo: string | null; promisedTo: string | null }) => ({
  id: u.id, serialNo: u.serialNo, chassisNo: u.chassisNo, itemId: u.itemId, sku: u.sku, name: u.name, ownership: ownershipOf.parse(u.ownership),
  locationId: u.locationId, locationName: u.locationName, condition: conditionOf.parse(u.condition), batchNo: u.batchNo, promised: u.promisedTo !== null,
});

/** GET /stock/units: by serial, `search` a prefix of a serial or a chassis number. */
export async function listUnitsPage(ctx: Ctx, input: In<typeof listStockUnits>): Promise<Out<typeof listStockUnits>> {
  const f = input.filter;
  const key = input.after === undefined ? undefined : decodeCursor(UNIT_KEY, input.after);
  const rows = await unitsFrom(ctx).where(and(
    f.itemId === undefined ? undefined : eq(units.itemId, f.itemId),
    f.locationId === undefined ? undefined : eq(units.locationId, f.locationId),
    f.ownership === undefined ? undefined : eq(units.ownership, f.ownership),
    f.search === undefined ? undefined : or(like(units.serialKey, prefix(serialKey(f.search))), like(units.chassisKey, prefix(chassisKey(f.search)))),
    after([units.serialKey, units.id], key && [key.serialKey, key.id], 'asc'),
  )).orderBy(asc(units.serialKey), asc(units.id)).limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return { items: page.map(unitOut), next: rows.length > input.limit && last ? encodeCursor({ serialKey: last.serialKey, id: last.id }) : null };
}

/** GET /stock/units/:id: the unit, and its events oldest first. */
export async function getUnitById(ctx: Ctx, { id }: In<typeof getStockUnit>): Promise<Out<typeof getStockUnit>> {
  const [u] = await unitsFrom(ctx).where(eq(units.id, id)).limit(1);
  if (u === undefined) throw new AppError('not_found', 'There is no such unit');
  const events = await stockTx(ctx).select({ id: unitEvents.id, kind: unitEvents.kind, businessDate: unitEvents.businessDate, postedAt: unitEvents.postedAt,
    locationId: unitEvents.locationId, locationName: locations.name, condition: unitEvents.condition, sourceTable: unitEvents.sourceTable,
    sourceId: unitEvents.sourceId }).from(unitEvents).leftJoin(locations, eq(locations.id, unitEvents.locationId))
    .where(eq(unitEvents.unitId, id)).orderBy(asc(unitEvents.postedAt), asc(unitEvents.id));
  return { ...unitOut(u), events: events.map((e) => ({ id: e.id, kind: eventKindOf.parse(e.kind), businessDate: e.businessDate,
    postedAt: e.postedAt.toISOString(), locationId: e.locationId, locationName: e.locationName,
    condition: e.condition === null ? null : conditionOf.parse(e.condition), source: { table: e.sourceTable, id: e.sourceId } })) };
}
