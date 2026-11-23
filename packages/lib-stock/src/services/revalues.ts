// A document's own revaluations (RAD-138): what its `revalue` movements put on each position, by item and location, for
// a purchase bill's cancel, which takes its price difference back where the goods are now (the architect on RAD-138,
// ADR-008 §7). Values, read for the document's own service, never shown: whoever may cancel the document may undo them.
import { stockMovements, stockTx } from '@radcore/db/stock';
import { dec, roundMoney, type Money } from '@radcore/lib-common';
import type { Ctx } from '@radcore/lib-platform';
import { and, asc, eq, sum } from 'drizzle-orm';

/** The net value each of the document's revalue movements put on each position, leaving out any that net to 0. */
export async function revaluesOf(ctx: Ctx, sourceTable: string, sourceId: string): Promise<{ itemId: string; locationId: string; value: Money }[]> {
  const rows = await stockTx(ctx).select({ itemId: stockMovements.itemId, locationId: stockMovements.locationId, value: sum(stockMovements.value) })
    .from(stockMovements).where(and(eq(stockMovements.sourceTable, sourceTable), eq(stockMovements.sourceId, sourceId),
      eq(stockMovements.direction, 'revalue')))
    .groupBy(stockMovements.itemId, stockMovements.locationId).orderBy(asc(stockMovements.itemId), asc(stockMovements.locationId));
  return rows.map((r) => ({ itemId: r.itemId, locationId: r.locationId, value: roundMoney(r.value ?? '0') }))
    .filter((r) => !dec(r.value).isZero());
}
