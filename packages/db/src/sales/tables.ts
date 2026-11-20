// lib-sales's tables (ADR-001 §3, §5): price lists and discount limits (M2-13, RAD-98); quotes and orders (M3-08,
// RAD-112). SQL zone (ADR-002 §3): `sql` only as a CHECK's argument or a generated column.
import { and, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import { boolean, check, date, index, smallint, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { parties } from '../accounts/tables.ts';
import { boundedText, id, percent, qty, radcoreTable, unitPrice } from '../columns.ts';
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
 * `in_force_from`) is edited and sent for approval (maker-checker, RAD-38); approving it puts it in force from that day
 * and supersedes the one before from the same day (`superseded_from`), which stays as history. A document is priced by
 * the version in force on its own business date: from `in_force_from`, until the day before `superseded_from`. A list
 * has at most one draft and one version in force now.
 */
export const priceListVersions = radcoreTable('price_list_versions', {
  id: id(),
  priceListId: uuid().notNull().references(() => priceLists.id, { onDelete: 'restrict' }),
  taxInclusive: boolean().notNull(),
  inForceFrom: date({ mode: 'string' }),
  supersededFrom: date({ mode: 'string' }),
  // The dates, as the status #185's guards read (ADR-005 §7b): an approved version changes only by being superseded.
  status: text().notNull().default('draft'),
}, (t) => [
  index('ix_price_list_versions_list').on(t.priceListId),
  // One draft and one approved version per list. Keyed on the dates, which ck_price_list_versions_status holds equal
  // to the status: an index's where can't name a value without `sql`, which L1 keeps out of indexes.
  uniqueIndex('ux_price_list_versions_draft').on(t.priceListId).where(isNull(t.inForceFrom)),
  // and() of two terms is never undefined.
  uniqueIndex('ux_price_list_versions_in_force').on(t.priceListId).where(and(isNotNull(t.inForceFrom), isNull(t.supersededFrom)) as SQL),
  check('ck_price_list_versions_superseded', sql`${t.supersededFrom} is null or (${t.inForceFrom} is not null and ${t.supersededFrom} >= ${t.inForceFrom})`),
  check('ck_price_list_versions_status', sql`${t.status} in ('draft', 'approved', 'superseded')
    and (${t.status} = 'draft') = (${t.inForceFrom} is null) and (${t.status} = 'superseded') = (${t.supersededFrom} is not null)`),
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

/**
 * A quote (ADR-007 §1, M3-08): what we offered a party, at what rates. It posts nothing. Its service moves it:
 * draft → sent (its number drawn, QT) → accepted (which makes a draft order from it), declined or expired. A draft
 * has no number, so thrown-away drafts leave no gaps (§3).
 */
export const salesQuotes = radcoreTable('sales_quotes', {
  id: id(),
  number: text().unique(),
  partyId: uuid().notNull().references(() => parties.id, { onDelete: 'restrict' }),
  businessDate: date({ mode: 'string' }).notNull(),
  validUntil: date({ mode: 'string' }),
  status: text().notNull().default('draft'),
  notes: boundedText({ max: 500 }),
}, (t) => [
  index('ix_sales_quotes_party').on(t.partyId),
  index('ix_sales_quotes_date').on(t.businessDate, t.id),
  // lib-common's SALES_QUOTE_STATUSES, written out (L1); tools/sales-lists.test.ts holds them equal.
  check('ck_sales_quotes_status', sql`${t.status} in ('draft', 'sent', 'accepted', 'declined', 'expired')`),
  check('ck_sales_quotes_number', sql`(${t.status} = 'draft') = (${t.number} is null)`),
  check('ck_sales_quotes_valid_until', sql`${t.validUntil} is null or ${t.validUntil} >= ${t.businessDate}`),
]);

/** A quote's line: an item, how many, at what rate per unit before GST, less a discount (RAD-98's limits apply). */
export const salesQuoteLines = radcoreTable('sales_quote_lines', {
  id: id(),
  quoteId: uuid().notNull().references(() => salesQuotes.id, { onDelete: 'cascade' }),
  lineNo: smallint().notNull(),
  itemId: uuid().notNull().references(() => items.id, { onDelete: 'restrict' }),
  qty: qty({ line: true }).notNull(),
  rate: unitPrice().notNull(),
  discountPercent: percent().notNull().default('0'),
}, (t) => [
  uniqueIndex('ux_sales_quote_lines_line').on(t.quoteId, t.lineNo),
  index('ix_sales_quote_lines_item').on(t.itemId),
]);

/**
 * An order (ADR-007 §1, M3-08): what a party will take. It posts nothing; deliveries post against its lines. Its
 * service moves it: draft → confirmed (its number drawn, SO, after the credit and price checks, M3-07) → closed or
 * cancelled. It's closed when every line is delivered, or closed short by a person with lines still undelivered,
 * which releases them and keeps the reason (RC-125). A quote makes at most one order.
 */
export const salesOrders = radcoreTable('sales_orders', {
  id: id(),
  number: text().unique(),
  partyId: uuid().notNull().references(() => parties.id, { onDelete: 'restrict' }),
  quoteId: uuid().unique().references(() => salesQuotes.id, { onDelete: 'restrict' }),
  businessDate: date({ mode: 'string' }).notNull(),
  status: text().notNull().default('draft'),
  notes: boundedText({ max: 500 }),
  // Why it was closed with lines undelivered, or cancelled (RC-125); null otherwise.
  closeReason: boundedText({ max: 500 }),
  // The version an override of its checks was approved for (sales:override, M3-07): confirming takes it while the
  // order and its issues still hash to it.
  overrideVersion: text(),
}, (t) => [
  index('ix_sales_orders_party').on(t.partyId),
  index('ix_sales_orders_date').on(t.businessDate, t.id),
  // lib-common's SALES_ORDER_STATUSES, written out (L1); tools/sales-lists.test.ts holds them equal.
  check('ck_sales_orders_status', sql`${t.status} in ('draft', 'confirmed', 'closed', 'cancelled')`),
  check('ck_sales_orders_number', sql`(${t.status} = 'draft') = (${t.number} is null)`),
  check('ck_sales_orders_reason', sql`${t.closeReason} is null or ${t.status} in ('closed', 'cancelled')`),
  check('ck_sales_orders_cancel_reason', sql`${t.status} <> 'cancelled' or ${t.closeReason} is not null`),
]);

/** An order's line, as a quote's. Its deliveries (M3-08's delivery lines) say how much of it has gone. */
export const salesOrderLines = radcoreTable('sales_order_lines', {
  id: id(),
  orderId: uuid().notNull().references(() => salesOrders.id, { onDelete: 'cascade' }),
  lineNo: smallint().notNull(),
  itemId: uuid().notNull().references(() => items.id, { onDelete: 'restrict' }),
  qty: qty({ line: true }).notNull(),
  rate: unitPrice().notNull(),
  discountPercent: percent().notNull().default('0'),
}, (t) => [
  uniqueIndex('ux_sales_order_lines_line').on(t.orderId, t.lineNo),
  index('ix_sales_order_lines_item').on(t.itemId),
]);
