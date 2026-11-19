// lib-stock's tables (ADR-001 §3, §5): items (RAD-89), locations (RAD-92), the stock ledger (RAD-93, ADR-006 §4, §4a)
// and units by serial (RAD-94, §5). SQL zone (ADR-002 §3): `sql` only as a CHECK's argument or a generated column.
import { sql } from 'drizzle-orm';
import { boolean, check, date, foreignKey, index, primaryKey, smallint, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { boundedText, id, money, qty, radcoreTable, trigramIndex, unitPrice } from '../columns.ts';
import { financialYears, parties } from '../accounts/tables.ts';
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
  // ADR-005 §6 (RC-111): the business date's financial year, which must be one the company opened.
  fyStart: date({ mode: 'string' }).notNull()
    .generatedAlwaysAs(sql`make_date(extract(year from business_date)::int - (extract(month from business_date) < 4)::int, 4, 1)`),
  reversesMovementId: uuid(),
}, (t) => [
  foreignKey({ name: 'fk_stock_movements_fy_start', columns: [t.fyStart], foreignColumns: [financialYears.start] }),
  index('ix_stock_movements_fy_start').on(t.fyStart),
  check('ck_stock_movements_direction', sql`${t.direction} in ('in', 'out', 'revalue')`),
  check('ck_stock_movements_revalue_qty', sql`(${t.direction} = 'revalue') = (${t.qty} = 0)`),
  check('ck_stock_movements_value_sign', sql`${t.direction} = 'revalue' or ${t.value} >= 0`),
  check('ck_stock_movements_rate_in', sql`${t.rate} is null or ${t.direction} = 'in'`),
  check('ck_stock_movements_source_table', sql`${t.sourceTable} ~ '^[a-z][a-z0-9_]*$'`),
  foreignKey({ name: 'fk_stock_movements_reverses', columns: [t.reversesMovementId], foreignColumns: [t.id] }),
  uniqueIndex('ux_stock_movements_reverses').on(t.reversesMovementId),
  // For the batch rows' composite key, so a batch row's item is its movement's.
  unique('ux_stock_movements_id_item').on(t.id, t.itemId),
  // For the unit events' composite keys, so an event's out movement is an `out` and its in movement an `in` (§5).
  unique('ux_stock_movements_id_direction').on(t.id, t.direction),
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
 * `supplier_id` is a party (RAD-90), or null while a receipt doesn't name one. That the party supplies is the receipt's
 * check (M4), not a key's: a party's kinds can change, and its old batches stay its own.
 */
export const batches = radcoreTable('batches', {
  id: id(),
  itemId: uuid().notNull().references(() => items.id, { onDelete: 'restrict' }),
  supplierId: uuid().references(() => parties.id, { onDelete: 'restrict' }),
  batchNo: boundedText({ max: 40 }).notNull(),
  batchKey: text().notNull().generatedAlwaysAs(sql`upper(regexp_replace(batch_no, '[[:space:]-]', '', 'g'))`),
}, (t) => [
  index('ix_batches_supplier').on(t.supplierId),
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

/**
 * A serialised unit as it stands now (ADR-006 §5, RC-026, RC-027): whose it is, what condition it's in, who it's
 * promised to and where it is, each in its own column. One row per serial (`serial_key`, upper case without spaces),
 * and one `location_id`, so a unit can't be on two shelves. Only `unit_events`' trigger writes it: the runtime login has
 * no INSERT, UPDATE or DELETE here, so every path goes through the units engine. A chassis number names one vehicle
 * across every item (`chassis_key`, upper case without spaces or hyphens).
 * shortcut: `promised_to` and `sale_line_id` name order and delivery lines, which M3 adds; until then they're plain ids.
 */
export const units = radcoreTable('units', {
  id: id(),
  itemId: uuid().notNull().references(() => items.id, { onDelete: 'restrict' }),
  serialNo: boundedText({ max: 60 }).notNull(),
  serialKey: text().notNull().generatedAlwaysAs(sql`upper(regexp_replace(serial_no, '[[:space:]]', '', 'g'))`),
  ownership: text().notNull(),
  condition: text().notNull(),
  promisedTo: uuid(),
  locationId: uuid().references(() => locations.id, { onDelete: 'restrict' }),
  saleLineId: uuid(),
  batchId: uuid(),
  chassisNo: boundedText({ max: 40 }),
  chassisKey: text().generatedAlwaysAs(sql`upper(regexp_replace(chassis_no, '[[:space:]-]', '', 'g'))`),
}, (t) => [
  unique('ux_units_item_serial').on(t.itemId, t.serialKey),
  uniqueIndex('ux_units_chassis').on(t.chassisKey),
  // For the events' composite key, so an event's unit is its item's.
  unique('ux_units_id_item').on(t.id, t.itemId),
  foreignKey({ name: 'fk_units_batch', columns: [t.batchId, t.itemId], foreignColumns: [batches.id, batches.itemId] }),
  index('ix_units_batch').on(t.batchId, t.itemId),
  index('ix_units_location').on(t.locationId),
  // lib-common's lists, written out because L1 allows only a plain `sql` here; tools/units-lists.test.ts holds them equal.
  check('ck_units_ownership', sql`${t.ownership} in ('ours', 'customer', 'gone')`),
  check('ck_units_condition', sql`${t.condition} in ('new', 'demo', 'used', 'damaged')`),
  // Ours is somewhere and gone is nowhere; only a customer's unit is on a sale, and only ours is promised.
  check('ck_units_where', sql`(${t.ownership} <> 'ours' or ${t.locationId} is not null)
    and (${t.ownership} <> 'gone' or ${t.locationId} is null)`),
  check('ck_units_sale', sql`${t.saleLineId} is null or ${t.ownership} = 'customer'`),
  check('ck_units_promise', sql`${t.promisedTo} is null or ${t.ownership} = 'ours'`),
]);

/** Which unit events may start from which ownership (ADR-006 §5), `none` for a unit with no row yet: lib-common's
 * UNIT_EVENTS, seeded by the owner migration and read-only to the runtime login. */
export const unitEventRules = radcoreTable('unit_event_rules', {
  kind: text().notNull(),
  fromOwnership: text().notNull(),
}, (t) => [primaryKey({ name: 'pk_unit_event_rules', columns: [t.kind, t.fromOwnership] })]);

/**
 * Every change to a unit (ADR-006 §5), append-only (ADR-005 §7). A trigger checks it against the unit's state and
 * `unit_event_rules`, and applies it to `units` (RA008). It rides on the stock movements its kind needs: an out
 * movement at the unit's old location and an in movement at its new one, each held to its direction by a composite key
 * through a constant generated column. At commit, each movement of a serialised item has as many events as its
 * quantity, and as many per batch as its batch row (RA007).
 */
export const unitEvents = radcoreTable('unit_events', {
  id: id(),
  // The trigger's, once it has found or made the unit; the CHECK holds it set.
  unitId: uuid(),
  itemId: uuid().notNull().references(() => items.id, { onDelete: 'restrict' }),
  serialNo: boundedText({ max: 60 }).notNull(),
  kind: text().notNull(),
  sourceTable: text().notNull(),
  sourceId: uuid().notNull(),
  businessDate: date({ mode: 'string' }).notNull(),
  postedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  fyStart: date({ mode: 'string' }).notNull()
    .generatedAlwaysAs(sql`make_date(extract(year from business_date)::int - (extract(month from business_date) < 4)::int, 4, 1)`),
  outMovementId: uuid(),
  outDirection: text().notNull().generatedAlwaysAs(sql`'out'`),
  inMovementId: uuid(),
  inDirection: text().notNull().generatedAlwaysAs(sql`'in'`),
  // Where the unit is after it: the in movement's location, a service bay for `taken_in`, else unchanged.
  locationId: uuid().references(() => locations.id, { onDelete: 'restrict' }),
  condition: text(),
  promisedTo: uuid(),
  saleLineId: uuid(),
  batchId: uuid(),
  chassisNo: boundedText({ max: 40 }),
  // RAD-36: the change's reason, which `chassis_recorded` must have (lib-platform's recordChangeReason).
  reasonId: uuid(),
}, (t) => [
  foreignKey({ name: 'fk_unit_events_unit', columns: [t.unitId, t.itemId], foreignColumns: [units.id, units.itemId] }),
  foreignKey({ name: 'fk_unit_events_out', columns: [t.outMovementId, t.outDirection],
    foreignColumns: [stockMovements.id, stockMovements.direction] }),
  foreignKey({ name: 'fk_unit_events_in', columns: [t.inMovementId, t.inDirection],
    foreignColumns: [stockMovements.id, stockMovements.direction] }),
  foreignKey({ name: 'fk_unit_events_batch', columns: [t.batchId, t.itemId], foreignColumns: [batches.id, batches.itemId] }),
  foreignKey({ name: 'fk_unit_events_fy_start', columns: [t.fyStart], foreignColumns: [financialYears.start] }),
  index('ix_unit_events_unit').on(t.unitId, t.itemId),
  index('ix_unit_events_out').on(t.outMovementId, t.outDirection),
  index('ix_unit_events_in').on(t.inMovementId, t.inDirection),
  index('ix_unit_events_batch').on(t.batchId, t.itemId),
  index('ix_unit_events_location').on(t.locationId),
  index('ix_unit_events_fy_start').on(t.fyStart),
  index('ix_unit_events_item').on(t.itemId),
  index('ix_unit_events_source').on(t.sourceTable, t.sourceId),
  // lib-common's UNIT_EVENTS, written out (L1); tools/units-lists.test.ts holds the kinds and their movements equal.
  check('ck_unit_events_kind', sql`${t.kind} in ('received', 'moved', 'reserved', 'released', 'delivered',
    'delivery_returned', 'returned', 'returned_to_supplier', 'sent_to_job_work', 'received_from_job_work',
    'condition_changed', 'chassis_recorded', 'taken_in', 'handed_back', 'scrapped')`),
  check('ck_unit_events_condition', sql`${t.condition} is null or ${t.condition} in ('new', 'demo', 'used', 'damaged')`),
  check('ck_unit_events_source_table', sql`${t.sourceTable} ~ '^[a-z][a-z0-9_]*$'`),
  // The movements each kind rides on (§5): both, in only, out only, or neither.
  check('ck_unit_events_movements', sql`case
    when ${t.kind} in ('moved', 'sent_to_job_work', 'received_from_job_work') then ${t.outMovementId} is not null and ${t.inMovementId} is not null
    when ${t.kind} in ('received', 'delivery_returned', 'returned') then ${t.outMovementId} is null and ${t.inMovementId} is not null
    when ${t.kind} in ('delivered', 'returned_to_supplier', 'scrapped') then ${t.outMovementId} is not null and ${t.inMovementId} is null
    else ${t.outMovementId} is null and ${t.inMovementId} is null end`),
  check('ck_unit_events_reason', sql`${t.kind} <> 'chassis_recorded' or ${t.reasonId} is not null`),
  check('ck_unit_events_unit', sql`${t.unitId} is not null`),
]);
