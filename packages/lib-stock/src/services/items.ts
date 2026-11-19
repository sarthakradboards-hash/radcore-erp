// Items, their categories and units of measure (M2-10, RAD-89; ADR-001 §5: lib-stock's). Every write is audited by
// the tables' triggers. A quantity follows its item's unit (RC-162): checkQuantity is what every stock document calls.
import { after, itemCategories, itemPictures, items, searchWords, stockMovements, stockTx, units, unitsOfMeasure } from '@radcore/db/stock';
import { AppError, decodeCursor, encodeCursor, readyFile, viewLinks, type Ctx } from '@radcore/lib-platform';
import { and, asc, eq, inArray, isNotNull, or } from 'drizzle-orm';
import { z } from 'zod';
import type {
  attachItemPicture, createItem, createItemCategory, getItem, listItemCategories, listItems, listUnitsOfMeasure, removeItemPicture,
  renameItemCategory, updateItem,
} from '../contract.ts';
import { quantityFits } from '../rules/quantity.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;
type Tx = ReturnType<typeof stockTx>;

const itemColumns = {
  id: items.id, sku: items.sku, name: items.name, categoryId: items.categoryId, hsn: items.hsn, unit: items.unit,
  barcode: items.barcode, serialised: items.serialised, hasChassis: items.hasChassis, active: items.active,
};
const field = (path: string, code: string, message: string) => [{ path: [path], code, message }];

/** A unique key's refusal, by its index, as the contract's error: a race the checks before it couldn't see. */
async function uniquely<T>(write: Promise<T>, refusals: Readonly<Record<string, AppError>>): Promise<T> {
  try {
    return await write;
  } catch (e) {
    const refusal = refusals[(e as { cause?: { constraint?: string } }).cause?.constraint ?? ''];
    if (refusal !== undefined) throw refusal;
    throw e;
  }
}
const nameTaken = () => new AppError('name_taken', 'Another category already has this name', field('name', 'taken', 'Choose another name'));
const skuTaken = () => new AppError('sku_taken', 'Another item already has this SKU', field('sku', 'taken', 'Choose another SKU'));
const barcodeTaken = () => new AppError('barcode_taken', 'Another item already has this barcode', field('barcode', 'taken', 'Check the barcode'));

/** The category and unit an item names must both exist. */
async function checkRefs(tx: Tx, { categoryId, unit }: { categoryId?: string | undefined; unit?: string | undefined }) {
  if (categoryId !== undefined && (await tx.select({ id: itemCategories.id }).from(itemCategories).where(eq(itemCategories.id, categoryId)).limit(1)).length === 0) {
    throw new AppError('unknown_category', 'There is no such category', field('categoryId', 'unknown', 'Choose a category'));
  }
  if (unit !== undefined && (await tx.select({ code: unitsOfMeasure.code }).from(unitsOfMeasure).where(eq(unitsOfMeasure.code, unit)).limit(1)).length === 0) {
    throw new AppError('unknown_unit', 'There is no such unit', field('unit', 'unknown', 'Choose a unit'));
  }
}

const MAX_PICTURES = 8;
type ItemRow = Omit<Out<typeof getItem>, 'pictures'>;

/** The items with their pictures in order, each a view link from lib-platform's files (none while it's checked). */
async function withPictures(ctx: Ctx, rows: readonly ItemRow[]): Promise<Out<typeof getItem>[]> {
  const ids = rows.map((r) => r.id);
  const pics = ids.length === 0 ? [] : await stockTx(ctx).select({ itemId: itemPictures.itemId, fileId: itemPictures.fileId })
    .from(itemPictures).where(inArray(itemPictures.itemId, ids)).orderBy(asc(itemPictures.itemId), asc(itemPictures.position));
  const links = await viewLinks(ctx, 'item_picture', pics.map((p) => p.fileId));
  return rows.map((r) => ({ ...r, pictures: pics.filter((p) => p.itemId === r.id).map((p) => ({ fileId: p.fileId, url: links.get(p.fileId) ?? null })) }));
}

/** GET /units-of-measure. */
export async function listUnits(ctx: Ctx): Promise<Out<typeof listUnitsOfMeasure>> {
  return { units: await stockTx(ctx).select({ code: unitsOfMeasure.code, name: unitsOfMeasure.name, decimals: unitsOfMeasure.decimals })
    .from(unitsOfMeasure).orderBy(asc(unitsOfMeasure.code)) };
}

/** GET /item-categories. */
export async function listCategories(ctx: Ctx): Promise<Out<typeof listItemCategories>> {
  return { categories: await stockTx(ctx).select({ id: itemCategories.id, name: itemCategories.name }).from(itemCategories)
    .orderBy(asc(itemCategories.nameKey)) };
}

/** POST /item-categories. */
export async function addCategory(ctx: Ctx, { name }: In<typeof createItemCategory>): Promise<Out<typeof createItemCategory>> {
  const [row] = await uniquely(stockTx(ctx).insert(itemCategories).values({ name }).returning({ id: itemCategories.id }),
    { ux_item_categories_name_key: nameTaken() });
  if (row === undefined) throw new Error('The category was not saved');
  return row;
}

/** PATCH /item-categories/:id. */
export async function renameCategory(ctx: Ctx, { id, name }: In<typeof renameItemCategory>): Promise<Out<typeof renameItemCategory>> {
  const done = await uniquely(stockTx(ctx).update(itemCategories).set({ name }).where(eq(itemCategories.id, id))
    .returning({ id: itemCategories.id }), { ux_item_categories_name_key: nameTaken() });
  if (done.length === 0) throw new AppError('not_found', 'There is no such category');
  return {};
}

/** GET /items: by name, then id, so a page key is unique and paging never skips or repeats. */
export async function listItemsPage(ctx: Ctx, input: In<typeof listItems>): Promise<Out<typeof listItems>> {
  const { items: page, next } = await listItemRows(ctx, input);
  return { items: await withPictures(ctx, page), next };
}

/** GET /items' page without its pictures, for the masters workbook, which signs no picture links (auditor-2 on #205). */
export async function listItemRows(ctx: Ctx, input: In<typeof listItems>): Promise<{ items: ItemRow[]; next: string | null }> {
  const key = input.after === undefined ? undefined : decodeCursor(z.object({ name: z.string().max(200), id: z.uuid() }), input.after);
  const { search, categoryId, active } = input.filter;
  // Words in the name or SKU, or the whole text as a scanned barcode, whatever its case.
  const words = searchWords([items.name, items.sku], search);
  const rows = await stockTx(ctx).select(itemColumns).from(items)
    .where(and(
      words === undefined ? undefined : or(words, eq(items.barcodeKey, (search ?? '').trim().toUpperCase())),
      categoryId === undefined ? undefined : eq(items.categoryId, categoryId),
      active === undefined ? undefined : eq(items.active, active),
      after([items.name, items.id], key && [key.name, key.id], 'asc'),
    ))
    .orderBy(asc(items.name), asc(items.id)).limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return { items: page, next: rows.length > input.limit && last ? encodeCursor({ name: last.name, id: last.id }) : null };
}

/** GET /items/:id. */
export async function getItemById(ctx: Ctx, { id }: In<typeof getItem>): Promise<Out<typeof getItem>> {
  const [row] = await stockTx(ctx).select(itemColumns).from(items).where(eq(items.id, id)).limit(1);
  if (row === undefined) throw new AppError('not_found', 'There is no such item');
  const [answer] = await withPictures(ctx, [row]);
  if (answer === undefined) throw new Error('The item was not answered');
  return answer;
}

/** Each item's SKU, name and unit, by id, for another library showing the items it refers to (lib-sales' price lists).
 * An id that names no item is left out. */
export async function itemLabels(ctx: Ctx, ids: readonly string[]): Promise<Map<string, { sku: string; name: string; unit: string }>> {
  if (ids.length === 0) return new Map();
  const rows = await stockTx(ctx).select({ id: items.id, sku: items.sku, name: items.name, unit: items.unit }).from(items)
    .where(inArray(items.id, [...ids]));
  return new Map(rows.map((r) => [r.id, { sku: r.sku, name: r.name, unit: r.unit }]));
}

/** POST /items/:id/pictures: the file must be a ready item picture; it takes the lowest free place, so a gap left by
 * a removed picture is filled. The item's row is locked, so two pictures added at once take turns and never share a
 * place (the auditor on #178: the next after the last could be 8, past the CHECK). */
export async function addItemPicture(ctx: Ctx, { id, fileId }: In<typeof attachItemPicture>): Promise<Out<typeof attachItemPicture>> {
  const tx = stockTx(ctx);
  const [item] = await tx.select({ id: items.id }).from(items).where(eq(items.id, id)).limit(1).for('update');
  if (item === undefined) throw new AppError('not_found', 'There is no such item');
  await readyFile(ctx, 'item_picture', fileId);
  const taken = new Set((await tx.select({ position: itemPictures.position }).from(itemPictures).where(eq(itemPictures.itemId, id)))
    .map((p) => p.position));
  const position = Array.from({ length: MAX_PICTURES }, (_, i) => i).find((i) => !taken.has(i));
  if (position === undefined) throw new AppError('too_many_pictures', `An item has at most ${MAX_PICTURES} pictures`);
  await uniquely(tx.insert(itemPictures).values({ fileId, itemId: id, position }),
    { item_pictures_pkey: new AppError('picture_attached', 'This picture is already on an item') });
  return {};
}

/** DELETE /items/:id/pictures/:fileId: the picture comes off; the file itself is kept (D-12). */
export async function dropItemPicture(ctx: Ctx, { id, fileId }: In<typeof removeItemPicture>): Promise<Out<typeof removeItemPicture>> {
  const gone = await stockTx(ctx).delete(itemPictures).where(and(eq(itemPictures.itemId, id), eq(itemPictures.fileId, fileId)))
    .returning({ fileId: itemPictures.fileId });
  if (gone.length === 0) throw new AppError('not_found', 'This item has no such picture');
  return {};
}

/** POST /items. */
export async function addItem(ctx: Ctx, input: In<typeof createItem>): Promise<Out<typeof createItem>> {
  const tx = stockTx(ctx);
  await checkRefs(tx, input);
  const [row] = await uniquely(tx.insert(items).values(input).returning({ id: items.id }),
    { ux_items_sku_key: skuTaken(), ux_items_barcode_key: barcodeTaken() });
  if (row === undefined) throw new Error('The item was not saved');
  return row;
}

/** PATCH /items/:id. The item's row is locked, so two changes take turns and the chassis rule sees the latest. */
export async function changeItem(ctx: Ctx, { id, ...change }: In<typeof updateItem>): Promise<Out<typeof updateItem>> {
  const tx = stockTx(ctx);
  const [now] = await tx.select({ serialised: items.serialised, hasChassis: items.hasChassis, unit: items.unit }).from(items)
    .where(eq(items.id, id)).limit(1).for('update');
  if (now === undefined) throw new AppError('not_found', 'There is no such item');
  const next = { serialised: change.serialised ?? now.serialised, hasChassis: change.hasChassis ?? now.hasChassis };
  if (next.hasChassis && !next.serialised) {
    throw new AppError('chassis_needs_serial', 'Only a serialised item can have a chassis number', field('hasChassis', 'needs_serial', 'Make the item serialised first'));
  }
  // ADR-006 §5: the flag stays on once a unit of the item has a chassis number (a trigger refuses it too, RA008).
  if (now.hasChassis && !next.hasChassis && (await tx.select({ id: units.id }).from(units)
    .where(and(eq(units.itemId, id), isNotNull(units.chassisNo))).limit(1)).length > 0) {
    throw new AppError('chassis_numbers_recorded', 'Units of this item already have chassis numbers, so it keeps them',
      field('hasChassis', 'recorded', 'Its vehicles are registered with their chassis numbers'));
  }
  // Once the item has stock, its unit (the decimals its quantities have) and whether it's serialised are what that stock
  // was counted in: changing either would leave movements and units that no longer fit (M2-05, M2-06).
  const unitChanges = change.unit !== undefined && change.unit !== now.unit;
  if ((change.serialised !== undefined && change.serialised !== now.serialised) || unitChanges) {
    const [moved] = await tx.select({ id: stockMovements.id }).from(stockMovements).where(eq(stockMovements.itemId, id)).limit(1);
    if (moved !== undefined) {
      throw new AppError('item_has_stock', 'This item has stock, so its unit and serial numbers stay as they are',
        field(unitChanges ? 'unit' : 'serialised', 'has_stock', 'It has stock movements already'));
    }
  }
  await checkRefs(tx, change);
  const fields = Object.fromEntries(Object.entries(change).filter(([, v]) => v !== undefined));
  if (Object.keys(fields).length > 0) {
    await uniquely(tx.update(items).set(fields).where(eq(items.id, id)), { ux_items_barcode_key: barcodeTaken() });
  }
  return {};
}

/**
 * Refuses a quantity with more decimals than its item's unit allows (RC-162): "1.5" of a Nos item answers
 * `quantity_too_precise`. Every stock document calls this for each line (M2-05 onward), and lists the code.
 */
export async function checkQuantity(ctx: Ctx, itemId: string, quantity: string): Promise<void> {
  const [row] = await stockTx(ctx).select({ decimals: unitsOfMeasure.decimals, unit: unitsOfMeasure.name }).from(items)
    .innerJoin(unitsOfMeasure, eq(unitsOfMeasure.code, items.unit)).where(eq(items.id, itemId)).limit(1);
  if (row === undefined) throw new AppError('not_found', 'There is no such item');
  if (!quantityFits(quantity, row.decimals)) {
    throw new AppError('quantity_too_precise', row.decimals === 0
      ? `${row.unit} are counted whole: enter a quantity without decimals`
      : `${row.unit} take at most ${row.decimals} decimal places`);
  }
}
