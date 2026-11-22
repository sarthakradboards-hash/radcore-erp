// lib-sales's tables (ADR-001 §3, §5): quotes, orders, deliveries and delivery returns (M3-08, RAD-112), and invoices
// (M3-09, RAD-113); price lists are in ./tables-prices.ts, credit notes in ./tables-credit.ts. SQL zone (ADR-002 §3):
// `sql` only as a CHECK's argument or a generated column.
import { sql } from 'drizzle-orm';
import { check, date, index, smallint, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { journalEntries, parties } from '../accounts/tables.ts';
import { boundedText, createdMoment, id, json, money, percent, qty, radcoreTable, unitPrice } from '../columns.ts';
import { items, locations } from '../stock/tables.ts';
import { priceLists, priceListVersions } from './tables-prices.ts';

// What a quote or order freezes when it's sent or confirmed (the architect on RAD-112): each line's GST rate in force
// on its date and that rate's source, its taxable value and tax, and the header's place of supply and totals, worked
// out as an invoice's are (lib-gst, then invoice-rules) and never again. A draft has none: it's worked out on read.
const frozenTotals = () => ({ placeOfSupply: text(), taxable: money(), cgst: money(), sgst: money(), igst: money(),
  roundOff: money({ signed: true }), total: money() });
const frozenLine = () => ({ gstRate: percent(), gstRateSource: boundedText({ max: 200 }), taxable: money(), cgst: money(),
  sgst: money(), igst: money(), lineTotal: money() });
type Totals = { [K in keyof ReturnType<typeof frozenTotals>]: AnyPgColumn } & { status: AnyPgColumn };
type Line = { [K in keyof ReturnType<typeof frozenLine>]: AnyPgColumn };
/** A header's frozen totals: all or none, none exactly while a draft, and ADR-005 §2's identity, as an invoice's. */
const totalsChecks = (table: string, t: Totals) => [
  check(`ck_${table}_frozen`, sql`num_nulls(${t.placeOfSupply}, ${t.taxable}, ${t.cgst}, ${t.sgst}, ${t.igst}, ${t.roundOff}, ${t.total}) in (0, 7)
    and (${t.status} = 'draft') = (${t.total} is null) and coalesce(${t.placeOfSupply}, '00') ~ '^[0-9]{2}$'`),
  check(`ck_${table}_identity`, sql`${t.total} = ${t.taxable} + ${t.cgst} + ${t.sgst} + ${t.igst} + ${t.roundOff}
    and abs(${t.roundOff}) < 1 and ${t.cgst} = ${t.sgst} and (${t.igst} = 0 or ${t.cgst} = 0)`),
];
/** A line's frozen figures: all or none, and its row identity. */
const lineChecks = (table: string, t: Line) => [
  check(`ck_${table}_frozen`, sql`num_nulls(${t.gstRate}, ${t.gstRateSource}, ${t.taxable}, ${t.cgst}, ${t.sgst}, ${t.igst}, ${t.lineTotal}) in (0, 7)`),
  check(`ck_${table}_identity`, sql`${t.lineTotal} = ${t.taxable} + ${t.cgst} + ${t.sgst} + ${t.igst}
    and ${t.cgst} = ${t.sgst} and (${t.igst} = 0 or ${t.cgst} = 0)`),
];

/**
 * A quote (ADR-007 §1, M3-08): what we offered a party, at what rates. It posts nothing. Its service moves it:
 * draft → sent (its number drawn, QT) → accepted (which makes a draft order from it), declined or expired. A draft
 * has no number, so thrown-away drafts leave no gaps (§3).
 */
export const salesQuotes = radcoreTable('sales_quotes', {
  id: id(), createdAt: createdMoment(),
  number: text().unique(),
  partyId: uuid().notNull().references(() => parties.id, { onDelete: 'restrict' }),
  businessDate: date({ mode: 'string' }).notNull(),
  validUntil: date({ mode: 'string' }),
  status: text().notNull().default('draft'),
  notes: boundedText({ max: 500 }),
  ...frozenTotals(),
}, (t) => [
  ...totalsChecks('sales_quotes', t),
  index('ix_sales_quotes_party').on(t.partyId),
  index('ix_sales_quotes_date').on(t.businessDate, t.createdAt, t.id),
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
  ...frozenLine(),
}, (t) => [
  ...lineChecks('sales_quote_lines', t),
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
  id: id(), createdAt: createdMoment(),
  number: text().unique(),
  partyId: uuid().notNull().references(() => parties.id, { onDelete: 'restrict' }),
  // The price list it was made from (its party's, else the default), copied when it's made (RAD-113).
  priceListId: uuid().references(() => priceLists.id, { onDelete: 'restrict' }),
  quoteId: uuid().unique().references(() => salesQuotes.id, { onDelete: 'restrict' }),
  businessDate: date({ mode: 'string' }).notNull(),
  status: text().notNull().default('draft'),
  notes: boundedText({ max: 500 }),
  // Why it was closed with lines undelivered, or cancelled (RC-125); null otherwise.
  closeReason: boundedText({ max: 500 }),
  // The version an override of its checks was approved for (sales:override, M3-07): confirming takes it while the
  // order and its issues still hash to it.
  overrideVersion: text(),
  ...frozenTotals(),
}, (t) => [
  ...totalsChecks('sales_orders', t),
  index('ix_sales_orders_price_list').on(t.priceListId),
  index('ix_sales_orders_party').on(t.partyId),
  index('ix_sales_orders_date').on(t.businessDate, t.createdAt, t.id),
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
  // The list's rate for the item on the order's date as its version prices it, and the version: filled by the service,
  // never from input; null when the list has none (the architect on RAD-113, #256). The check takes GST out exactly.
  listRate: unitPrice(),
  listVersionId: uuid().references(() => priceListVersions.id, { onDelete: 'restrict' }),
  ...frozenLine(),
}, (t) => [
  ...lineChecks('sales_order_lines', t),
  uniqueIndex('ux_sales_order_lines_line').on(t.orderId, t.lineNo),
  index('ix_sales_order_lines_list_version').on(t.listVersionId),
  index('ix_sales_order_lines_item').on(t.itemId),
]);

/**
 * A delivery (challan, ADR-007 §1, ADR-006 §6, F5): goods out to a party against its order's lines, from one place.
 * Draft → posted → cancelled (#185's guards). Posting takes the goods out at the place's average, through Goods
 * Delivered Not Invoiced (entry `delivery`), with the batches the person picked and each serialised unit's `delivered`
 * event; it sets the number (DC), drawn last, and the entry. Only cancelling (M3-10) changes a posted one.
 */
export const deliveries = radcoreTable('deliveries', {
  id: id(), createdAt: createdMoment(),
  status: text().notNull().default('draft'),
  number: text().unique(),
  orderId: uuid().notNull().references(() => salesOrders.id, { onDelete: 'restrict' }),
  partyId: uuid().notNull().references(() => parties.id, { onDelete: 'restrict' }),
  locationId: uuid().notNull().references(() => locations.id, { onDelete: 'restrict' }),
  businessDate: date({ mode: 'string' }).notNull(),
  notes: boundedText({ max: 500 }),
  // Whose it is for record scope (ADR-001 §6a, ADR-007 §1): its order's owner, copied when it's made, so a salesperson
  // sees the delivery of their own order, whoever made it. A principal key ("user:<id>"), as created_by is.
  owner: text().notNull(),
  // The version an override of its credit check was approved for (sales:override, M3-07), as an order's.
  overrideVersion: text(),
  postedEntryId: uuid().references(() => journalEntries.id, { onDelete: 'restrict' }),
  cancelledAt: timestamp({ withTimezone: true }),
  cancelledBy: text(),
  cancelReason: boundedText({ max: 500 }),
  cancelEntryId: uuid().references(() => journalEntries.id, { onDelete: 'restrict' }),
}, (t) => [
  check('ck_deliveries_status', sql`${t.status} in ('draft', 'posted', 'cancelled')`),
  // Posted, it has its number, and its entry unless every movement was of value 0 (an entry has two lines or more).
  check('ck_deliveries_posted', sql`(${t.status} = 'draft') = (${t.number} is null) and (${t.status} <> 'draft' or ${t.postedEntryId} is null)`),
  check('ck_deliveries_cancelled', sql`(${t.status} = 'cancelled') = (${t.cancelEntryId} is not null)`),
  index('ix_deliveries_order').on(t.orderId),
  index('ix_deliveries_party_date').on(t.partyId, t.businessDate),
  index('ix_deliveries_location').on(t.locationId),
  index('ix_deliveries_posted_entry').on(t.postedEntryId),
  index('ix_deliveries_cancel_entry').on(t.cancelEntryId),
  index('ix_deliveries_date').on(t.businessDate, t.createdAt, t.id),
  index('ix_deliveries_owner').on(t.owner),
]);

/**
 * A delivery's line: an order line's item, how many went, and what the person picked: the batches (by id, null for
 * "batch unknown" in negative-stock mode) and, for a serialised item, the serials. Posting writes what the line went
 * out at (`value`, the stock's cost) and what it sold for (`taxable` and `gst`, at the order line's rate on the
 * delivery's date), which a return takes its share of and Goods Delivered Not Invoiced holds until it's invoiced.
 */
export const deliveryLines = radcoreTable('delivery_lines', {
  id: id(),
  deliveryId: uuid().notNull().references(() => deliveries.id, { onDelete: 'cascade' }),
  lineNo: smallint().notNull(),
  orderLineId: uuid().notNull().references(() => salesOrderLines.id, { onDelete: 'restrict' }),
  itemId: uuid().notNull().references(() => items.id, { onDelete: 'restrict' }),
  qty: qty({ line: true }).notNull(),
  picks: json().notNull(),
  value: money(),
  taxable: money(),
  gst: money(),
}, (t) => [
  uniqueIndex('ux_delivery_lines_line').on(t.deliveryId, t.lineNo),
  index('ix_delivery_lines_order_line').on(t.orderLineId),
  index('ix_delivery_lines_item').on(t.itemId),
  check('ck_delivery_lines_posted', sql`(${t.value} is null) = (${t.taxable} is null) and (${t.taxable} is null) = (${t.gst} is null)`),
]);

/**
 * A delivery return (ADR-006 §4, F5's variant): goods taken back before they're invoiced, all or part of a delivery's
 * lines, into a place. Draft → posted → cancelled (#185's guards). Posting puts each line back at its share of the
 * value it went out at, the last return of a line clearing what's left of it exactly, into the batches it left with,
 * each unit with its `delivery_returned` event, and releases the same from Goods Delivered Not Invoiced (entry
 * `delivery_return`); it sets the number (DR), drawn last.
 */
export const deliveryReturns = radcoreTable('delivery_returns', {
  id: id(), createdAt: createdMoment(),
  status: text().notNull().default('draft'),
  number: text().unique(),
  deliveryId: uuid().notNull().references(() => deliveries.id, { onDelete: 'restrict' }),
  partyId: uuid().notNull().references(() => parties.id, { onDelete: 'restrict' }),
  locationId: uuid().notNull().references(() => locations.id, { onDelete: 'restrict' }),
  businessDate: date({ mode: 'string' }).notNull(),
  notes: boundedText({ max: 500 }),
  // Whose it is for record scope: its delivery's owner, copied when it's made (ADR-007 §1).
  owner: text().notNull(),
  postedEntryId: uuid().references(() => journalEntries.id, { onDelete: 'restrict' }),
  cancelledAt: timestamp({ withTimezone: true }),
  cancelledBy: text(),
  cancelReason: boundedText({ max: 500 }),
  cancelEntryId: uuid().references(() => journalEntries.id, { onDelete: 'restrict' }),
}, (t) => [
  check('ck_delivery_returns_status', sql`${t.status} in ('draft', 'posted', 'cancelled')`),
  // Posted, it has its number, and its entry unless every movement was of value 0 (an entry has two lines or more).
  check('ck_delivery_returns_posted', sql`(${t.status} = 'draft') = (${t.number} is null) and (${t.status} <> 'draft' or ${t.postedEntryId} is null)`),
  check('ck_delivery_returns_cancelled', sql`(${t.status} = 'cancelled') = (${t.cancelEntryId} is not null)`),
  index('ix_delivery_returns_delivery').on(t.deliveryId),
  index('ix_delivery_returns_party_date').on(t.partyId, t.businessDate),
  index('ix_delivery_returns_location').on(t.locationId),
  index('ix_delivery_returns_posted_entry').on(t.postedEntryId),
  index('ix_delivery_returns_cancel_entry').on(t.cancelEntryId),
  index('ix_delivery_returns_date').on(t.businessDate, t.createdAt, t.id),
  index('ix_delivery_returns_owner').on(t.owner),
]);

/** A return's line: how many of a delivery line come back, into which of the batches it left with, and which serials.
 * Posting writes its share of the line's value, taxable and GST. */
export const deliveryReturnLines = radcoreTable('delivery_return_lines', {
  id: id(),
  returnId: uuid().notNull().references(() => deliveryReturns.id, { onDelete: 'cascade' }),
  lineNo: smallint().notNull(),
  deliveryLineId: uuid().notNull().references(() => deliveryLines.id, { onDelete: 'restrict' }),
  itemId: uuid().notNull().references(() => items.id, { onDelete: 'restrict' }),
  qty: qty({ line: true }).notNull(),
  picks: json().notNull(),
  value: money(),
  taxable: money(),
  gst: money(),
}, (t) => [
  uniqueIndex('ux_delivery_return_lines_line').on(t.returnId, t.lineNo),
  index('ix_delivery_return_lines_delivery_line').on(t.deliveryLineId),
  index('ix_delivery_return_lines_item').on(t.itemId),
  check('ck_delivery_return_lines_posted', sql`(${t.value} is null) = (${t.taxable} is null) and (${t.taxable} is null) = (${t.gst} is null)`),
]);

/**
 * An invoice (ADR-007 §1–§4, §7; ADR-006 §6, F6, F7; RC-022, RC-113): a party's delivered goods billed, all or part of
 * its posted deliveries' lines. Draft → posted → cancelled (#185's guards, and the cancel guard of allocations, ADR-005
 * §7a). Posting freezes the issuer's details from the company profile and the buyer's from the party, decides the place
 * of supply, copies each line's GST rate and its source, and posts Dr Debtors (the total), Cr Sales and Output GST,
 * the round-off, and Dr COGS, Cr GDNI for the goods' cost; its number (INV) is drawn last. `total` is what it posts to
 * the party's Debtors line, gross of GST and cess, after round-off: what receipts are allocated against (RAD-116).
 */
export const invoices = radcoreTable('invoices', {
  id: id(), createdAt: createdMoment(),
  status: text().notNull().default('draft'),
  number: text().unique(),
  partyId: uuid().notNull().references(() => parties.id, { onDelete: 'restrict' }),
  // The price list a changed line's discount is measured from (its party's, else the default), copied when it's made.
  priceListId: uuid().references(() => priceLists.id, { onDelete: 'restrict' }),
  businessDate: date({ mode: 'string' }).notNull(),
  notes: boundedText({ max: 500 }),
  // Whose it is for record scope (ADR-007 §7, the architect on RAD-113): the owner its deliveries share, else its
  // maker, copied while it's a draft and frozen when it's posted. A principal key ("user:<id>"), as created_by is.
  owner: text().notNull(),
  // Where the goods go, when it isn't the buyer's address (Rule 46): its state decides the place of supply (CA-08).
  shipToName: boundedText({ max: 200 }),
  shipToAddress: boundedText({ max: 400 }),
  shipToStateCode: text(),
  // Frozen at posting (RC-022): the issuer from the company profile, the buyer from the party, never read again.
  issuerLegalName: boundedText({ max: 200 }),
  issuerGstin: text(),
  issuerAddressLine1: boundedText({ max: 200 }),
  issuerAddressLine2: boundedText({ max: 200 }),
  issuerCity: boundedText({ max: 100 }),
  issuerPincode: text(),
  issuerStateCode: text(),
  buyerName: boundedText({ max: 200 }),
  buyerGstin: text(),
  buyerAddressLine1: boundedText({ max: 200 }),
  buyerAddressLine2: boundedText({ max: 200 }),
  buyerCity: boundedText({ max: 100 }),
  buyerPincode: text(),
  buyerStateCode: text(),
  placeOfSupply: text(),
  // The totals, written at posting: the lines' sums, and the round-off that brings them to the rupee (ADR-005 §2).
  taxable: money().notNull().default('0'),
  cgst: money().notNull().default('0'),
  sgst: money().notNull().default('0'),
  igst: money().notNull().default('0'),
  cess: money().notNull().default('0'),
  roundOff: money({ signed: true }).notNull().default('0'),
  total: money().notNull().default('0'),
  // The version an override of its checks was approved for (sales:override, M3-07), as a delivery's.
  overrideVersion: text(),
  postedEntryId: uuid().references(() => journalEntries.id, { onDelete: 'restrict' }),
  cancelledAt: timestamp({ withTimezone: true }),
  cancelledBy: text(),
  cancelReason: boundedText({ max: 500 }),
  cancelEntryId: uuid().references(() => journalEntries.id, { onDelete: 'restrict' }),
}, (t) => [
  check('ck_invoices_status', sql`${t.status} in ('draft', 'posted', 'cancelled')`),
  // Posted, it has its number, its frozen issuer and place of supply, and its entry unless nothing it posts has value.
  check('ck_invoices_posted', sql`(${t.status} = 'draft') = (${t.number} is null) and (${t.status} <> 'draft' or ${t.postedEntryId} is null)
    and (${t.status} = 'draft') = (${t.issuerGstin} is null) and (${t.status} = 'draft') = (${t.placeOfSupply} is null)`),
  check('ck_invoices_cancelled', sql`(${t.status} = 'cancelled') = (${t.cancelEntryId} is not null)`),
  // The header's own identity (ADR-005 §2): its total is its taxes and taxable value plus a round-off under 1. The
  // lines against the header are checked at commit (RA006).
  check('ck_invoices_identity', sql`${t.total} = ${t.taxable} + ${t.cgst} + ${t.sgst} + ${t.igst} + ${t.cess} + ${t.roundOff}
    and abs(${t.roundOff}) < 1 and ${t.cgst} = ${t.sgst} and (${t.igst} = 0 or ${t.cgst} = 0)`),
  check('ck_invoices_state_codes', sql`coalesce(${t.shipToStateCode}, '00') ~ '^[0-9]{2}$' and coalesce(${t.issuerStateCode}, '00') ~ '^[0-9]{2}$'
    and coalesce(${t.buyerStateCode}, '00') ~ '^[0-9]{2}$' and coalesce(${t.placeOfSupply}, '00') ~ '^[0-9]{2}$'`),
  index('ix_invoices_party_date').on(t.partyId, t.businessDate),
  index('ix_invoices_posted_entry').on(t.postedEntryId),
  index('ix_invoices_cancel_entry').on(t.cancelEntryId),
  index('ix_invoices_date').on(t.businessDate, t.createdAt, t.id),
  index('ix_invoices_owner').on(t.owner),
  index('ix_invoices_price_list').on(t.priceListId),
]);

/**
 * An invoice's line: how many of a delivery line it bills, at the order line's rate and discount unless the person set
 * another (then the price check runs, ADR-007 §9). Posting writes the item's HSN, the GST rate in force on the invoice's
 * date and its source (copied, never looked up again), the taxable value and tax, the goods' cost moved from GDNI to
 * COGS (`cost`, the line's share of what the delivery line went out at), and its share of the delivery line's taxable
 * value and GST, which it takes off the party's delivered-not-invoiced (`deliveryTaxable`, `deliveryGst`). Returns and
 * invoices of one delivery line share it: whichever comes last clears what's left (ADR-006 §4).
 */
export const invoiceLines = radcoreTable('invoice_lines', {
  id: id(),
  invoiceId: uuid().notNull().references(() => invoices.id, { onDelete: 'cascade' }),
  lineNo: smallint().notNull(),
  deliveryLineId: uuid().notNull().references(() => deliveryLines.id, { onDelete: 'restrict' }),
  itemId: uuid().notNull().references(() => items.id, { onDelete: 'restrict' }),
  qty: qty({ line: true }).notNull(),
  rate: unitPrice().notNull(),
  discountPercent: percent().notNull().default('0'),
  // Its order line's list rate when its price is unchanged, else the invoice's list's on its date (RAD-113).
  listRate: unitPrice(),
  listVersionId: uuid().references(() => priceListVersions.id, { onDelete: 'restrict' }),
  hsn: text(),
  gstRate: percent(),
  gstRateSource: boundedText({ max: 200 }),
  taxable: money(),
  cgst: money(),
  sgst: money(),
  igst: money(),
  // Cess, held at 0 until lib-gst has cess rates (CA-50; the architect on RAD-113): no CHECK pins it, so rates need
  // no migration to lift one.
  cessAdValorem: money().notNull().default('0'),
  cessPerUnitAmount: money().notNull().default('0'),
  lineTotal: money(),
  cost: money(),
  deliveryTaxable: money(),
  deliveryGst: money(),
  // The worst condition of the units it bills when not all are new, copied at posting so the buyer is told (the
  // architect on RAD-112, with stock.sell_damaged_units).
  unitCondition: text(),
}, (t) => [
  check('ck_invoice_lines_unit_condition', sql`${t.unitCondition} is null or ${t.unitCondition} in ('demo', 'used', 'damaged')`),
  uniqueIndex('ux_invoice_lines_line').on(t.invoiceId, t.lineNo),
  index('ix_invoice_lines_list_version').on(t.listVersionId),
  index('ix_invoice_lines_delivery_line').on(t.deliveryLineId),
  index('ix_invoice_lines_item').on(t.itemId),
  // Posting writes every figure at once; a draft line has none.
  check('ck_invoice_lines_posted', sql`num_nulls(${t.hsn}, ${t.gstRate}, ${t.gstRateSource}, ${t.taxable}, ${t.cgst}, ${t.sgst}, ${t.igst},
    ${t.lineTotal}, ${t.cost}, ${t.deliveryTaxable}, ${t.deliveryGst}) in (0, 11)`),
  // ADR-005 §2's row identities.
  check('ck_invoice_lines_identity', sql`${t.lineTotal} = ${t.taxable} + ${t.cgst} + ${t.sgst} + ${t.igst} + ${t.cessAdValorem} + ${t.cessPerUnitAmount}
    and ${t.cgst} = ${t.sgst} and (${t.igst} = 0 or ${t.cgst} = 0)`),
]);
