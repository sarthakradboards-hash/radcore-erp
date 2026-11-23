// What transfers, counts and adjustments share (M4-06, RAD-141; ADR-008 §9, §10): their places, each line's item and
// quantity, and the picks a line stores (its batches, and its serials or found units) as the engine takes them.
import { locations, stockTx } from '@radcore/db/stock';
import { LOCATION_KINDS, type LocationKind } from '@radcore/lib-common';
import { AppError, type Ctx } from '@radcore/lib-platform';
import { eq, inArray } from 'drizzle-orm';
import { checkQuantity } from './items.ts';

export type Place = { id: string; name: string; kind: LocationKind; sellable: boolean };

/** A place a document names, switched on (`unknown_location`, `location_inactive`), at `path`. */
export async function placeOf(ctx: Ctx, id: string, path: string): Promise<Place> {
  const [row] = await stockTx(ctx).select({ name: locations.name, kind: locations.kind, active: locations.active }).from(locations)
    .where(eq(locations.id, id)).limit(1);
  if (row === undefined) {
    throw new AppError('unknown_location', 'There is no such location', [{ path: [path], code: 'unknown', message: 'Choose a location' }]);
  }
  if (!row.active) {
    throw new AppError('location_inactive', 'This location is switched off', [{ path: [path], code: 'inactive', message: 'Choose another location' }]);
  }
  const kind = row.kind as LocationKind;
  return { id, name: row.name, kind, sellable: LOCATION_KINDS[kind].sellable };
}

/** Each place's name, by id, for a list or a document's page. */
export async function placeNames(ctx: Ctx, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await stockTx(ctx).select({ id: locations.id, name: locations.name }).from(locations).where(inArray(locations.id, [...new Set(ids)]));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Each line's item exists (`unknown_item`) and its quantity fits the item's unit (`quantity_too_precise`, `qty_not_positive`). */
export async function checkLines(ctx: Ctx, lines: readonly { itemId: string; qty: string }[]): Promise<void> {
  for (const [n, l] of lines.entries()) {
    await checkQuantity(ctx, l.itemId, l.qty).catch((e: unknown) => {
      if (!(e instanceof AppError)) throw e;
      if (e.code === 'not_found') {
        throw new AppError('unknown_item', 'There is no such item', [{ path: ['lines', n, 'itemId'], code: 'unknown', message: 'Choose an item' }]);
      }
      throw new AppError(e.code, e.message, [{ path: ['lines', n, 'qty'], code: e.code, message: e.message }]);
    });
  }
}

/** A line's batches and serials as its `picks` column keeps them. */
export type Picks<S> = { batches: { batchId: string | null; qty: string }[]; serials: S[] };
export const picksOf = <S>(json: unknown): Picks<S> => json as Picks<S>;
