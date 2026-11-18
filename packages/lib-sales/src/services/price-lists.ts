// Price lists (M2-13, RAD-98; ADR-001 §5: lib-sales's). A list's prices are versions: the admin edits a draft and
// sends it for approval; another person approves that exact version (maker-checker, RAD-38: priceListApproval), which
// puts it in force and supersedes the one before. Only the version in force prices anything (priceFor), so a price
// never changes without a second person.
import { after, priceListRates, priceListVersions, priceLists, salesTx, searchWords } from '@radcore/db/sales';
import {
  AppError, decodeCursor, encodeCursor, requestApproval, sortedCursor, type ApprovalSpec, type Ctx,
} from '@radcore/lib-platform';
import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type {
  createPriceList, getPrice, getPriceListVersion, listPriceListRates, listPriceLists, putPriceListRates,
  requestPriceListApproval, setPriceListTax, startPriceListDraft, updatePriceList,
} from '../contract.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;

const NAME_SORT = { column: 'name', desc: false } as const;

// ux_price_lists_name_key's refusal, as name_taken; anything else is thrown as it is.
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

const notFound = () => new AppError('not_found', 'There is no such price list');
const inForce = and(isNotNull(priceListVersions.approvedAt), isNull(priceListVersions.supersededAt));

/** GET /price-lists (prices:read): by name, a page at a time, each with its version in force and its draft. */
export async function listListsPage(ctx: Ctx, input: In<typeof listPriceLists>): Promise<Out<typeof listPriceLists>> {
  const key = input.after === undefined ? undefined : decodeCursor(sortedCursor(NAME_SORT, z.string().max(80)), input.after);
  const { search, status } = input.filter;
  const tx = salesTx(ctx);
  const rows = await tx.select({ id: priceLists.id, name: priceLists.name, active: priceLists.active, nameKey: priceLists.nameKey })
    .from(priceLists)
    .where(and(searchWords([priceLists.name], search),
      status === undefined ? undefined : eq(priceLists.active, status === 'active'),
      after([priceLists.nameKey, priceLists.id], key && [key.value, key.id], 'asc')))
    .orderBy(asc(priceLists.nameKey), asc(priceLists.id)).limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const versions = page.length === 0 ? [] : await tx.select({ id: priceListVersions.id, listId: priceListVersions.priceListId,
    taxInclusive: priceListVersions.taxInclusive, approvedAt: priceListVersions.approvedAt }).from(priceListVersions)
    .where(and(inArray(priceListVersions.priceListId, page.map((r) => r.id)), isNull(priceListVersions.supersededAt)));
  const last = page.at(-1);
  return {
    items: page.map((r) => {
      const live = versions.find((v) => v.listId === r.id && v.approvedAt !== null);
      return { id: r.id, name: r.name, active: r.active,
        inForce: live?.approvedAt ? { versionId: live.id, taxInclusive: live.taxInclusive, approvedAt: live.approvedAt.toISOString() } : null,
        draftId: versions.find((v) => v.listId === r.id && v.approvedAt === null)?.id ?? null };
    }),
    next: rows.length > input.limit && last ? encodeCursor({ ...NAME_SORT, value: last.nameKey, id: last.id }) : null,
  };
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
    approvedAt: priceListVersions.approvedAt }).from(priceListVersions)
    .where(and(eq(priceListVersions.priceListId, id), isNull(priceListVersions.supersededAt)));
  const draft = versions.find((v) => v.approvedAt === null);
  if (draft !== undefined) return { draftId: draft.id };
  const live = versions.find((v) => v.approvedAt !== null);
  if (live === undefined) throw new Error(`price list ${id} has neither a draft nor a version in force`);
  const [made] = await tx.insert(priceListVersions).values({ priceListId: id, taxInclusive: live.taxInclusive })
    .returning({ id: priceListVersions.id });
  if (made === undefined) throw new Error('the insert returned no row');
  const rates = await tx.select({ itemId: priceListRates.itemId, rate: priceListRates.rate }).from(priceListRates)
    .where(eq(priceListRates.versionId, live.id));
  if (rates.length > 0) await tx.insert(priceListRates).values(rates.map((r) => ({ versionId: made.id, ...r })));
  return { draftId: made.id };
}

type VersionRow = { id: string; priceListId: string; taxInclusive: boolean; approvedAt: Date | null; supersededAt: Date | null };

/** A version's row, locked with `forUpdate`, so a change to it or its rates waits for an approval being decided. */
async function versionRow(ctx: Ctx, id: string, forUpdate: boolean): Promise<VersionRow | undefined> {
  const q = salesTx(ctx).select({ id: priceListVersions.id, priceListId: priceListVersions.priceListId,
    taxInclusive: priceListVersions.taxInclusive, approvedAt: priceListVersions.approvedAt,
    supersededAt: priceListVersions.supersededAt }).from(priceListVersions).where(eq(priceListVersions.id, id));
  const [row] = forUpdate ? await q.for('update') : await q;
  return row;
}

/** The draft, locked; a version that was approved can't change (not_a_draft). Every write to a version or its rates
 * goes through here first (ADR-001 §8b: a part's write locks its record). */
async function lockedDraft(ctx: Ctx, id: string): Promise<VersionRow> {
  const row = await versionRow(ctx, id, true);
  if (row === undefined) throw notFound();
  if (row.approvedAt !== null) throw new AppError('not_a_draft', 'This version was approved, so it can’t change. Start a new draft');
  return row;
}

const stateOf = (v: VersionRow) => (v.approvedAt === null ? 'draft' : v.supersededAt === null ? 'in_force' : 'superseded');

/** GET /price-lists/versions/:id (prices:read). */
export async function getVersion(ctx: Ctx, { id }: In<typeof getPriceListVersion>): Promise<Out<typeof getPriceListVersion>> {
  const v = await versionRow(ctx, id, false);
  if (v === undefined) throw notFound();
  return { id: v.id, priceListId: v.priceListId, taxInclusive: v.taxInclusive, state: stateOf(v),
    approvedAt: v.approvedAt?.toISOString() ?? null, supersededAt: v.supersededAt?.toISOString() ?? null };
}

/** GET /price-lists/versions/:id/rates (prices:read): by item id, a page at a time. */
export async function listRatesPage(ctx: Ctx, input: In<typeof listPriceListRates>): Promise<Out<typeof listPriceListRates>> {
  if (await versionRow(ctx, input.id, false) === undefined) throw notFound();
  const key = input.after === undefined ? undefined : decodeCursor(z.object({ itemId: z.uuid() }), input.after);
  const rows = await salesTx(ctx).select({ itemId: priceListRates.itemId, rate: priceListRates.rate }).from(priceListRates)
    .where(and(eq(priceListRates.versionId, input.id), after([priceListRates.itemId], key && [key.itemId], 'asc')))
    .orderBy(asc(priceListRates.itemId)).limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return { items: page, next: rows.length > input.limit && last ? encodeCursor({ itemId: last.itemId }) : null };
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

/** What the approver sees, and approves by its hash: whether the rates include GST, and every item's rate. */
type PriceListVersion = { priceListId: string; taxInclusive: boolean; rates: { itemId: string; rate: string }[] };

/**
 * The price-list approval (RAD-38). The record is a version, its rates are its parts. Approving puts it in force and
 * supersedes the version before; rejecting leaves it a draft, for its maker to change and send again. Neither changes
 * what is approved (the engine checks it): only the version's approved_at and the old version's superseded_at.
 */
export const priceListApproval: ApprovalSpec<PriceListVersion> = {
  kind: 'price-list',
  table: 'price_list_versions',
  parts: ['price_list_rates'],
  async version(ctx, recordId, { forUpdate }) {
    const v = await versionRow(ctx, recordId, forUpdate);
    if (v === undefined) return null;
    const rates = await salesTx(ctx).select({ itemId: priceListRates.itemId, rate: priceListRates.rate }).from(priceListRates)
      .where(eq(priceListRates.versionId, recordId)).orderBy(asc(priceListRates.itemId));
    return { priceListId: v.priceListId, taxInclusive: v.taxInclusive, rates };
  },
  async approved(ctx, recordId) {
    const v = await lockedDraft(ctx, recordId);
    const tx = salesTx(ctx);
    const now = new Date();
    await tx.update(priceListVersions).set({ supersededAt: now }).where(and(eq(priceListVersions.priceListId, v.priceListId), inForce));
    await tx.update(priceListVersions).set({ approvedAt: now }).where(eq(priceListVersions.id, recordId));
  },
  async rejected() {
    // The version stays a draft; the engine records the rejection and its reason.
  },
};

/**
 * An item's price on a list, from the version in force (GET /price-lists/:id/price, and M3's quotes and bills). A list
 * switched off, no version in force, or no rate for the item is no_price: a missing price is never read as 0.
 */
export async function priceFor(ctx: Ctx, listId: string, itemId: string): Promise<Out<typeof getPrice>> {
  const [row] = await salesTx(ctx).select({ versionId: priceListVersions.id, taxInclusive: priceListVersions.taxInclusive,
    rate: priceListRates.rate }).from(priceListVersions)
    .innerJoin(priceLists, and(eq(priceLists.id, priceListVersions.priceListId), eq(priceLists.active, true)))
    .innerJoin(priceListRates, and(eq(priceListRates.versionId, priceListVersions.id), eq(priceListRates.itemId, itemId)))
    .where(and(eq(priceListVersions.priceListId, listId), inForce));
  if (row === undefined) throw new AppError('no_price', 'This price list has no approved price for this item');
  return row;
}

/** GET /price-lists/:id/price (prices:read). */
export const priceOf = (ctx: Ctx, { id, itemId }: In<typeof getPrice>) => priceFor(ctx, id, itemId);
