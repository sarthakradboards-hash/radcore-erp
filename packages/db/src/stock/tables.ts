// lib-stock's tables (ADR-001 §3, §5). SQL zone (ADR-002 §3): `sql` only as a CHECK's argument or a generated column.
import { sql } from 'drizzle-orm';
import { boolean, check, index, smallint, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { boundedText, id, radcoreTable, trigramIndex } from '../columns.ts';

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
 * (M2-05), so there is no batch flag.
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
