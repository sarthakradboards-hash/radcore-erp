// Which price list a sale is measured against (the architect on RAD-113; ADR-007 §9): a party's own list, set under
// prices:approve, else the company's `sales.default_price_list`. A document copies its list when it's made, and each
// priced line stores the list's rate for its item on the document's date, filled here and never from input, so a typed
// rate below the list counts against the maker's discount limit like a discount does. An item the list doesn't price
// stores no list rate, and its line needs approval (no_list_rate, the architect's #256).
import { partyPriceLists, priceLists, salesTx } from '@radcore/db/sales';
import type { Rate } from '@radcore/lib-common';
import { AppError, defineSetting, type Ctx } from '@radcore/lib-platform';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { getPartyPriceList, getSalePrice, setPartyPriceList } from '../contract.ts';
import { getPartyById } from '@radcore/lib-accounts';
import { priceFor } from './price-lists.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;

/** The list a party with none of its own is sold from (admin); none set, or switched off since: no list, so each priced
 * line has no list rate and needs approval (no_list_rate, #256). */
export const DEFAULT_PRICE_LIST = defineSetting('sales.default_price_list', z.uuid().nullable(), null, {
  label: 'Default price list',
  description: 'The list a party with none of its own is sold from. With none, a priced line has no list rate and needs approval.',
  input: { kind: 'reference', record: 'price_list' },
  // An existing, active list (ADR-001 §8c). getPartyList treats one switched off since as none.
  check: async (ctx, id) => {
    if (id === null) return null;
    const [list] = await salesTx(ctx).select({ active: priceLists.active }).from(priceLists).where(eq(priceLists.id, id)).limit(1);
    return list?.active === true ? null : 'Choose a price list that exists and is switched on';
  },
});

/** GET /sales/party-price-lists/:partyId (prices:read): the party's own list, or the default it takes. A default
 * switched off since it was chosen reads as none (ADR-001 §8c, the auditor on #264). */
export async function getPartyList(ctx: Ctx, { partyId }: In<typeof getPartyPriceList>): Promise<Out<typeof getPartyPriceList>> {
  const tx = salesTx(ctx);
  const [own] = await tx.select({ id: partyPriceLists.priceListId }).from(partyPriceLists).where(eq(partyPriceLists.partyId, partyId));
  if (own !== undefined) return { priceListId: own.id, own: true };
  return { priceListId: await defaultListOf(ctx), own: false };
}

/** The default list, or none while it's unset or switched off since it was chosen. */
async function defaultListOf(ctx: Ctx): Promise<string | null> {
  const fallback = ctx.settings.get(DEFAULT_PRICE_LIST);
  const [list] = fallback === null ? [] : await salesTx(ctx).select({ active: priceLists.active }).from(priceLists).where(eq(priceLists.id, fallback));
  return list?.active === true ? fallback : null;
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

/** GET /sales/price (prices:read): the rate a quote or bill for the party (or anyone, with none named) would store for
 * the item on the date, from the same list and rates, so the counter shows what the bill will take. Nothing of cost. */
export async function salePrice(ctx: Ctx, { itemId, partyId, on }: In<typeof getSalePrice>): Promise<Out<typeof getSalePrice>> {
  const priceListId = partyId === undefined ? await defaultListOf(ctx) : await priceListOf(ctx, partyId);
  const [r] = await listRatesOf(ctx, priceListId, on, [itemId]);
  const priced = r !== undefined && r.listRate !== null;
  return { priceListId, versionId: priced ? r.listVersionId : null, rate: priced ? r.listRate : null, taxInclusive: priced ? r.listTaxInclusive : null };
}

/** A line's list rate, as its version prices it, the version, and whether that version's rates include GST. */
export type ListRate = { listRate: Rate | null; listVersionId: string | null; listTaxInclusive: boolean };
const NONE: ListRate = { listRate: null, listVersionId: null, listTaxInclusive: false };

/** Each item's list rate on `on`, as its version prices it: the checks take GST out of a tax-inclusive one exactly, at
 * the line's own GST rate (listRateBeforeTax). No list, or no rate in it for an item that day (`no_price`), is none. */
export async function listRatesOf(ctx: Ctx, listId: string | null, on: string, itemIds: readonly string[]): Promise<ListRate[]> {
  if (listId === null) return itemIds.map(() => NONE);
  const out: ListRate[] = [];
  for (const itemId of itemIds) {
    const price = await priceFor(ctx, listId, itemId, on).catch((e: unknown) => {
      if (e instanceof AppError && e.code === 'no_price') return null;
      throw e;
    });
    out.push(price === null ? NONE : { listRate: price.rate, listVersionId: price.versionId, listTaxInclusive: price.taxInclusive });
  }
  return out;
}
