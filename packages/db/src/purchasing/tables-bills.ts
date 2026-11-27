// Purchase bills (M4-03, RAD-138; ADR-008 §1, §2, §7): what a supplier's own invoice says, entered as a draft with its
// file and posted against what was ordered and received. A bill posts to the journal, so it carries ADR-008 §2's two
// generic guards (its migration attaches them), and these CHECKs hold the values. Its tax is worked out on read while a
// draft and stored when it's posted. Its goods lines name PO lines, and the receipt line each bills once the goods are in.
import { isNull, sql } from 'drizzle-orm';
import { check, date, foreignKey, index, numeric, smallint, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { expenseCategoryAccounts } from '../accounts/tables-expenses.ts';
import { journalEntries, parties } from '../accounts/tables.ts';
import { boundedText, createdMoment, id, money, percent, qty, radcoreTable, unitPrice } from '../columns.ts';
import { files } from '../platform/tables.ts';
import { jobWorkReceiptLines } from '../stock/tables-job-work.ts';
import { items } from '../stock/tables.ts';
import { purchaseOrderLines } from './tables-orders.ts';
import { goodsReceiptLines } from './tables-receipts.ts';

/**
 * A purchase bill (ADR-008 §7). The supplier's invoice number is unique for that supplier within the financial year of
 * its date (Rule 46), compared as written in upper case and trimmed (`supplier_invoice_key`), for every bill that isn't
 * cancelled: drafts too, so a duplicate is caught as it's entered. Its owner is its maker (`created_by`).
 */
export const purchaseBills = radcoreTable('purchase_bills', {
  id: id(), createdAt: createdMoment(),
  number: text().unique(),
  partyId: uuid().notNull().references(() => parties.id, { onDelete: 'restrict' }),
  businessDate: date({ mode: 'string' }).notNull(),
  status: text().notNull().default('draft'),
  supplierInvoiceNumber: boundedText({ max: 40 }).notNull(),
  supplierInvoiceKey: text().notNull().generatedAlwaysAs(sql`upper(btrim(supplier_invoice_number))`),
  supplierInvoiceDate: date({ mode: 'string' }).notNull(),
  supplierInvoiceFy: date({ mode: 'string' }).notNull()
    .generatedAlwaysAs(sql`make_date(extract(year from supplier_invoice_date)::int - (extract(month from supplier_invoice_date) < 4)::int, 4, 1)`),
  // The GSTIN as printed on the supplier's bill: the party's own, or none for an unregistered supplier.
  supplierGstin: text(),
  // What the supplier's bill states as its total; posting holds the worked-out total to it within the round-off.
  statedTotal: money().notNull(),
  // The supplier's bill itself, a purchase_bill file: a bill posts only with it (RC-172).
  fileId: uuid().references(() => files.id, { onDelete: 'restrict' }),
  notes: boundedText({ max: 500 }),
  placeOfSupply: text(), taxable: money(), cgst: money(), sgst: money(), igst: money(), roundOff: money({ signed: true }), total: money(),
  // The TDS held back at posting (ADR-009 §4, RAD-158), and so what the supplier is owed: the invoice's total less it.
  // Allocations read `owed` (allocatable_documents.amount_column; the architect on RAD-158).
  tds: money().notNull().default('0'),
  owed: numeric({ precision: 18, scale: 2 }).generatedAlwaysAs(sql`total - tds`),
  postedEntryId: uuid().references(() => journalEntries.id, { onDelete: 'restrict' }),
  cancelledAt: timestamp({ withTimezone: true }),
  cancelledBy: text(),
  cancelReason: boundedText({ max: 500 }),
  cancelEntryId: uuid().references(() => journalEntries.id, { onDelete: 'restrict' }),
}, (t) => [
  // lib-common's PURCHASE_BILL_STATUSES, written out (L1); tools/purchase-bills.test.ts holds them equal.
  check('ck_purchase_bills_status', sql`${t.status} in ('draft', 'posted', 'cancelled')`),
  // Posted, it has its number and its tax; a draft has neither.
  check('ck_purchase_bills_posted', sql`(${t.status} = 'draft') = (${t.number} is null) and (${t.status} = 'draft') = (${t.total} is null)`),
  check('ck_purchase_bills_cancelled', sql`(${t.status} = 'cancelled') = (${t.cancelEntryId} is not null)`),
  check('ck_purchase_bills_frozen', sql`num_nulls(${t.placeOfSupply}, ${t.taxable}, ${t.cgst}, ${t.sgst}, ${t.igst}, ${t.roundOff}, ${t.total}) in (0, 7)
    and coalesce(${t.placeOfSupply}, '00') ~ '^[0-9]{2}$'`),
  check('ck_purchase_bills_owed', sql`${t.owed} >= 0 and ${t.owed} <> 'NaN'`),
  check('ck_purchase_bills_tds_within', sql`${t.total} is null and ${t.tds} = 0 or ${t.tds} <= ${t.total}`),
  check('ck_purchase_bills_identity', sql`${t.total} = ${t.taxable} + ${t.cgst} + ${t.sgst} + ${t.igst} + ${t.roundOff}
    and abs(${t.roundOff}) < 1 and ${t.cgst} = ${t.sgst} and (${t.igst} = 0 or ${t.cgst} = 0)`),
  // The supplier's date is theirs: on or before the bill's own (ADR-008 §4).
  check('ck_purchase_bills_supplier_date', sql`${t.supplierInvoiceDate} <= ${t.businessDate}`),
  check('ck_purchase_bills_supplier_gstin', sql`${t.supplierGstin} is null or ${t.supplierGstin} ~ '^[0-9]{2}[A-Z0-9]{13}$'`),
  check('ck_purchase_bills_supplier_number', sql`btrim(${t.supplierInvoiceNumber}) <> ''`),
  // Over every bill not cancelled: a bill is cancelled exactly when it has its cancel entry (ck_purchase_bills_cancelled).
  uniqueIndex('ux_purchase_bills_supplier_invoice').on(t.partyId, t.supplierInvoiceFy, t.supplierInvoiceKey).where(isNull(t.cancelEntryId)),
  index('ix_purchase_bills_party').on(t.partyId),
  index('ix_purchase_bills_date').on(t.businessDate, t.createdAt, t.id),
  index('ix_purchase_bills_file').on(t.fileId),
  index('ix_purchase_bills_posted_entry').on(t.postedEntryId),
  index('ix_purchase_bills_cancel_entry').on(t.cancelEntryId),
]);

/** A bill's line (ADR-008 §7): goods (a PO line's item, how many, at what rate before tax, as the supplier billed it),
 * a charge on the goods (freight, packing, insurance: its taxable amount and HSN or SAC), spread over the goods, or a
 * job worker's charge (a job-work receipt line's made item, how many, at what rate, with its SAC; RAD-142). */
export const purchaseBillLines = radcoreTable('purchase_bill_lines', {
  id: id(),
  billId: uuid().notNull().references((): AnyPgColumn => purchaseBills.id, { onDelete: 'cascade' }),
  lineNo: smallint().notNull(),
  kind: text().notNull(),
  poLineId: uuid().references(() => purchaseOrderLines.id, { onDelete: 'restrict' }),
  // The receipt line a goods line bills (M4-02): null while the bill has come before the goods; posting needs it.
  receiptLineId: uuid().references(() => goodsReceiptLines.id, { onDelete: 'restrict' }),
  // The job-work receipt line a job worker's charge bills (ADR-008 §11, RAD-142); a line names this or a receipt line.
  jobWorkReceiptLineId: uuid(),
  itemId: uuid().references(() => items.id, { onDelete: 'restrict' }),
  qty: qty({ line: true }),
  rate: unitPrice(),
  charge: text(),
  description: boundedText({ max: 100 }),
  hsn: text(),
  amount: money(),
  // Of a goods line's quantity, how much its price difference went to stock for at posting (ADR-006 §4's q): a cancel
  // takes that share back by the same split, as the goods stand then (the architect on RAD-138).
  revaluedQty: qty(),
  // What posting cleared of its receipt line's Goods Received Not Billed, for the books check (ADR-006 §7, RAD-95).
  grniValue: money(),
  // What posting cleared of its job-work receipt line's Job Work Charges to be Billed, for the books check (RAD-95).
  jwcbValue: money(),
  gstRate: percent(), gstRateSource: boundedText({ max: 200 }), taxable: money(), cgst: money(), sgst: money(), igst: money(), lineTotal: money(),
  // The input credit posting claimed, by head, and where none, why (ADR-009 §2, RAD-139), for ADR-010's 3B. Null on a
  // draft, and on a bill posted before RAD-139.
  creditCgst: money(), creditSgst: money(), creditIgst: money(), creditReason: text(),
  // A reverse-charge line's tax by head (ADR-010 §4, RAD-153): we owe it, not the supplier, so its own heads are 0. Null
  // on any other line and on a draft.
  rcmCgst: money(), rcmSgst: money(), rcmIgst: money(),
  // A charge's expense category and one of its accounts (ADR-009 §2, RAD-152): whether its credit is blocked, and, on a
  // bill of charges only, the account it posts to. Required there at posting (charge_needs_category).
  expenseCategoryId: uuid(), expenseAccountId: uuid(),
}, (t) => [
  check('ck_purchase_bill_lines_rcm', sql`num_nulls(${t.rcmCgst}, ${t.rcmSgst}, ${t.rcmIgst}) in (0, 3) and (${t.rcmCgst} is null
    or (${t.kind} = 'charge' and ${t.gstRate} is not null and ${t.cgst} = 0 and ${t.sgst} = 0 and ${t.igst} = 0
      and ${t.rcmCgst} = ${t.rcmSgst} and (${t.rcmIgst} = 0 or ${t.rcmCgst} = 0)))`),
  check('ck_purchase_bill_lines_expense_category', sql`num_nulls(${t.expenseCategoryId}, ${t.expenseAccountId}) in (0, 2)
    and (${t.expenseCategoryId} is null or ${t.kind} = 'charge')`),
  index('ix_purchase_bill_lines_expense_category').on(t.expenseCategoryId, t.expenseAccountId),
  foreignKey({ name: 'fk_purchase_bill_lines_expense_category', columns: [t.expenseCategoryId, t.expenseAccountId],
    foreignColumns: [expenseCategoryAccounts.categoryId, expenseCategoryAccounts.accountId] }).onDelete('restrict'),
  check('ck_purchase_bill_lines_credit', sql`num_nulls(${t.creditCgst}, ${t.creditSgst}, ${t.creditIgst}) in (0, 3)
    and (${t.creditCgst} is null or ${t.gstRate} is not null) and (${t.creditReason} is null or ${t.creditCgst} is not null)`),
  // All the line's tax (a reverse-charge line's, the tax we owe), or none and why.
  check('ck_purchase_bill_lines_credit_whole', sql`${t.creditCgst} is null
    or (${t.creditReason} is null and ${t.creditCgst} = coalesce(${t.rcmCgst}, ${t.cgst}) and ${t.creditSgst} = coalesce(${t.rcmSgst}, ${t.sgst})
      and ${t.creditIgst} = coalesce(${t.rcmIgst}, ${t.igst}))
    or (${t.creditReason} in ('supplier_kind', 'blocked', 'state') and ${t.creditCgst} = 0 and ${t.creditSgst} = 0 and ${t.creditIgst} = 0)`),
  check('ck_purchase_bill_lines_kind', sql`${t.kind} in ('goods', 'charge', 'job_work')`),
  // A goods line names its PO line and item, with a quantity and rate; a charge, its kind, words, HSN and amount.
  check('ck_purchase_bill_lines_goods', sql`(${t.kind} = 'goods') = (${t.poLineId} is not null and ${t.itemId} is not null and ${t.qty} is not null
    and ${t.rate} is not null) and (${t.kind} = 'charge') = (${t.charge} is not null and ${t.description} is not null and ${t.hsn} is not null
    and ${t.amount} is not null)`),
  check('ck_purchase_bill_lines_receipt', sql`${t.receiptLineId} is null or ${t.kind} = 'goods'`),
  check('ck_purchase_bill_lines_grni', sql`${t.grniValue} is null or ${t.receiptLineId} is not null`),
  // A job worker's charge names its job-work receipt line, its made item, a quantity, rate and SAC, and never a PO or
  // goods receipt line: each line names one source at most (the architect on RAD-142).
  check('ck_purchase_bill_lines_job_work', sql`(${t.kind} = 'job_work') = (${t.jobWorkReceiptLineId} is not null and ${t.itemId} is not null
    and ${t.qty} is not null and ${t.rate} is not null and ${t.hsn} is not null)`),
  check('ck_purchase_bill_lines_one_source', sql`num_nonnulls(${t.receiptLineId}, ${t.jobWorkReceiptLineId}) <= 1`),
  check('ck_purchase_bill_lines_jwcb', sql`${t.jwcbValue} is null or ${t.jobWorkReceiptLineId} is not null`),
  check('ck_purchase_bill_lines_charge', sql`${t.charge} is null or ${t.charge} in ('freight', 'packing', 'insurance', 'other')`),
  check('ck_purchase_bill_lines_hsn', sql`${t.hsn} is null or ${t.hsn} ~ '^[0-9]{4}([0-9]{2}){0,2}$'`),
  check('ck_purchase_bill_lines_frozen', sql`num_nulls(${t.gstRate}, ${t.gstRateSource}, ${t.taxable}, ${t.cgst}, ${t.sgst}, ${t.igst},
    ${t.lineTotal}) in (0, 7)`),
  check('ck_purchase_bill_lines_identity', sql`${t.lineTotal} = ${t.taxable} + ${t.cgst} + ${t.sgst} + ${t.igst}
    and ${t.cgst} = ${t.sgst} and (${t.igst} = 0 or ${t.cgst} = 0)`),
  uniqueIndex('ux_purchase_bill_lines_line').on(t.billId, t.lineNo),
  index('ix_purchase_bill_lines_po_line').on(t.poLineId),
  index('ix_purchase_bill_lines_receipt_line').on(t.receiptLineId),
  index('ix_purchase_bill_lines_job_work_line').on(t.jobWorkReceiptLineId),
  // Named, since drizzle's own name for it is past PostgreSQL's 63 bytes.
  foreignKey({ name: 'fk_purchase_bill_lines_job_work_line', columns: [t.jobWorkReceiptLineId], foreignColumns: [jobWorkReceiptLines.id] })
    .onDelete('restrict'),
  index('ix_purchase_bill_lines_item').on(t.itemId),
]);
