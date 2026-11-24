// The books check's stock figures (M2-07, RAD-95, ADR-006 §7, RC-063): lib-accounts' trial balance and Stock in Hand,
// and this library's ledger and batches. lib-service's checkBooks, the lowest library that reads every side (ADR-001
// §3), adds the other modules' figures and runs rules/books.ts over them, in one REPEATABLE READ snapshot.
import { stockMovementBatches, stockMovements, stockTx } from '@radcore/db/stock';
import { stockInHand, trialBalance } from '@radcore/lib-accounts';
import { dec, type Decimal } from '@radcore/lib-common';
import type { Ctx } from '@radcore/lib-platform';
import { and, eq, lte, sum } from 'drizzle-orm';
import type { BooksFigures } from '../rules/books.ts';

type Net = { itemId: string; locationId: string; qty: Decimal; value: Decimal };

/** Each item and place's rows, summed by direction, netted: an `out` takes its quantity and value away. A `revalue`
 * row is added as it is: its quantity is 0 and its value carries its own sign (ck_stock_movements_value_sign), the
 * only direction whose value may be below zero. */
function netted(rows: readonly { itemId: string; locationId: string; direction: string; qty: string | null; value?: string | null }[]) {
  const at = new Map<string, Net>();
  for (const r of rows) {
    const key = `${r.itemId}|${r.locationId}`;
    const sign = r.direction === 'out' ? -1 : 1;
    const n = at.get(key) ?? { itemId: r.itemId, locationId: r.locationId, qty: dec('0'), value: dec('0') };
    at.set(key, { ...n, qty: n.qty.plus(dec(r.qty ?? '0').times(sign)), value: n.value.plus(dec(r.value ?? '0').times(sign)) });
  }
  return [...at.values()].map((n) => ({ itemId: n.itemId, locationId: n.locationId, qty: n.qty.toString(), value: n.value.toString() }));
}

/** The stock ledger per item and place, as at `asAt` (every movement when it's left out). */
async function ledgerAt(ctx: Ctx, asAt?: string) {
  return netted(await stockTx(ctx).select({ itemId: stockMovements.itemId, locationId: stockMovements.locationId,
    direction: stockMovements.direction, qty: sum(stockMovements.qty), value: sum(stockMovements.value) }).from(stockMovements)
    .where(asAt === undefined ? undefined : lte(stockMovements.businessDate, asAt))
    .groupBy(stockMovements.itemId, stockMovements.locationId, stockMovements.direction));
}

/** The stock side of the books check, as at `asAt` (every posting when it's left out): every figure but GRNI's and JWCB's. */
export async function stockBooksFigures(ctx: Ctx, asAt?: string): Promise<Omit<BooksFigures, 'grni' | 'jwcb'>> {
  const trial = await trialBalance(ctx, asAt);
  const books = await stockInHand(ctx, asAt);
  const ledger = await ledgerAt(ctx, asAt);
  const current = asAt === undefined ? ledger : await ledgerAt(ctx);
  const batches = netted(await stockTx(ctx).select({ itemId: stockMovements.itemId, locationId: stockMovements.locationId,
    direction: stockMovements.direction, qty: sum(stockMovementBatches.qty) }).from(stockMovementBatches)
    .innerJoin(stockMovements, and(eq(stockMovements.id, stockMovementBatches.movementId), eq(stockMovements.itemId, stockMovementBatches.itemId)))
    .groupBy(stockMovements.itemId, stockMovements.locationId, stockMovements.direction));
  return { trial, books, ledger, current, batches };
}
