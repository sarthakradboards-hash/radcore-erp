// lib-stock's tables (ADR-001 §3, §5): items (RAD-89), locations (RAD-92) and the stock ledger (RAD-93, ADR-006 §4, §4a). SQL zone (ADR-002 §3): `sql` only as a CHECK's argument or a generated column.
import { sql } from 'drizzle-orm';
import { boolean, check, date, foreignKey, index, primaryKey, smallint, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { boundedText, id, money, qty, radcoreTable, trigramIndex, unitPrice } from '../columns.ts';
import { files } from '../platform/tables.ts';

/**
 * Units of measure (M2-10, RAD-89): GST's unit quantity codes (UQC), each with how many decimals its quantities may
 * have. A count (NOS, SET, PRS, BOX) has none, so 1.5 Nos can't be entered (RC-162); a weight or a volume has three.
 * Seeded by migration.
 */
export const unitsOfMeasure = radcoreTable('units_of_measure', {
  code: text().primaryKey(),
  name: boundedText({ max: 60 }).notNull(),
  decimals: smallint().notNull(),
}, (t) => [
  check('ck_units_of_measure_code', sql`${t.code} ~ '^[A-Z]{3}$'`),
  check('ck_units_of_measure_decimals', sql`${t.decimals} between 0 and 3`),
]);

/** Item categories (M2-10): a flat list. Two never share a name, whatever the case or spacing. */
export const itemCategories = radcoreTable('item_categories', {
  id: id(),
  name: boundedText({ max: 80 }).notNull(),
  nameKey: text().notNull().generatedAlwaysAs(sql`lower(btrim(regexp_replace(name, '[[:space:]]+', ' ', 'g')))`),
}, (t) => [uniqueIndex('ux_item_categories_name_key').on(t.nameKey)]);

/**
 * Items (M2-10, RAD-89): the one item master every document uses. The SKU is unique whatever its case, and so is the
 * barcode where there is one. The HSN is 4, 6 or 8 digits; its GST rate is lib-gst's, by date (M2-12). An item is
 * serialised when each piece is a unit with its own serial (M2-06). `has_chassis` (D-15, ADR-006 §5) marks the vehicles
 * whose units carry a chassis number; only a serialised item can have it. Batches are on every item's movements
 * (M2-05), so there is no batch flag. An item is switched off (`active` false), never deleted (ADR-005 §3).
 */
export const items = radcoreTable('items', {
  id: id(),
  sku: text().notNull(),
  skuKey: text().notNull().generatedAlwaysAs(sql`upper(sku)`),
  name: boundedText({ max: 200 }).notNull(),
  categoryId: uuid().notNull().references(() => itemCategories.id, { onDelete: 'restrict' }),
  hsn: text().notNull(),
  unit: text().notNull().references(() => unitsOfMeasure.code, { onDelete: 'restrict' }),
  barcode: text(),
  serialised: boolean().notNull().default(false),
  hasChassis: boolean().notNull().default(false),
  active: boolean().notNull().default(true),
}, (t) => [
  uniqueIndex('ux_items_sku_key').on(t.skuKey),
  uniqueIndex('ux_items_barcode').on(t.barcode),
  index('ix_items_category_id').on(t.categoryId),
  index('ix_items_unit').on(t.unit),
  trigramIndex('ix_items_name_trgm', t.name),
  check('ck_items_sku', sql`${t.sku} ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$'`),
  check('ck_items_hsn', sql`${t.hsn} ~ '^[0-9]{4}([0-9]{2}){0,2}$'`),
  check('ck_items_barcode', sql`${t.barcode} ~ '^[!-~]{1,48}$'`),
  check('ck_items_chassis', sql`not ${t.hasChassis} or ${t.serialised}`),
]);

/**
 * An item's pictures (RAD-89; ADR-004 §2): each an `item_picture` file in lib-platform's `files`, shown in `position`
 * order. A file pictures one item at most, and an item has at most 8.
 */
export const itemPictures = radcoreTable('item_pictures', {
  fileId: uuid().primaryKey().references(() => files.id, { onDelete: 'restrict' }),
  itemId: uuid().notNull().references(() => items.id, { onDelete: 'restrict' }),
  position: smallint().notNull(),
}, (t) => [
  uniqueIndex('ux_item_pictures_item_position').on(t.itemId, t.position),
  check('ck_item_pictures_position', sql`${t.position} between 0 and 7`),
]);

/**
 * A place stock can be: the sales floor, the stock room, a service bay, a franchisee, a job worker. Its kind is one
 * of lib-common's fixed LOCATION_KINDS (ADR-005 §4). Its code is unique whatever its case or spacing (`code_key`).
 * Switched off, never deleted (ADR-005 §3, D-12). A franchisee's or job worker's party comes later, expand-only.
 */
export const locations = radcoreTable('locations', {
  id: id(),
  code: boundedText({ max: 20 }).notNull(),
  name: boundedText({ max: 120 }).notNull(),
  kind: text().notNull(),
  active: boolean().notNull().default(true),
  codeKey: text().notNull().generatedAlwaysAs(sql`upper(btrim(code))`),
}, (t) => [
  // LOCATION_KINDS' codes, written out because L1 allows only a plain `sql` here; tables.test.ts holds the two equal.
  check('ck_locations_kind',
    sql`${t.kind} in ('store', 'stores', 'service_bay', 'franchisee', 'rejected', 'demo', 'job_work', 'in_transit')`),
  uniqueIndex('ux_locations_code_key').on(t.codeKey),
  index('ix_locations_kind').on(t.kind),
]);

/**
 * The stock ledger (ADR-006 §4, RAD-93): one row per document line's move, append-only (ADR-005 §7). `in` and `out`
 * carry a quantity and its value; `revalue` carries a value only, signed. Quantity and value on hand are sums of these
 * rows, never stored. Each row names the document line it came from, its business date and when it was posted
 * (ADR-005 §6). A cancellation's mirror names the movement it undoes, once.
 * shortcut: no `fy_start` and no period-lock check yet: `financial_years` and the lock rows come with RAD-86 part 1,
 * and RAD-93's posting PR adds both.
 */
export const stockMovements = radcoreTable('stock_movements', {
  id: id(),
  itemId: uuid().notNull().references(() => items.id, { onDelete: 'restrict' }),
  locationId: uuid().notNull().references(() => locations.id, { onDelete: 'restrict' }),
  sourceTable: text().notNull(),
  sourceId: uuid().notNull(),
  sourceLineId: uuid(),
  direction: text().notNull(),
  qty: qty().notNull(),
  value: money({ signed: true }).notNull(),
  rate: unitPrice(),
  businessDate: date({ mode: 'string' }).notNull(),
  postedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  reversesMovementId: uuid(),
}, (t) => [
  check('ck_stock_movements_direction', sql`${t.direction} in ('in', 'out', 'revalue')`),
  check('ck_stock_movements_revalue_qty', sql`(${t.direction} = 'revalue') = (${t.qty} = 0)`),
  check('ck_stock_movements_value_sign', sql`${t.direction} = 'revalue' or ${t.value} >= 0`),
  check('ck_stock_movements_rate_in', sql`${t.rate} is null or ${t.direction} = 'in'`),
  check('ck_stock_movements_source_table', sql`${t.sourceTable} ~ '^[a-z][a-z0-9_]*$'`),
  foreignKey({ name: 'fk_stock_movements_reverses', columns: [t.reversesMovementId], foreignColumns: [t.id] }),
  uniqueIndex('ux_stock_movements_reverses').on(t.reversesMovementId),
  // For the batch rows' composite key, so a batch row's item is its movement's.
  unique('ux_stock_movements_id_item').on(t.id, t.itemId),
  // The sums on hand: an item at a location.
  index('ix_stock_movements_item_location').on(t.itemId, t.locationId),
  index('ix_stock_movements_location').on(t.locationId),
  index('ix_stock_movements_source').on(t.sourceTable, t.sourceId),
]);

/**
 * The stock lock (ADR-006 §1, RC-053): one row per item and location, taken `FOR UPDATE` by every posting in
 * `(item_id, location_id)` order, never the item row (a lock on `items` blocks every insert that references it). The
 * first movement creates its row with `INSERT … ON CONFLICT DO NOTHING`, then locks it. It holds no figures.
 */
export const stockPositions = radcoreTable('stock_positions', {
  itemId: uuid().notNull().references(() => items.id, { onDelete: 'restrict' }),
  locationId: uuid().notNull().references(() => locations.id, { onDelete: 'restrict' }),
}, (t) => [
  primaryKey({ name: 'pk_stock_positions', columns: [t.itemId, t.locationId] }),
  index('ix_stock_positions_location').on(t.locationId),
]);

/**
 * A batch (ADR-006 §4a, D-15, RC-028): its item's, from one supplier, append-only. `batch_key` is the number in upper
 * case without spaces or hyphens, so "B-17" and "b17" are one batch; two suppliers' "B-17" are two.
 * shortcut: `supplier_id` holds no party yet: `parties` comes with RAD-90 (#180), and until it does the CHECK keeps it
 * null, so no unchecked id is stored. RAD-93's later PR drops the CHECK and adds the foreign key, in one migration.
 */
export const batches = radcoreTable('batches', {
  id: id(),
  itemId: uuid().notNull().references(() => items.id, { onDelete: 'restrict' }),
  supplierId: uuid(),
  batchNo: boundedText({ max: 40 }).notNull(),
  batchKey: text().notNull().generatedAlwaysAs(sql`upper(regexp_replace(batch_no, '[[:space:]-]', '', 'g'))`),
}, (t) => [
  check('ck_batches_supplier', sql`${t.supplierId} is null`),
  unique('ux_batches_item_supplier_key').on(t.itemId, t.supplierId, t.batchKey).nullsNotDistinct(),
  // For the batch rows' composite key, so a batch row's batch is its item's.
  unique('ux_batches_id_item').on(t.id, t.itemId),
]);

/**
 * A movement's quantity, split by batch (ADR-006 §4a), append-only. `batch_id` is null only for "batch unknown", the
 * part of a negative-stock delivery whose batch hasn't been received. Composite keys keep the row's item its
 * movement's and its batch's; a movement names each batch once.
 */
export const stockMovementBatches = radcoreTable('stock_movement_batches', {
  id: id(),
  movementId: uuid().notNull(),
  itemId: uuid().notNull(),
  batchId: uuid(),
  qty: qty({ line: true }).notNull(),
}, (t) => [
  foreignKey({ name: 'fk_stock_movement_batches_movement', columns: [t.movementId, t.itemId],
    foreignColumns: [stockMovements.id, stockMovements.itemId] }),
  foreignKey({ name: 'fk_stock_movement_batches_batch', columns: [t.batchId, t.itemId], foreignColumns: [batches.id, batches.itemId] }),
  unique('ux_stock_movement_batches_movement_batch').on(t.movementId, t.batchId).nullsNotDistinct(),
  index('ix_stock_movement_batches_movement_item').on(t.movementId, t.itemId),
  index('ix_stock_movement_batches_batch').on(t.batchId, t.itemId),
]);
