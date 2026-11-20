// Which price list a sale is measured against (the architect on RAD-113; ADR-007 §9): a party's own list, set under
// prices:approve, else the company's `sales.default_price_list`. A document copies its list when it's made, and each
// priced line stores the list's rate for its item on the document's date, filled here and never from input, so a typed
// rate below the list counts against the maker's discount limit like a discount does. An item the list doesn't price
// stores no list rate: no discount is judged, and below cost still guards the floor.
import { partyPriceLists, priceLists, salesTx } from '@radcore/db/sales';
import { dec, roundRate, type Rate } from '@radcore/lib-common';
import { gstRateFor } from '@radcore/lib-gst';
import { AppError, defineSetting, type Ctx } from '@radcore/lib-platform';
import { itemLabels } from '@radcore/lib-stock';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { getPartyPriceList, setPartyPriceList } from '../contract.ts';
import { getPartyById } from '@radcore/lib-accounts';
import { priceFor } from './price-lists.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;

/** The list a party with none of its own is sold from (admin); none set: no list, so no discount is judged. */
export const DEFAULT_PRICE_LIST = defineSetting('sales.default_price_list', z.uuid().nullable(), null);

/** GET /sales/party-price-lists/:partyId (prices:read): the party's own list, or the default it takes. */
export async function getPartyList(ctx: Ctx, { partyId }: In<typeof getPartyPriceList>): Promise<Out<typeof getPartyPriceList>> {
  const [own] = await salesTx(ctx).select({ id: partyPriceLists.priceListId }).from(partyPriceLists).where(eq(partyPriceLists.partyId, partyId));
  return { priceListId: own?.id ?? ctx.settings.get(DEFAULT_PRICE_LIST), own: own !== undefined };
}

/** PUT /sales/party-price-lists/:partyId (prices:approve): the party's own list, or none (null) to take the default.
 * Choosing a party's list puts its prices in force for them, so it's the approver's key. The reason was kept by the
 * handler. */
export async function setPartyList(ctx: Ctx, { partyId, priceListId }: In<typeof setPartyPriceList>): Promise<Out<typeof setPartyPriceList>> {
  await getPartyById(ctx, { id: partyId }).catch((e: unknown) => {
    throw e instanceof AppError && e.code === 'not_found' ? new AppError('unknown_party', 'There is no such party') : e;
  });
  const tx = salesTx(ctx);
  if (priceListId === null) {
    await tx.delete(partyPriceLists).where(eq(partyPriceLists.partyId, partyId));
    return {};
  }
  const [list] = await tx.select({ active: priceLists.active }).from(priceLists).where(eq(priceLists.id, priceListId));
  if (list?.active !== true) {
    throw new AppError('unknown_price_list', 'There is no such price list, or it’s switched off',
      [{ path: ['priceListId'], code: 'unknown', message: 'Choose a price list in use' }]);
  }
  await tx.insert(partyPriceLists).values({ partyId, priceListId }).onConflictDoUpdate({ target: partyPriceLists.partyId, set: { priceListId } });
  return {};
}

/** The list a new document for the party copies: its own, else the default, else none. */
export async function priceListOf(ctx: Ctx, partyId: string): Promise<string | null> {
  return (await getPartyList(ctx, { partyId })).priceListId;
}

/** A line's list rate and the version it came from. */
export type ListRate = { listRate: Rate | null; listVersionId: string | null };
const NONE: ListRate = { listRate: null, listVersionId: null };

/**
 * Each item's list rate on `on`, before GST, as checkSale compares rates (the architect on RAD-111): a tax-inclusive
 * list's rate less the GST in force that day for the item, rate × 100 / (100 + GST %), to 6 places. No list, or no rate
 * in it for an item that day (`no_price`), is none.
 */
export async function listRatesOf(ctx: Ctx, listId: string | null, on: string, itemIds: readonly string[]): Promise<ListRate[]> {
  if (listId === null) return itemIds.map(() => NONE);
  const out: ListRate[] = [];
  let labels: Map<string, { hsn: string }> | undefined;
  for (const itemId of itemIds) {
    const price = await priceFor(ctx, listId, itemId, on).catch((e: unknown) => {
      if (e instanceof AppError && e.code === 'no_price') return null;
      throw e;
    });
    if (price === null) {
      out.push(NONE);
      continue;
    }
    if (!price.taxInclusive) {
      out.push({ listRate: price.rate, listVersionId: price.versionId });
      continue;
    }
    labels ??= await itemLabels(ctx, itemIds);
    const gst = (await gstRateFor(ctx, labels.get(itemId)?.hsn ?? '', on)).rate;
    out.push({ listRate: roundRate(dec(price.rate).times('100').div(dec('100').plus(dec(gst)))), listVersionId: price.versionId });
  }
  return out;
}
