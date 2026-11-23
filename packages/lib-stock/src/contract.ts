// lib-stock's route contracts (ADR-001 §6, §7a): declared once, shared by the API and the web app. Like every contract
// file it imports only zod and lib-common (D5), so the browser can load it.
import {
  cost, cursorString, dateString, UNIT_CONDITIONS, defineContract, idString, listInput, listOf, LOCATION_KIND_CODES, locationKindLabel, quantityString,
  searchText, skuString, unitPriceString,
} from '@radcore/lib-common';
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

/** An item as it's answered, with its pictures in order: each a short-lived link shown inline (ADR-004 §2). A picture
 * still being checked has no link yet. */
const item = z.object({
  id: idString(), sku: z.string(), name: z.string(), categoryId: idString(), hsn: z.string(), unit: unitCode(),
  barcode: z.string().nullable(), serialised: z.boolean(), hasChassis: z.boolean(), active: z.boolean(),
  // What it costs to buy, per unit: masked without cost:read (RAD-89, ADR-001 §7a).
  purchasePrice: cost(unitPriceString().nullable()),
  pictures: z.array(z.object({ fileId: idString(), url: z.url().nullable() })).max(8),
});

/** GET /items (items:read): items by name, a page at a time, searched by name, SKU or barcode, filtered by category
 * and by whether they're active (left out, both). */
export const listItems = defineContract({
  method: 'GET', path: '/items', auth: 'session', perm: 'items:read', tx: read,
  input: listInput(z.object({ search: searchText().optional(), categoryId: idString().optional(), active: z.boolean().optional() })),
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
  // Setting it needs cost:read as well as items:write (ADR-001 §7a); left out, it isn't changed.
  purchasePrice: unitPriceString().nullable().optional(),
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

/**
 * POST /items/:id/pictures (items:write): adds an uploaded item picture (itemPictureFiles) as the item's last.
 * picture_attached: the file already pictures an item; too_many_pictures: an item has at most 8; not_ready and
 * upload_refused: the file is still being checked, or failed its check.
 */
export const attachItemPicture = defineContract({
  method: 'POST', path: '/items/:id/pictures', auth: 'session', perm: 'items:write', tx: write,
  input: z.object({ id: idString(), fileId: idString() }), output: z.object({}),
  errors: ['picture_attached', 'too_many_pictures', 'not_ready', 'upload_refused'],
});

/** DELETE /items/:id/pictures/:fileId (items:write): takes a picture off the item. The file stays (D-12). */
export const removeItemPicture = defineContract({
  method: 'DELETE', path: '/items/:id/pictures/:fileId', auth: 'session', perm: 'items:write', tx: write,
  input: z.object({ id: idString(), fileId: idString() }), output: z.object({}),
});

/** PATCH /items/:id (items:write): any of an item's fields but its SKU, which documents print and search by. An item
 * is switched off (`active: false`), never deleted (ADR-005 §3). */
export const updateItem = defineContract({
  method: 'PATCH', path: '/items/:id', auth: 'session', perm: 'items:write', tx: write,
  input: z.object(itemFields).partial().extend({ id: idString(), active: z.boolean().optional() }),
  output: z.object({}), errors: ['barcode_taken', 'unknown_category', 'unknown_unit', 'chassis_needs_serial', 'chassis_numbers_recorded',
    'item_has_stock'],
});

// Locations (RAD-92, M2-14): the places stock can be. A location is switched off, never deleted (ADR-005 §3, D-12).
// Its kind is one of lib-common's fixed LOCATION_KINDS.
const locationKind = z.enum(LOCATION_KIND_CODES);
/** A short code people type and print: letters, digits and `-`, kept as typed, unique whatever its case. */
const locationCode = () => z.string().trim().min(1, 'Enter a code').max(20)
  .regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/, 'Use letters, digits and -');
const locationName = () => z.string().trim().min(1, 'Enter a name').max(120);
const status = z.enum(['active', 'inactive']);

/** Each kind, in LOCATION_KINDS' order, with the label screens show and whether stock there may be sold. A location's
 * answers carry only its kind's code; screens and the masters workbook take the label from here. */
export const listLocationKinds = defineContract({
  method: 'GET', path: '/stock/location-kinds', auth: 'session', perm: 'locations:read', tx: read, input: z.object({}),
  output: z.object({ kinds: z.array(z.object({ kind: locationKind, label: z.string(), sellable: z.boolean() })) }),
});

/** Renames one kind's label; `null` puts its default back. The code stays. label_in_use: another kind already shows
 * this label, compared without case or outer spaces, so two kinds never look the same. */
export const setLocationKindLabel = defineContract({
  method: 'PUT', path: '/stock/location-kinds/:kind', auth: 'session', perm: 'locations:write', tx: write,
  input: z.object({ kind: locationKind, label: locationKindLabel().nullable() }), output: z.object({}),
  errors: ['label_in_use'],
});

const location = z.object({ id: idString(), code: z.string(), name: z.string(), kind: locationKind, active: z.boolean() });

/** Locations a page at a time, by code: searched by code or name, filtered by kind and by active or switched off. */
export const listLocations = defineContract({
  method: 'GET', path: '/stock/locations', auth: 'session', perm: 'locations:read', tx: read,
  input: listInput(z.object({ search: searchText().optional(), kind: locationKind.optional(), status: status.optional() })),
  output: listOf(location),
});

// A job worker's own place names its party, exactly when its kind is `job_work`, one place each (ADR-008 §11, RAD-142).
const JOB_WORKER_ERRORS = ['job_worker_required', 'not_a_job_work_place', 'unknown_party', 'job_worker_has_place'] as const;

/** A new location. code_taken: another has this code, whatever its case or spacing. A job work place names its job
 * worker (`partyId`), and no other kind does. */
export const addLocation = defineContract({
  method: 'POST', path: '/stock/locations', auth: 'session', perm: 'locations:write', tx: write,
  input: z.object({ code: locationCode(), name: locationName(), kind: locationKind, partyId: idString().nullable().optional() }),
  output: z.object({ id: idString() }),
  errors: ['code_taken', ...JOB_WORKER_ERRORS],
});

/** A location renamed, recoded, moved to another kind, or switched off or on. */
export const updateLocation = defineContract({
  method: 'PATCH', path: '/stock/locations/:id', auth: 'session', perm: 'locations:write', tx: write,
  input: z.object({ id: idString(), code: locationCode().optional(), name: locationName().optional(),
    kind: locationKind.optional(), partyId: idString().nullable().optional(), active: z.boolean().optional() }),
  output: z.object({}), errors: ['code_taken', ...JOB_WORKER_ERRORS],
});

/** What the books check compares (ADR-006 §7). */
const BOOKS_CHECKS = ['trial_balance', 'stock_value', 'empty_place_value', 'batches'] as const;
export type BooksCheck = (typeof BOOKS_CHECKS)[number];

/** GET /books/check (journal:read): the books check (M2-07, RC-063), in one REPEATABLE READ snapshot. As at `asAt`
 * (every posting when it's left out): the trial balance, and Stock in Hand against the stock ledger by item and
 * place; on the current position, empty places and batches. No problems means the books are healthy. Every journey
 * test ends with it. */
export const checkBooksContract = defineContract({
  method: 'GET', path: '/books/check', auth: 'session', perm: 'journal:read',
  tx: { readOnly: true, isolation: 'repeatable read' },
  input: z.object({ asAt: dateString().optional() }),
  output: z.object({ problems: z.array(z.object({
    check: z.enum(BOOKS_CHECKS), itemId: idString().nullable(), locationId: idString().nullable(), message: z.string(),
  })) }),
});

/**
 * GET /stock/on-hand (stock:read; the architect on RAD-112): what's on hand of an item at a place, for the delivery and
 * return forms. Quantities only, no cost. A convenience, never the guard: posting checks every batch and unit again
 * (RA007, RA008).
 * - `position`: the quantity on hand.
 * - `batches`: each batch with stock here, with "batch unknown" its own row (`batchId` null) while it holds any.
 * - `units`, for a serialised item: the units available to pick here, paged by serial, `q` a prefix of a serial or a
 *   chassis number. A unit promised to another order line is left out; one promised to `forDocument`'s line is in,
 *   marked `heldForThis`. Null for an item with no serials.
 */
export const getOnHand = defineContract({
  method: 'GET', path: '/stock/on-hand', auth: 'session', perm: 'stock:read', tx: read,
  input: z.object({
    itemId: idString(), locationId: idString(),
    // The order line a booking promised units to (M3-13): its own units are offered too.
    forDocument: z.string().regex(/^sales_order_lines:[0-9a-f-]{36}$/, 'Not an order line').optional(),
    q: z.string().trim().min(1).max(60).optional(),
    after: cursorString().optional(),
    limit: z.number().int().min(1).max(200),
  }),
  output: z.object({
    position: quantityString({ signed: true }),
    batches: z.array(z.object({ batchId: idString().nullable(), batchNo: z.string().nullable(), supplierName: z.string().nullable(),
      qty: quantityString({ signed: true }) })),
    // Each unit's condition, so a demo, used or (where stock.sell_damaged_units allows) damaged one is seen as such.
    // Each unit's batch, so a serialised line's batches follow from the units picked (ui-2's delivery form).
    units: listOf(z.object({ unitId: idString(), serialNo: z.string(), chassisNo: z.string().nullable(), condition: z.enum(UNIT_CONDITIONS),
      heldForThis: z.boolean(), batchId: idString().nullable(), batchNo: z.string().nullable() })).nullable(),
  }),
});


// Transfers, counts and adjustments (M4-06, RAD-141), in a file of their own.
export * from './contract/job-work.ts';
export * from './contract/moves.ts';
