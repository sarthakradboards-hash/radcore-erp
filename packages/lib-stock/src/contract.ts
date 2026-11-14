// lib-stock's route contracts (ADR-001 §6, §7a): declared once, shared by the API and the web app. Like every contract
// file it imports only zod and lib-common (D5), so the browser can load it.
import { defineContract, idString, listInput, listOf, searchText, skuString } from '@radcore/lib-common';
import { z } from 'zod';

const read = { readOnly: true, isolation: 'read committed' } as const;
const write = { readOnly: false, isolation: 'read committed' } as const;

const unitCode = () => z.string().regex(/^[A-Z]{3}$/, 'Choose a unit');
const hsnString = () => z.string().regex(/^[0-9]{4}([0-9]{2}){0,2}$/, 'Enter the 4, 6 or 8-digit HSN code');
const categoryName = () => z.string().trim().min(1, 'Name the category').max(80);

/** GET /units-of-measure (items:read): each unit and the decimals its quantities may have (RC-162). */
export const listUnitsOfMeasure = defineContract({
  method: 'GET', path: '/units-of-measure', auth: 'session', perm: 'items:read', tx: read,
  input: z.object({}),
  output: z.object({ units: z.array(z.object({ code: unitCode(), name: z.string(), decimals: z.number().int().min(0).max(3) })) }),
});

/** GET /item-categories (items:read): every category, by name. */
export const listItemCategories = defineContract({
  method: 'GET', path: '/item-categories', auth: 'session', perm: 'items:read', tx: read,
  input: z.object({}),
  output: z.object({ categories: z.array(z.object({ id: idString(), name: z.string() })) }),
});

/** POST /item-categories (items:write). name_taken: two categories never share a name, whatever the case or spacing. */
export const createItemCategory = defineContract({
  method: 'POST', path: '/item-categories', auth: 'session', perm: 'items:write', tx: write,
  input: z.object({ name: categoryName() }), output: z.object({ id: idString() }), errors: ['name_taken'],
});

/** PATCH /item-categories/:id (items:write): a new name. */
export const renameItemCategory = defineContract({
  method: 'PATCH', path: '/item-categories/:id', auth: 'session', perm: 'items:write', tx: write,
  input: z.object({ id: idString(), name: categoryName() }), output: z.object({}), errors: ['name_taken'],
});

/** An item as it's answered. */
const item = z.object({
  id: idString(), sku: z.string(), name: z.string(), categoryId: idString(), hsn: z.string(), unit: unitCode(),
  barcode: z.string().nullable(), serialised: z.boolean(), hasChassis: z.boolean(),
});

/** GET /items (items:read): items by name, a page at a time, searched by name, SKU or barcode, filtered by category. */
export const listItems = defineContract({
  method: 'GET', path: '/items', auth: 'session', perm: 'items:read', tx: read,
  input: listInput(z.object({ search: searchText().optional(), categoryId: idString().optional() })),
  output: listOf(item),
});

/** GET /items/:id (items:read). */
export const getItem = defineContract({
  method: 'GET', path: '/items/:id', auth: 'session', perm: 'items:read', tx: read,
  input: z.object({ id: idString() }), output: item,
});

const itemFields = {
  name: z.string().trim().min(1, 'Name the item').max(200),
  categoryId: idString(),
  hsn: hsnString(),
  unit: unitCode(),
  barcode: z.string().regex(/^[!-~]{1,48}$/, 'A barcode is up to 48 letters, digits or symbols, without spaces').nullable(),
  serialised: z.boolean(),
  // D-15 (ADR-006 §5): this item's units carry a chassis number. Only a serialised item can.
  hasChassis: z.boolean(),
};
const chassisNeedsSerial = { error: 'Only a serialised item can have a chassis number', path: ['hasChassis'] };

/**
 * POST /items (items:write). sku_taken and barcode_taken: an SKU is unique whatever its case, and so is a barcode.
 * unknown_category and unknown_unit: the category or unit isn't one there is.
 */
export const createItem = defineContract({
  method: 'POST', path: '/items', auth: 'session', perm: 'items:write', tx: write,
  input: z.object({ sku: skuString(), ...itemFields }).refine((i) => !i.hasChassis || i.serialised, chassisNeedsSerial),
  output: z.object({ id: idString() }), errors: ['sku_taken', 'barcode_taken', 'unknown_category', 'unknown_unit'],
});

/** PATCH /items/:id (items:write): any of an item's fields but its SKU, which documents print and search by. */
export const updateItem = defineContract({
  method: 'PATCH', path: '/items/:id', auth: 'session', perm: 'items:write', tx: write,
  input: z.object(itemFields).partial().extend({ id: idString() }),
  output: z.object({}), errors: ['barcode_taken', 'unknown_category', 'unknown_unit', 'chassis_needs_serial'],
});
