// Price lists (M2-13, RAD-98; ADR-001 §5: lib-sales's). A list's prices are versions: the admin edits a draft and
// sends it for approval; another person approves that exact version (maker-checker, RAD-38: priceListApproval), which
// puts it in force from that day and supersedes the one before. Only a version in force prices anything (priceFor, on
// a document's business date), so a price never changes without a second person.
import { after, priceListRates, priceListVersions, priceLists, salesTx, searchWords } from '@radcore/db/sales';
import { indiaDate, type Rate } from '@radcore/lib-common';
import {
  AppError, decodeCursor, encodeCursor, requestApproval, sortedCursor, type ApprovalSpec, type Ctx,
} from '@radcore/lib-platform';
import { and, asc, eq, gt, inArray, isNotNull, isNull, lte, or } from 'drizzle-orm';
import { z } from 'zod';
import type {
  createPriceList, getPrice, getPriceList, getPriceListVersion, listPriceLists, putPriceListRates, requestPriceListApproval,
  setPriceListTax, startPriceListDraft, updatePriceList,
} from '../contract.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;

const NAME_SORT = { column: 'name', desc: false } as const;

// ux_price_lists_name_key's refusal, as name_taken; an unknown item's, as unknown_item; anything else as it is.
async function refused<T>(write: Promise<T>): Promise<T> {
  try {
    return await write;
  } catch (e) {
    const constraint = (e as { cause?: { constraint?: string } }).cause?.constraint;
    if (constraint === 'ux_price_lists_name_key') {
      throw new AppError('name_taken', 'Another price list has this name', [{ path: ['name'], code: 'taken', message: 'Choose another name' }]);
    }
    if (constraint === 'price_list_rates_item_id_items_id_fk') throw new AppError('unknown_item', 'One of these items doesn’t exist');
    throw e;
  }
}

export const notFound = () => new AppError('not_found', 'There is no such price list');
export const inForceNow = and(isNotNull(priceListVersions.inForceFrom), isNull(priceListVersions.supersededFrom));
/** The version in force on a business date: from its in_force_from, until the day before its superseded_from. */
const inForceOn = (on: string) => and(lte(priceListVersions.inForceFrom, on),
  or(isNull(priceListVersions.supersededFrom), gt(priceListVersions.supersededFrom, on)));

type ListRow = Out<typeof getPriceList>;

/** Lists as screens show them, each with its version in force now and its draft: the versions not superseded. */
async function withVersions(ctx: Ctx, lists: readonly { id: string; name: string; active: boolean }[]): Promise<ListRow[]> {
  const versions = lists.length === 0 ? [] : await salesTx(ctx).select({ id: priceListVersions.id, listId: priceListVersions.priceListId,
    taxInclusive: priceListVersions.taxInclusive, inForceFrom: priceListVersions.inForceFrom }).from(priceListVersions)
    .where(and(inArray(priceListVersions.priceListId, lists.map((r) => r.id)), isNull(priceListVersions.supersededFrom)));
  return lists.map((r) => {
    const live = versions.find((v) => v.listId === r.id && v.inForceFrom !== null);
    return { id: r.id, name: r.name, active: r.active,
      inForce: live?.inForceFrom ? { versionId: live.id, taxInclusive: live.taxInclusive, inForceFrom: live.inForceFrom } : null,
      draftId: versions.find((v) => v.listId === r.id && v.inForceFrom === null)?.id ?? null };
  });
}

/** GET /price-lists (prices:read): by name, a page at a time. */
export async function listListsPage(ctx: Ctx, input: In<typeof listPriceLists>): Promise<Out<typeof listPriceLists>> {
  const key = input.after === undefined ? undefined : decodeCursor(sortedCursor(NAME_SORT, z.string().max(80)), input.after);
  const { search, status } = input.filter;
  const rows = await salesTx(ctx).select({ id: priceLists.id, name: priceLists.name, active: priceLists.active, nameKey: priceLists.nameKey })
    .from(priceLists)
    .where(and(searchWords([priceLists.name], search),
      status === undefined ? undefined : eq(priceLists.active, status === 'active'),
      after([priceLists.nameKey, priceLists.id], key && [key.value, key.id], 'asc')))
    .orderBy(asc(priceLists.nameKey), asc(priceLists.id)).limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return { items: await withVersions(ctx, page),
    next: rows.length > input.limit && last ? encodeCursor({ ...NAME_SORT, value: last.nameKey, id: last.id }) : null };
}

/** GET /price-lists/:id (prices:read). */
export async function getList(ctx: Ctx, { id }: In<typeof getPriceList>): Promise<Out<typeof getPriceList>> {
  const lists = await salesTx(ctx).select({ id: priceLists.id, name: priceLists.name, active: priceLists.active }).from(priceLists)
    .where(eq(priceLists.id, id));
  const [row] = await withVersions(ctx, lists);
  if (row === undefined) throw notFound();
  return row;
}

/** POST /price-lists (prices:write): the list and its first, empty draft. */
export async function addList(ctx: Ctx, { name, taxInclusive }: In<typeof createPriceList>): Promise<Out<typeof createPriceList>> {
  const tx = salesTx(ctx);
  const [list] = await refused(tx.insert(priceLists).values({ name }).returning({ id: priceLists.id }));
  if (list === undefined) throw new Error('the insert returned no row');
  const [draft] = await tx.insert(priceListVersions).values({ priceListId: list.id, taxInclusive }).returning({ id: priceListVersions.id });
  if (draft === undefined) throw new Error('the insert returned no row');
  return { id: list.id, draftId: draft.id };
}

/** PATCH /price-lists/:id (prices:write). */
export async function changeList(ctx: Ctx, input: In<typeof updatePriceList>): Promise<Out<typeof updatePriceList>> {
  const { id, ...fields } = input;
  const changes = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  const tx = salesTx(ctx);
  const found = Object.keys(changes).length === 0
    ? await tx.select({ id: priceLists.id }).from(priceLists).where(eq(priceLists.id, id))
    : await refused(tx.update(priceLists).set(changes).where(eq(priceLists.id, id)).returning({ id: priceLists.id }));
  if (found.length === 0) throw notFound();
  return {};
}

/** POST /price-lists/:id/draft (prices:write): the list's draft, or a new one copied from the version in force. The
 * list's row is locked first, so two people starting a draft at once get the same one. */
export async function startDraft(ctx: Ctx, { id }: In<typeof startPriceListDraft>): Promise<Out<typeof startPriceListDraft>> {
  const tx = salesTx(ctx);
  const [list] = await tx.select({ id: priceLists.id }).from(priceLists).where(eq(priceLists.id, id)).for('update');
  if (list === undefined) throw notFound();
  const versions = await tx.select({ id: priceListVersions.id, taxInclusive: priceListVersions.taxInclusive,
    inForceFrom: priceListVersions.inForceFrom }).from(priceListVersions)
    .where(and(eq(priceListVersions.priceListId, id), isNull(priceListVersions.supersededFrom)));
  const draft = versions.find((v) => v.inForceFrom === null);
  if (draft !== undefined) return { draftId: draft.id };
  const live = versions.find((v) => v.inForceFrom !== null);
  if (live === undefined) throw new Error(`price list ${id} has neither a draft nor a version in force`);
  const [made] = await tx.insert(priceListVersions).values({ priceListId: id, taxInclusive: live.taxInclusive })
    .returning({ id: priceListVersions.id });
  if (made === undefined) throw new Error('the insert returned no row');
  const rates = await tx.select({ itemId: priceListRates.itemId, rate: priceListRates.rate }).from(priceListRates)
    .where(eq(priceListRates.versionId, live.id));
  if (rates.length > 0) await tx.insert(priceListRates).values(rates.map((r) => ({ versionId: made.id, ...r })));
  return { draftId: made.id };
}

export type VersionRow = { id: string; priceListId: string; taxInclusive: boolean; inForceFrom: string | null; supersededFrom: string | null };

/** A version's row, locked with `forUpdate`, so a change to it or its rates waits for an approval being decided. */
export async function versionRow(ctx: Ctx, id: string, forUpdate: boolean): Promise<VersionRow | undefined> {
  const q = salesTx(ctx).select({ id: priceListVersions.id, priceListId: priceListVersions.priceListId,
    taxInclusive: priceListVersions.taxInclusive, inForceFrom: priceListVersions.inForceFrom,
    supersededFrom: priceListVersions.supersededFrom }).from(priceListVersions).where(eq(priceListVersions.id, id));
  const [row] = forUpdate ? await q.for('update') : await q;
  return row;
}

/** The draft, locked; a version that was approved can't change (not_a_draft). Every write to a version or its rates
 * goes through here first (ADR-001 §8b: a part's write locks its record). */
async function lockedDraft(ctx: Ctx, id: string): Promise<VersionRow> {
  const row = await versionRow(ctx, id, true);
  if (row === undefined) throw notFound();
  if (row.inForceFrom !== null) throw new AppError('not_a_draft', 'This version was approved, so it can’t change. Start a new draft');
  return row;
}

const stateOf = (v: VersionRow) => (v.inForceFrom === null ? 'draft' : v.supersededFrom === null ? 'in_force' : 'superseded');

/** GET /price-lists/versions/:id (prices:read). */
export async function getVersion(ctx: Ctx, { id }: In<typeof getPriceListVersion>): Promise<Out<typeof getPriceListVersion>> {
  const v = await versionRow(ctx, id, false);
  if (v === undefined) throw notFound();
  return { id: v.id, priceListId: v.priceListId, taxInclusive: v.taxInclusive, state: stateOf(v),
    inForceFrom: v.inForceFrom, supersededFrom: v.supersededFrom };
}

/** PATCH /price-lists/versions/:id (prices:write). */
export async function setTax(ctx: Ctx, { id, taxInclusive }: In<typeof setPriceListTax>): Promise<Out<typeof setPriceListTax>> {
  await lockedDraft(ctx, id);
  await salesTx(ctx).update(priceListVersions).set({ taxInclusive }).where(eq(priceListVersions.id, id));
  return {};
}

/** PUT /price-lists/versions/:id/rates (prices:write): each rate set, or the item taken out with null. */
export async function putRates(ctx: Ctx, { id, rates }: In<typeof putPriceListRates>): Promise<Out<typeof putPriceListRates>> {
  await lockedDraft(ctx, id);
  const tx = salesTx(ctx);
  // Each item's old rate out, then the new ones in: the audit log has both, under the version's id.
  await tx.delete(priceListRates).where(and(eq(priceListRates.versionId, id), inArray(priceListRates.itemId, rates.map((r) => r.itemId))));
  const set = rates.flatMap((r) => (r.rate === null ? [] : [{ versionId: id, itemId: r.itemId, rate: r.rate }]));
  if (set.length > 0) await refused(tx.insert(priceListRates).values(set));
  return {};
}

/** POST /price-lists/versions/:id/approval (prices:write). */
export async function askApproval(ctx: Ctx, { id }: In<typeof requestPriceListApproval>): Promise<Out<typeof requestPriceListApproval>> {
  await lockedDraft(ctx, id);
  return requestApproval(ctx, priceListApproval, id);
}

/** What the approver sees, and approves by its hash: the list, whether the rates include GST, and every item's rate. */
type PriceListVersion = { priceListId: string; name: string; taxInclusive: boolean; rates: { itemId: string; rate: string }[] };

/**
 * The price-list approval (RAD-38). The record is a version, its rates are its parts. Approving supersedes the
 * version in force first, then puts this one in force, both from today (one in force per list is a unique index that
 * can't be deferred, so the order matters); rejecting leaves it a draft, for its maker to change and send again.
 * Neither changes what is approved (the engine checks it): only the two versions' dates.
 */
export const priceListApproval: ApprovalSpec<PriceListVersion> = {
  kind: 'price-list',
  table: 'price_list_versions',
  parts: ['price_list_rates'],
  async version(ctx, recordId, { forUpdate }) {
    const v = await versionRow(ctx, recordId, forUpdate);
    if (v === undefined) return null;
    const tx = salesTx(ctx);
    const [list] = await tx.select({ name: priceLists.name }).from(priceLists).where(eq(priceLists.id, v.priceListId));
    const rates = await tx.select({ itemId: priceListRates.itemId, rate: priceListRates.rate }).from(priceListRates)
      .where(eq(priceListRates.versionId, recordId)).orderBy(asc(priceListRates.itemId));
    return { priceListId: v.priceListId, name: list?.name ?? '', taxInclusive: v.taxInclusive, rates };
  },
  async approved(ctx, recordId) {
    const v = await lockedDraft(ctx, recordId);
    const tx = salesTx(ctx);
    const today = indiaDate(new Date());
    await tx.update(priceListVersions).set({ supersededFrom: today }).where(and(eq(priceListVersions.priceListId, v.priceListId), inForceNow));
    await tx.update(priceListVersions).set({ inForceFrom: today }).where(eq(priceListVersions.id, recordId));
  },
  async rejected() {
    // The version stays a draft; the engine records the rejection and its reason.
  },
};

/**
 * An item's price on a list on a business date (GET /price-lists/:id/price, and M3's quotes and bills, each on its own
 * date): the version in force that day. A list switched off, no version in force that day, or no rate for the item is
 * no_price: a missing price is never read as 0.
 */
export async function priceFor(ctx: Ctx, listId: string, itemId: string, on: string): Promise<{ versionId: string; rate: Rate; taxInclusive: boolean }> {
  const [row] = await salesTx(ctx).select({ versionId: priceListVersions.id, taxInclusive: priceListVersions.taxInclusive,
    rate: priceListRates.rate }).from(priceListVersions)
    .innerJoin(priceLists, and(eq(priceLists.id, priceListVersions.priceListId), eq(priceLists.active, true)))
    .innerJoin(priceListRates, and(eq(priceListRates.versionId, priceListVersions.id), eq(priceListRates.itemId, itemId)))
    .where(and(eq(priceListVersions.priceListId, listId), inForceOn(on)));
  if (row === undefined) throw new AppError('no_price', `This price list had no approved price for this item on ${on}`);
  // A unitPrice() column: numeric(18,6), a Rate.
  return { ...row, rate: row.rate as Rate };
}

/** GET /price-lists/:id/price (prices:read). */
export const priceOf = (ctx: Ctx, { id, itemId, on }: In<typeof getPrice>): Promise<Out<typeof getPrice>> => priceFor(ctx, id, itemId, on);
