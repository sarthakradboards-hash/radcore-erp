// Purchase orders (M4-01, RAD-136; ADR-008 §1, §2, §5): what we've asked a supplier for, at what rates. A PO posts
// nothing, so it carries no ledger guard: its service moves it (draft → placed, numbered PO; then closed when every line
// is received or closed short with a reason; cancelled while nothing has come in), and these CHECKs hold the values. Its
// tax is worked out on read while a draft and stored when it's placed. Purchasing's tables split by family (ADR-008 §14):
// receipts, bills and returns have files of their own.
import { sql } from 'drizzle-orm';
import { check, date, index, smallint, text, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { parties } from '../accounts/tables.ts';
import { boundedText, createdMoment, id, money, percent, qty, radcoreTable, unitPrice } from '../columns.ts';
import { roles } from '../platform/tables.ts';
import { items } from '../stock/tables.ts';

const frozenTotals = () => ({ placeOfSupply: text(), taxable: money(), cgst: money(), sgst: money(), igst: money(),
  roundOff: money({ signed: true }), total: money() });
const frozenLine = () => ({ gstRate: percent(), gstRateSource: boundedText({ max: 200 }), taxable: money(), cgst: money(),
  sgst: money(), igst: money(), lineTotal: money() });

/**
 * A purchase order (ADR-008 §5): a supplier, its lines and their tax. `approved_total` is what an approval was given for,
 * recorded by the approval's `approved` step outside the version it hashed: a change raising the total past it is
 * refused. Its owner is its maker (`created_by`), the record scope purchasing:read names.
 */
export const purchaseOrders = radcoreTable('purchase_orders', {
  id: id(), createdAt: createdMoment(),
  number: text().unique(),
  partyId: uuid().notNull().references(() => parties.id, { onDelete: 'restrict' }),
  businessDate: date({ mode: 'string' }).notNull(),
  expectedBy: date({ mode: 'string' }),
  status: text().notNull().default('draft'),
  notes: boundedText({ max: 500 }),
  // Why it was closed with lines still to come, or cancelled; null otherwise.
  closeReason: boundedText({ max: 500 }),
  approvedTotal: money(),
  ...frozenTotals(),
}, (t) => [
  // A draft's totals are worked out on read and a placed one's stored; a cancelled one keeps what it had.
  check('ck_purchase_orders_frozen', sql`num_nulls(${t.placeOfSupply}, ${t.taxable}, ${t.cgst}, ${t.sgst}, ${t.igst}, ${t.roundOff}, ${t.total}) in (0, 7)
    and case ${t.status} when 'draft' then ${t.total} is null when 'cancelled' then true else ${t.total} is not null end and coalesce(${t.placeOfSupply}, '00') ~ '^[0-9]{2}$'`),
  check('ck_purchase_orders_identity', sql`${t.total} = ${t.taxable} + ${t.cgst} + ${t.sgst} + ${t.igst} + ${t.roundOff}
    and abs(${t.roundOff}) < 1 and ${t.cgst} = ${t.sgst} and (${t.igst} = 0 or ${t.cgst} = 0)`),
  // lib-common's PURCHASE_ORDER_STATUSES, written out (L1); tools/purchase-orders.test.ts holds them equal.
  check('ck_purchase_orders_status', sql`${t.status} in ('draft', 'placed', 'closed', 'cancelled')`),
  // A draft has no number and a placed one has; a cancelled one keeps whichever it had.
  check('ck_purchase_orders_number', sql`case ${t.status} when 'draft' then ${t.number} is null when 'cancelled' then true
    else ${t.number} is not null end`),
  check('ck_purchase_orders_reason', sql`${t.closeReason} is null or ${t.status} in ('closed', 'cancelled')`),
  check('ck_purchase_orders_cancel_reason', sql`${t.status} <> 'cancelled' or ${t.closeReason} is not null`),
  check('ck_purchase_orders_expected', sql`${t.expectedBy} is null or ${t.expectedBy} >= ${t.businessDate}`),
  index('ix_purchase_orders_party').on(t.partyId),
  index('ix_purchase_orders_date').on(t.businessDate, t.createdAt, t.id),
]);

/** A PO's line: an item, how many, and its rate before tax (ADR-008 §5). Receipts (M4-02) say how much has come in. */
export const purchaseOrderLines = radcoreTable('purchase_order_lines', {
  id: id(),
  orderId: uuid().notNull().references((): AnyPgColumn => purchaseOrders.id, { onDelete: 'cascade' }),
  lineNo: smallint().notNull(),
  itemId: uuid().notNull().references(() => items.id, { onDelete: 'restrict' }),
  qty: qty({ line: true }).notNull(),
  rate: unitPrice().notNull(),
  ...frozenLine(),
}, (t) => [
  check('ck_purchase_order_lines_frozen', sql`num_nulls(${t.gstRate}, ${t.gstRateSource}, ${t.taxable}, ${t.cgst}, ${t.sgst}, ${t.igst},
    ${t.lineTotal}) in (0, 7)`),
  check('ck_purchase_order_lines_identity', sql`${t.lineTotal} = ${t.taxable} + ${t.cgst} + ${t.sgst} + ${t.igst}
    and ${t.cgst} = ${t.sgst} and (${t.igst} = 0 or ${t.cgst} = 0)`),
  uniqueIndex('ux_purchase_order_lines_line').on(t.orderId, t.lineNo),
  index('ix_purchase_order_lines_item').on(t.itemId),
]);

/** A role's PO limit (ADR-008 §5): the most a PO's total with GST may be for its placer to place it without approval. A
 * role with no row takes purchasing.order_limit_default (0, so every PO is approved: Sarthak, 22 Nov). */
export const purchaseOrderLimits = radcoreTable('purchase_order_limits', {
  role: text().primaryKey().references(() => roles.key, { onDelete: 'cascade' }),
  maxTotal: money().notNull(),
});
