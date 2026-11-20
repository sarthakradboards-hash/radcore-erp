// lib-accounts' tables (ADR-001 §3, §5). SQL zone (ADR-002 §3): `sql` only as a CHECK's argument or a generated column.
import { sql } from 'drizzle-orm';
import { bigint, boolean, check, date, foreignKey, index, primaryKey, smallint, text, timestamp, unique, uniqueIndex, uuid,
  type AnyPgColumn } from 'drizzle-orm/pg-core';
import { boundedText, id, money, radcoreTable, trigramIndex } from '../columns.ts';

/**
 * The company (M2-02, RAD-88; D-02 option A): RadCore keeps the books of one legal entity. The table holds one row at
 * most, its id fixed at 1, so a second company is refused by the primary key itself, not by a hidden form (RC-010).
 * Every field an invoice prints is required, and the state is the GSTIN's own first two characters, never a default
 * (RC-112). Until the row exists, nothing is invoiced (lib-accounts' companyForInvoice).
 */
export const company = radcoreTable('company', {
  id: smallint().primaryKey().default(1),
  legalName: boundedText({ max: 200 }).notNull(),
  gstin: text().notNull(),
  stateCode: text().notNull().generatedAlwaysAs(sql`left(gstin, 2)`),
  addressLine1: boundedText({ max: 200 }).notNull(),
  addressLine2: boundedText({ max: 200 }),
  city: boundedText({ max: 100 }).notNull(),
  pincode: text().notNull(),
}, (t) => [
  check('ck_company_one', sql`${t.id} = 1`),
  check('ck_company_gstin', sql`${t.gstin} ~ '^[0-9]{2}[A-Z]{3}[PCHFATBLJG][A-Z][0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'`),
  check('ck_company_pincode', sql`${t.pincode} ~ '^[1-9][0-9]{5}$'`),
]);

/** The financial years the company has opened (ADR-005 §6, RC-111), each by its 1 April. A ledger row's `fy_start`
 * points here, so a business date outside an opened year is refused. M5-09 closes them. */
export const financialYears = radcoreTable('financial_years', {
  start: date({ mode: 'string' }).primaryKey(),
}, (t) => [check('ck_financial_years_start', sql`extract(month from ${t.start}) = 4 and extract(day from ${t.start}) = 1`)]);

/** The company's period lock (ADR-006 §1, §3; RC-163): one row. Nothing posts on or before `locked_through`; a posting
 * reads the row FOR SHARE first, and moving the lock (M5-09) takes it FOR UPDATE, so it waits for postings in flight. */
export const periodLock = radcoreTable('period_lock', {
  id: smallint().primaryKey().default(1),
  lockedThrough: date({ mode: 'string' }),
}, (t) => [check('ck_period_lock_one', sql`${t.id} = 1`)]);

/**
 * The chart of accounts (ADR-006 §2). The system accounts are seeded by migration and named in code by `system_key`,
 * never by name or id; a trigger lets them be renamed but never removed or re-keyed. People add their own under a
 * group (`parent_id`: each bank account under Bank). `control_kind` says which entry kinds may post to the account
 * (`posting_rules`); an ordinary account is `none`. (id, control_kind) is unique, for journal_lines' foreign key.
 * An account may have a `code`, unique where set, with no scheme imposed until the CA's. One other than a system account
 * can be switched off (`active`) while its balance is zero; it then takes no new postings but a reversal or the
 * year-end close (RA009), and stays in the reports for the periods it has lines in.
 */
export const accounts = radcoreTable('accounts', {
  id: id(),
  systemKey: text().unique(),
  name: boundedText({ max: 120 }).notNull(),
  nameKey: text().notNull().generatedAlwaysAs(sql`lower(btrim(regexp_replace(name, '[[:space:]]+', ' ', 'g')))`),
  type: text().notNull(),
  controlKind: text().notNull().default('none'),
  parentId: uuid().references((): AnyPgColumn => accounts.id, { onDelete: 'restrict' }),
  code: text().unique('ux_accounts_code'),
  active: boolean().notNull().default(true),
}, (t) => [
  check('ck_accounts_system_key', sql`${t.systemKey} ~ '^[a-z][a-z0-9_]*$'`),
  check('ck_accounts_type', sql`${t.type} in ('asset', 'liability', 'equity', 'income', 'expense')`),
  check('ck_accounts_control_kind', sql`${t.controlKind} in ('none', 'party', 'stock', 'gdni', 'grni', 'gst', 'tds', 'payroll', 'opening', 'year_close')`),
  // Only a system account is a control account: the ones people add are ordinary.
  check('ck_accounts_control_system', sql`${t.controlKind} = 'none' or ${t.systemKey} is not null`),
  check('ck_accounts_code', sql`${t.code} ~ '^[0-9A-Z][0-9A-Z.-]{0,11}$'`),
  check('ck_accounts_system_active', sql`${t.systemKey} is null or ${t.active}`),
  unique('ux_accounts_name_key').on(t.nameKey),
  unique('ux_accounts_id_control_kind').on(t.id, t.controlKind),
  index('ix_accounts_parent_id').on(t.parentId),
]);

/** Which entry kinds may post to each control kind (ADR-006 §2, RC-093): seeded by migration, read-only to the app,
 * and equal to lib-common's POSTING_RULES (a test checks). A journal line's foreign key refuses any other pair. */
export const postingRules = radcoreTable('posting_rules', {
  controlKind: text().notNull(),
  entryKind: text().notNull(),
}, (t) => [primaryKey({ name: 'pk_posting_rules', columns: [t.controlKind, t.entryKind] })]);

/**
 * Journal entries (ADR-006 §3; ADR-005 §6, §7). Append-only: a correction is a reversal, a new entry with
 * `reverses_entry_id`, its lines the original's swapped line for line, dated the day of the reversal. One entry per
 * document and kind; a manual journal is its own document and carries a reason. `number` comes from the journal's
 * series (RAD-87), last. Debits equal credits, checked at commit (RA002); the period lock is checked under the lock
 * (RA003).
 */
export const journalEntries = radcoreTable('journal_entries', {
  id: id(),
  number: text().notNull().unique(),
  kind: text().notNull(),
  businessDate: date({ mode: 'string' }).notNull(),
  postedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  fyStart: date({ mode: 'string' }).notNull()
    .generatedAlwaysAs(sql`make_date(extract(year from business_date)::int - (extract(month from business_date) < 4)::int, 4, 1)`),
  sourceTable: text().notNull(),
  sourceId: uuid().notNull(),
  reversesEntryId: uuid().unique(),
  reason: boundedText({ max: 500 }),
  // The transaction that wrote it, set by the database: its lines are written in the same one, never added later.
  txId: bigint({ mode: 'number' }).notNull().default(0),
}, (t) => [
  check('ck_journal_entries_kind', sql`${t.kind} in ('opening', 'goods_receipt', 'purchase_bill', 'supplier_return', 'delivery', 'delivery_return', 'invoice', 'credit_note', 'payment_in', 'payment_out', 'expense', 'stock_transfer', 'stock_adjustment', 'job_work', 'revaluation', 'salary_advance', 'payroll', 'payroll_payment', 'statutory_payment', 'tds_deposit', 'transfer', 'manual', 'year_close')`),
  check('ck_journal_entries_source_table', sql`${t.sourceTable} ~ '^[a-z][a-z0-9_]*$' and to_regclass('radcore.' || ${t.sourceTable}) is not null`),
  // A manual journal is its own document, and says why.
  // A manual journal is its own document; its reversal belongs to the same document, the original (RAD-86's routes).
  check('ck_journal_entries_manual', sql`${t.kind} <> 'manual' or (${t.sourceTable} = 'journal_entries' and ${t.reason} is not null
    and (${t.sourceId} = ${t.id} or ${t.sourceId} = ${t.reversesEntryId}))`),
  unique('ux_journal_entries_source').on(t.sourceTable, t.sourceId, t.kind, t.reversesEntryId).nullsNotDistinct(),
  unique('ux_journal_entries_id_kind').on(t.id, t.kind),
  unique('ux_journal_entries_id_kind_date').on(t.id, t.kind, t.businessDate),
  // A reversal keeps the original's kind.
  foreignKey({ name: 'fk_journal_entries_reverses', columns: [t.reversesEntryId, t.kind], foreignColumns: [t.id, t.kind] }),
  foreignKey({ name: 'fk_journal_entries_fy_start', columns: [t.fyStart], foreignColumns: [financialYears.start] }),
  index('ix_journal_entries_business_date').on(t.businessDate),
  index('ix_journal_entries_reverses').on(t.reversesEntryId, t.kind),
  index('ix_journal_entries_fy_start').on(t.fyStart),
]);

/**
 * Journal lines (ADR-006 §2, §3; ADR-005 §2, §6, §7). Append-only. Each copies its entry's kind and date, and its
 * account's control kind, through composite foreign keys, all NOT NULL so none can be left out; `rule_kind` then
 * meets `posting_rules`, so a control account takes only its own entry kinds. Exactly one of debit and credit is
 * above zero. A Debtors or Creditors line names its party, a Stock in Hand line its item and location, and no other.
 */
export const journalLines = radcoreTable('journal_lines', {
  id: id(),
  entryId: uuid().notNull(),
  lineNo: smallint().notNull(),
  entryKind: text().notNull(),
  businessDate: date({ mode: 'string' }).notNull(),
  postedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  fyStart: date({ mode: 'string' }).notNull()
    .generatedAlwaysAs(sql`make_date(extract(year from business_date)::int - (extract(month from business_date) < 4)::int, 4, 1)`),
  accountId: uuid().notNull(),
  accountControlKind: text().notNull(),
  ruleKind: text().generatedAlwaysAs(sql`nullif(account_control_kind, 'none')`),
  debit: money().notNull().default('0'),
  credit: money().notNull().default('0'),
  partyId: uuid(),
  itemId: uuid(),
  locationId: uuid(),
}, (t) => [
  check('ck_journal_lines_line_no', sql`${t.lineNo} > 0`),
  check('ck_journal_lines_one_side', sql`(${t.debit} > 0) <> (${t.credit} > 0)`),
  check('ck_journal_lines_party', sql`(${t.accountControlKind} = 'party') = (${t.partyId} is not null)`),
  check('ck_journal_lines_stock', sql`(${t.accountControlKind} = 'stock') = (${t.itemId} is not null and ${t.locationId} is not null)
    and (${t.itemId} is null) = (${t.locationId} is null)`),
  unique('ux_journal_lines_entry_line').on(t.entryId, t.lineNo),
  foreignKey({ name: 'fk_journal_lines_entry', columns: [t.entryId, t.entryKind, t.businessDate],
    foreignColumns: [journalEntries.id, journalEntries.kind, journalEntries.businessDate] }),
  foreignKey({ name: 'fk_journal_lines_account', columns: [t.accountId, t.accountControlKind],
    foreignColumns: [accounts.id, accounts.controlKind] }),
  foreignKey({ name: 'fk_journal_lines_rule', columns: [t.ruleKind, t.entryKind],
    foreignColumns: [postingRules.controlKind, postingRules.entryKind] }),
  foreignKey({ name: 'fk_journal_lines_fy_start', columns: [t.fyStart], foreignColumns: [financialYears.start] }),
  // Each foreign key's own index (the schema test), the account's first, for the ledger's reads.
  index('ix_journal_lines_account').on(t.accountId, t.accountControlKind),
  index('ix_journal_lines_entry').on(t.entryId, t.entryKind, t.businessDate),
  index('ix_journal_lines_rule').on(t.ruleKind, t.entryKind),
  index('ix_journal_lines_fy_start').on(t.fyStart),
  index('ix_journal_lines_party_id').on(t.partyId),
]);

/** The documents a write touched, each to be checked once at its commit (ADR-005 §2): a statement trigger adds a
 * document's id, and a deferred trigger checks it and removes the row. Machinery, empty between transactions. */
export const pendingDocumentChecks = radcoreTable('pending_document_checks', {
  tableName: text().notNull(),
  documentId: uuid().notNull(),
}, (t) => [primaryKey({ name: 'pk_pending_document_checks', columns: [t.tableName, t.documentId] })]);

/**
 * Parties (M2-11, RAD-90): everyone RadCore sells to or buys from, as one or more kinds (a dealer who also supplies is
 * one party). A registered party's GSTIN is unique, its PAN is the GSTIN's own, and its state is the GSTIN's; an
 * unregistered party still has a state, for the place of supply (ADR-006 §6). A composition dealer is registered.
 * Phone, email and address are personal data: answered as pii(), and redacted in the audit trail (RAD-40). Credit
 * terms are set only through their own route, with parties:manage. A party is switched off, never deleted (ADR-005 §3).
 */
export const parties = radcoreTable('parties', {
  id: id(),
  name: boundedText({ max: 200 }).notNull(),
  // Its kinds, one or more: a dealer who also supplies is one party.
  customer: boolean().notNull().default(false),
  dealer: boolean().notNull().default(false),
  franchisee: boolean().notNull().default(false),
  supplier: boolean().notNull().default(false),
  gstin: text(),
  pan: text(),
  composition: boolean().notNull().default(false),
  stateCode: text().notNull(),
  phone: text(),
  email: boundedText({ max: 254 }),
  addressLine1: boundedText({ max: 200 }),
  addressLine2: boundedText({ max: 200 }),
  city: boundedText({ max: 100 }),
  pincode: text(),
  creditDays: smallint(),
  creditLimit: money(),
  active: boolean().notNull().default(true),
}, (t) => [
  uniqueIndex('ux_parties_gstin').on(t.gstin),
  trigramIndex('ix_parties_name_trgm', t.name),
  check('ck_parties_kinds', sql`${t.customer} or ${t.dealer} or ${t.franchisee} or ${t.supplier}`),
  check('ck_parties_gstin', sql`${t.gstin} ~ '^[0-9]{2}[A-Z]{3}[PCHFATBLJG][A-Z][0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'`),
  check('ck_parties_pan', sql`${t.pan} ~ '^[A-Z]{3}[PCHFATBLJG][A-Z][0-9]{4}[A-Z]$'`),
  check('ck_parties_pan_in_gstin', sql`${t.gstin} is null or ${t.pan} is null or substr(${t.gstin}, 3, 10) = ${t.pan}`),
  check('ck_parties_state', sql`${t.stateCode} ~ '^[0-9]{2}$' and (${t.gstin} is null or left(${t.gstin}, 2) = ${t.stateCode})`),
  check('ck_parties_composition', sql`not ${t.composition} or ${t.gstin} is not null`),
  check('ck_parties_phone', sql`${t.phone} ~ '^[+][1-9][0-9]{6,14}$'`),
  check('ck_parties_pincode', sql`${t.pincode} ~ '^[1-9][0-9]{5}$'`),
  check('ck_parties_credit_days', sql`${t.creditDays} between 0 and 365`),
]);

/**
 * Receipts, payments and refunds (M3-12, RAD-116; ADR-007 §1–§5, §8; ADR-006 §6, F8). A receipt takes money from a
 * party (Cr Debtors), a payment pays one (Dr Creditors), a refund pays a customer back against the receipt it names
 * (Dr Debtors). `amount` is what the party's line carries, gross of any TDS held back (`tds`, never the whole); the
 * money account (cash or a bank) gets the rest. Draft → posted → cancelled (#185's guards): posting sets the number
 * (RV or PV) and the entry, and only cancelling changes a posted one, by a mirror entry dated the cancellation's day.
 */
export const payments = radcoreTable('payments', {
  id: id(),
  kind: text().notNull(),
  status: text().notNull().default('draft'),
  number: text().unique(),
  partyId: uuid().notNull().references(() => parties.id, { onDelete: 'restrict' }),
  businessDate: date({ mode: 'string' }).notNull(),
  amount: money().notNull(),
  tds: money().notNull().default('0'),
  accountId: uuid().notNull().references(() => accounts.id, { onDelete: 'restrict' }),
  refundOfId: uuid().references((): AnyPgColumn => payments.id, { onDelete: 'restrict' }),
  narration: boundedText({ max: 500 }),
  postedEntryId: uuid().references(() => journalEntries.id, { onDelete: 'restrict' }),
  cancelledAt: timestamp({ withTimezone: true }),
  cancelledBy: text(),
  cancelReason: boundedText({ max: 500 }),
  cancelEntryId: uuid().references(() => journalEntries.id, { onDelete: 'restrict' }),
}, (t) => [
  check('ck_payments_kind', sql`${t.kind} in ('receipt', 'payment', 'refund')`),
  check('ck_payments_status', sql`${t.status} in ('draft', 'posted', 'cancelled')`),
  // money() already holds each at or above zero (ck_payments_amount, ck_payments_tds).
  check('ck_payments_figures', sql`${t.amount} > 0 and ${t.tds} < ${t.amount}`),
  check('ck_payments_refund', sql`(${t.kind} = 'refund') = (${t.refundOfId} is not null) and (${t.kind} <> 'refund' or ${t.tds} = 0)`),
  check('ck_payments_posted', sql`(${t.status} = 'draft') = (${t.number} is null) and (${t.status} = 'draft') = (${t.postedEntryId} is null)`),
  check('ck_payments_cancelled', sql`(${t.status} = 'cancelled') = (${t.cancelEntryId} is not null)`),
  index('ix_payments_party_date').on(t.partyId, t.businessDate),
  index('ix_payments_refund_of').on(t.refundOfId),
  index('ix_payments_account').on(t.accountId),
  index('ix_payments_posted_entry').on(t.postedEntryId),
  index('ix_payments_cancel_entry').on(t.cancelEntryId),
]);

/**
 * A payment applied to a document (M3-12, RAD-116; ADR-005 §7a, the architect's ruling): a receipt to a receivable
 * charge, a payment to a payable charge, of one party. The document is named as `(document_table, document_id)`, its
 * table one `allocatable_documents` lists (hand-written in this migration, with its foreign keys). Append-only: a
 * reversal undoes exactly one apply of the same document, payment and amount, through the composite foreign key. The
 * caps are checked at commit (RA006), the payment's row locked before the document's.
 */
export const paymentAllocations = radcoreTable('payment_allocations', {
  id: id(),
  paymentId: uuid().notNull().references(() => payments.id, { onDelete: 'restrict' }),
  documentTable: text().notNull(),
  documentId: uuid().notNull(),
  direction: text().notNull(),
  amount: money().notNull(),
  businessDate: date({ mode: 'string' }).notNull(),
  postedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  fyStart: date({ mode: 'string' }).notNull()
    .generatedAlwaysAs(sql`make_date(extract(year from business_date)::int - (extract(month from business_date) < 4)::int, 4, 1)`),
  reversesId: uuid().unique('ux_payment_allocations_reverses'),
  reversesDirection: text().generatedAlwaysAs(sql`case when reverses_id is not null then 'apply' end`),
}, (t) => [
  check('ck_payment_allocations_direction', sql`${t.direction} in ('apply', 'reverse')`),
  check('ck_payment_allocations_positive', sql`${t.amount} > 0`),
  check('ck_payment_allocations_reverse', sql`(${t.direction} = 'reverse') = (${t.reversesId} is not null)`),
  unique('ux_payment_allocations_key').on(t.id, t.documentTable, t.documentId, t.paymentId, t.amount, t.direction),
  foreignKey({ name: 'fk_payment_allocations_reverses',
    columns: [t.reversesId, t.documentTable, t.documentId, t.paymentId, t.amount, t.reversesDirection],
    foreignColumns: [t.id, t.documentTable, t.documentId, t.paymentId, t.amount, t.direction] }),
  index('ix_payment_allocations_payment').on(t.paymentId),
  index('ix_payment_allocations_document').on(t.documentTable, t.documentId),
  foreignKey({ name: 'fk_payment_allocations_fy_start', columns: [t.fyStart], foreignColumns: [financialYears.start] }),
  index('ix_payment_allocations_fy_start').on(t.fyStart),
  index('ix_payment_allocations_reverses').on(t.reversesId, t.documentTable, t.documentId, t.paymentId, t.amount, t.reversesDirection),
]);

/**
 * A credit (a credit note, or M4's debit note) applied to a charge on the same side, of one party (ADR-005 §7a). Both
 * are named by table and id, each table one `allocatable_documents` lists. Append-only, with reversals as above.
 */
export const creditApplications = radcoreTable('credit_applications', {
  id: id(),
  creditTable: text().notNull(),
  creditId: uuid().notNull(),
  documentTable: text().notNull(),
  documentId: uuid().notNull(),
  direction: text().notNull(),
  amount: money().notNull(),
  businessDate: date({ mode: 'string' }).notNull(),
  postedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  fyStart: date({ mode: 'string' }).notNull()
    .generatedAlwaysAs(sql`make_date(extract(year from business_date)::int - (extract(month from business_date) < 4)::int, 4, 1)`),
  reversesId: uuid().unique('ux_credit_applications_reverses'),
  reversesDirection: text().generatedAlwaysAs(sql`case when reverses_id is not null then 'apply' end`),
}, (t) => [
  check('ck_credit_applications_direction', sql`${t.direction} in ('apply', 'reverse')`),
  check('ck_credit_applications_positive', sql`${t.amount} > 0`),
  check('ck_credit_applications_reverse', sql`(${t.direction} = 'reverse') = (${t.reversesId} is not null)`),
  unique('ux_credit_applications_key').on(t.id, t.creditTable, t.creditId, t.documentTable, t.documentId, t.amount, t.direction),
  foreignKey({ name: 'fk_credit_applications_reverses',
    columns: [t.reversesId, t.creditTable, t.creditId, t.documentTable, t.documentId, t.amount, t.reversesDirection],
    foreignColumns: [t.id, t.creditTable, t.creditId, t.documentTable, t.documentId, t.amount, t.direction] }),
  index('ix_credit_applications_credit').on(t.creditTable, t.creditId),
  index('ix_credit_applications_document').on(t.documentTable, t.documentId),
  foreignKey({ name: 'fk_credit_applications_fy_start', columns: [t.fyStart], foreignColumns: [financialYears.start] }),
  index('ix_credit_applications_fy_start').on(t.fyStart),
  index('ix_credit_applications_reverses').on(t.reversesId, t.creditTable, t.creditId, t.documentTable, t.documentId, t.amount,
    t.reversesDirection),
]);
