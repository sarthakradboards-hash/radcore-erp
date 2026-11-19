// The books check (M2-07, RAD-95, ADR-006 §7, RC-063). It lives in lib-stock, the lowest library that reads both the
// stock ledger and the books (ADR-001 §3). Each side is its own module's read: lib-accounts' trial balance and Stock in
// Hand, and this library's ledger and batches. The route runs it in one REPEATABLE READ snapshot, so every figure is
// from the same moment; rules/books.ts compares them.
import { stockMovementBatches, stockMovements, stockTx } from '@radcore/db/stock';
import { stockInHand, trialBalance } from '@radcore/lib-accounts';
import { dec, type Decimal } from '@radcore/lib-common';
import type { Ctx } from '@radcore/lib-platform';
import { and, eq, lte, sum } from 'drizzle-orm';
import type { z } from 'zod';
import type { checkBooksContract } from '../contract.ts';
import { booksProblems } from '../rules/books.ts';

type In = z.output<(typeof checkBooksContract)['input']>;
type Out = z.input<(typeof checkBooksContract)['output']>;
type Net = { itemId: string; locationId: string; qty: Decimal; value: Decimal };

/** Each item and place's rows, summed by direction, netted: an `out` takes its quantity and value away. */
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

/** GET /books/check: what disagrees, none when the books are healthy. */
export async function checkBooks(ctx: Ctx, { asAt }: In): Promise<Out> {
  const trial = await trialBalance(ctx, asAt);
  const books = await stockInHand(ctx, asAt);
  const ledger = await ledgerAt(ctx, asAt);
  const current = asAt === undefined ? ledger : await ledgerAt(ctx);
  const batches = netted(await stockTx(ctx).select({ itemId: stockMovements.itemId, locationId: stockMovements.locationId,
    direction: stockMovements.direction, qty: sum(stockMovementBatches.qty) }).from(stockMovementBatches)
    .innerJoin(stockMovements, and(eq(stockMovements.id, stockMovementBatches.movementId), eq(stockMovements.itemId, stockMovementBatches.itemId)))
    .groupBy(stockMovements.itemId, stockMovements.locationId, stockMovements.direction));
  return { problems: booksProblems({ trial, books, ledger, current, batches }) };
}
