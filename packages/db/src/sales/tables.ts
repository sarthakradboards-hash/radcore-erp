// lib-sales's tables (ADR-001 §3, §5): price lists and discount limits (M2-13, RAD-98). SQL zone (ADR-002 §3): `sql`
// only as a CHECK's argument or a generated column.
import { and, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import { boolean, check, index, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { boundedText, id, percent, radcoreTable, unitPrice } from '../columns.ts';
import { roles } from '../platform/tables.ts';
import { items } from '../stock/tables.ts';

/** A price list (the retail list, the dealer list): its name, unique whatever its case or spacing. Its prices are its
 * versions'. Switched off, never deleted (ADR-005 §3, D-12). */
export const priceLists = radcoreTable('price_lists', {
  id: id(),
  name: boundedText({ max: 80 }).notNull(),
  nameKey: text().notNull().generatedAlwaysAs(sql`lower(btrim(regexp_replace(name, '[[:space:]]+', ' ', 'g')))`),
  active: boolean().notNull().default(true),
}, (t) => [uniqueIndex('ux_price_lists_name_key').on(t.nameKey)]);

/**
 * A version of a list's prices (RAD-98): whether its rates include GST, and the rates themselves. A draft (no
 * `approved_at`) is edited and sent for approval (maker-checker, RAD-38); approving it puts it in force and supersedes
 * the one before (`superseded_at`), which stays as history. Only the version in force prices anything. A list has at
 * most one draft and one version in force.
 */
export const priceListVersions = radcoreTable('price_list_versions', {
  id: id(),
  priceListId: uuid().notNull().references(() => priceLists.id, { onDelete: 'restrict' }),
  taxInclusive: boolean().notNull(),
  approvedAt: timestamp({ withTimezone: true }),
  supersededAt: timestamp({ withTimezone: true }),
}, (t) => [
  index('ix_price_list_versions_list').on(t.priceListId),
  uniqueIndex('ux_price_list_versions_draft').on(t.priceListId).where(isNull(t.approvedAt)),
  // and() of two terms is never undefined.
  uniqueIndex('ux_price_list_versions_in_force').on(t.priceListId).where(and(isNotNull(t.approvedAt), isNull(t.supersededAt)) as SQL),
  check('ck_price_list_versions_superseded', sql`${t.supersededAt} is null or ${t.approvedAt} is not null`),
]);

/** One item's rate in a version: per unit, to 6 places (RC-008), with or without GST as its version says. */
export const priceListRates = radcoreTable('price_list_rates', {
  id: id(),
  versionId: uuid().notNull().references(() => priceListVersions.id, { onDelete: 'restrict' }),
  itemId: uuid().notNull().references(() => items.id, { onDelete: 'restrict' }),
  rate: unitPrice().notNull(),
}, (t) => [
  uniqueIndex('ux_price_list_rates_version_item').on(t.versionId, t.itemId),
  index('ix_price_list_rates_item').on(t.itemId),
]);

/** The most a role may take off a list price without a discount approval (RAD-98). A role with no row takes the
 * `sales.discount_limit_default` setting. */
export const discountLimits = radcoreTable('discount_limits', {
  role: text().primaryKey().references(() => roles.key, { onDelete: 'cascade' }),
  maxPercent: percent().notNull(),
});
