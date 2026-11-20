// The average cost a sale's below-cost check compares with (RAD-111, RC-131; ADR-006 §4, the architect's ruling on
// RAD-111). It's the moving average of what's on hand, never the last purchase rate: one item and place's V / Q, or,
// for a line with no place yet, ΣV / ΣQ over the sellable places holding stock. Null when nothing is on hand; the
// item's purchase price as the fallback, and `cost_unknown` past it, are lib-sales' checks.
import { locations, stockMovements, stockTx } from '@radcore/db/stock';
import { LOCATION_KIND_CODES, LOCATION_KINDS, type Rate } from '@radcore/lib-common';
import type { Ctx } from '@radcore/lib-platform';
import { and, eq, inArray, sum } from 'drizzle-orm';
import { averageOf, position } from '../engine/valuation.ts';

// Demo, rejected, job-work and in-transit stock keeps its own cost and is never sold from (§4, RC-205).
const SELLABLE = LOCATION_KIND_CODES.filter((k) => LOCATION_KINDS[k].sellable);

/** An item's average cost at a place, or over the sellable places with `locationId` null; null with nothing on hand. */
export async function averageCost(ctx: Ctx, itemId: string, locationId: string | null): Promise<Rate | null> {
  const rows = await stockTx(ctx).select({ locationId: stockMovements.locationId, direction: stockMovements.direction,
    qty: sum(stockMovements.qty), value: sum(stockMovements.value) }).from(stockMovements)
    .innerJoin(locations, eq(locations.id, stockMovements.locationId))
    .where(and(eq(stockMovements.itemId, itemId),
      locationId === null ? inArray(locations.kind, SELLABLE) : eq(stockMovements.locationId, locationId)))
    .groupBy(stockMovements.locationId, stockMovements.direction);
  const byPlace = new Map<string, typeof rows>();
  for (const r of rows) byPlace.set(r.locationId, [...(byPlace.get(r.locationId) ?? []), r]);
  return averageOf([...byPlace.values()].map((place) => position(place)));
}
