// Price lists as screens read them, with each item's SKU, name and unit from lib-stock (RAD-98, for ui-2's screens):
// a version's rates, and what a version changes against the version in force, which the approver reads beside the
// approval's hash so no one approves blind (RC-037). Kept apart from price-lists.ts so only these reads reach lib-stock.
import { after, priceListRates, priceListVersions, priceLists, salesTx } from '@radcore/db/sales';
import { dec } from '@radcore/lib-common';
import { decodeCursor, encodeCursor, type Ctx } from '@radcore/lib-platform';
import { itemLabels } from '@radcore/lib-stock';
import { and, asc, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import type { getPriceListChanges, listPriceListRates } from '../contract.ts';
import { inForceNow, notFound, versionRow } from './price-lists.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;

// An item gone from the items table can't be: price_list_rates.item_id is a foreign key that restricts deletes.
const labelOf = (labels: Awaited<ReturnType<typeof itemLabels>>, itemId: string) =>
  ({ itemId, ...(labels.get(itemId) ?? { sku: '', name: '', unit: '' }) });

/** GET /price-lists/versions/:id/rates (prices:read): by item id, a page at a time. */
export async function listRatesPage(ctx: Ctx, input: In<typeof listPriceListRates>): Promise<Out<typeof listPriceListRates>> {
  if (await versionRow(ctx, input.id, false) === undefined) throw notFound();
  const key = input.after === undefined ? undefined : decodeCursor(z.object({ itemId: z.uuid() }), input.after);
  const rows = await salesTx(ctx).select({ itemId: priceListRates.itemId, rate: priceListRates.rate }).from(priceListRates)
    .where(and(eq(priceListRates.versionId, input.id), after([priceListRates.itemId], key && [key.itemId], 'asc')))
    .orderBy(asc(priceListRates.itemId)).limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const labels = await itemLabels(ctx, page.map((r) => r.itemId));
  const last = page.at(-1);
  return { items: page.map((r) => ({ ...labelOf(labels, r.itemId), rate: r.rate })),
    next: rows.length > input.limit && last ? encodeCursor({ itemId: last.itemId }) : null };
}

/**
 * GET /price-lists/versions/:id/changes (prices:read). Every item whose rate differs between this version and the one
 * in force now, by SKU. shortcut: the whole difference in one answer, as the approver must see all of it; a list of a
 * few thousand items is still one screen's worth. Page it if a list ever outgrows that.
 */
export async function getChanges(ctx: Ctx, { id }: In<typeof getPriceListChanges>): Promise<Out<typeof getPriceListChanges>> {
  const v = await versionRow(ctx, id, false);
  if (v === undefined) throw notFound();
  const tx = salesTx(ctx);
  const [list] = await tx.select({ name: priceLists.name }).from(priceLists).where(eq(priceLists.id, v.priceListId));
  const [live] = await tx.select({ id: priceListVersions.id, taxInclusive: priceListVersions.taxInclusive }).from(priceListVersions)
    .where(and(eq(priceListVersions.priceListId, v.priceListId), inForceNow, ne(priceListVersions.id, id)));
  const ratesOf = async (versionId: string) => new Map((await tx.select({ itemId: priceListRates.itemId, rate: priceListRates.rate })
    .from(priceListRates).where(eq(priceListRates.versionId, versionId))).map((r) => [r.itemId, r.rate]));
  const proposed = await ratesOf(id);
  // A draft against the version in force (none: every rate is new); an approved version changes nothing.
  const current = v.inForceFrom !== null ? proposed : live === undefined ? new Map<string, string>() : await ratesOf(live.id);
  const differs = (a: string | undefined, b: string | undefined) => (a === undefined || b === undefined ? a !== b : !dec(a).eq(b));
  const changed = [...new Set([...proposed.keys(), ...current.keys()])].filter((itemId) => differs(proposed.get(itemId), current.get(itemId)));
  const labels = await itemLabels(ctx, changed);
  const changes = changed.map((itemId) => ({ ...labelOf(labels, itemId), inForce: current.get(itemId) ?? null, proposed: proposed.get(itemId) ?? null }))
    .sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0));
  return { versionId: id, priceListId: v.priceListId, name: list?.name ?? '', taxInclusive: v.taxInclusive,
    inForce: live === undefined ? null : { versionId: live.id, taxInclusive: live.taxInclusive }, changes };
}
