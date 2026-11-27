// lib-accounts' route contracts (ADR-001 §6, §7a): declared once, shared by the API and the web app. Like every
// contract file it imports only zod and lib-common (D5), so the browser can load it.
import {
  ACCOUNT_TYPES, CONTROL_KINDS, dateRange, dateString, dec, defineContract, emailString, ENTRY_KINDS, gstinString, idString,
  listInput, listOf, momentString, moneyString, panString, phoneString, pii, piiRecord, principalOut, reason, searchText,
  stateCodeString,
} from '@radcore/lib-common';
import { approvalContracts } from '@radcore/lib-platform/contract';
import { z } from 'zod';

const read = { readOnly: true, isolation: 'read committed' } as const;
const write = { readOnly: false, isolation: 'read committed' } as const;

/** What the company profile holds (M2-02, RAD-88): everything an invoice prints about the seller. The state is the
 * GSTIN's own (its first two characters), so it's answered, never sent. */
const companyFields = z.object({
  legalName: z.string().trim().min(1, 'Enter the company’s legal name').max(200),
  gstin: gstinString(),
  addressLine1: z.string().trim().min(1, 'Enter the address').max(200),
  addressLine2: z.string().trim().max(200).nullable(),
  city: z.string().trim().min(1, 'Enter the city').max(100),
  pincode: z.string().regex(/^[1-9][0-9]{5}$/, 'Enter the 6-digit PIN code'),
});

/** GET /admin/company: the company profile, or null until it's set. Nothing is invoiced while it's null (RC-112). */
export const getCompany = defineContract({
  method: 'GET', path: '/admin/company', auth: 'session', perm: 'company:read', tx: read,
  input: z.object({}),
  output: z.object({ company: companyFields.extend({ stateCode: z.string().length(2) }).nullable() }),
});

/** PUT /admin/company: sets the one company's profile, every field at once (D-02 option A: there is no second
 * company to create, RC-010). A change is audited with the person's reason. */
export const setCompany = defineContract({
  method: 'PUT', path: '/admin/company', auth: 'session', perm: 'company:write', tx: write,
  input: companyFields.extend({ reason: reason() }),
  output: z.object({ stateCode: z.string().length(2) }),
});

// Parties (M2-11, RAD-90): everyone RadCore sells to or buys from.
export const PARTY_KINDS = ['customer', 'dealer', 'franchisee', 'supplier'] as const;
/** The kinds we sell to: a party of any of them may be on a quote, order, delivery or invoice (lib-sales' sellingTo). */
export const SELLS_TO_KINDS = ['customer', 'dealer', 'franchisee'] as const satisfies readonly (typeof PARTY_KINDS)[number][];
/** The kinds we buy from: a party of any of them may be on a purchase order, receipt or bill (ADR-008 §5, RAD-136). */
export const BUYS_FROM_KINDS = ['supplier'] as const satisfies readonly (typeof PARTY_KINDS)[number][];
const partyKinds = () => z.array(z.enum(PARTY_KINDS)).min(1, 'Choose at least one kind').max(4)
  .refine((k) => new Set(k).size === k.length, 'Each kind once');

/** A party's own fields, as sent. A personal field is plain here: an edit leaves out what it can't see. */
const partyFields = {
  name: z.string().trim().min(1, 'Name the party').max(200),
  kinds: partyKinds(),
  gstin: gstinString().nullable(),
  pan: panString().nullable(),
  composition: z.boolean(),
  // 96 (other country) is only an overseas supplier's (ADR-010 §4, RAD-153).
  stateCode: stateCodeString().or(z.literal('96')),
  phone: phoneString().nullable(),
  email: emailString().nullable(),
  addressLine1: z.string().trim().max(200).nullable(),
  addressLine2: z.string().trim().max(200).nullable(),
  city: z.string().trim().max(100).nullable(),
  pincode: z.string().regex(/^[1-9][0-9]{5}$/, 'Enter the 6-digit PIN code').nullable(),
};

/** The rules between a party's tax fields, for a whole party: the PAN is the GSTIN's own, the state is the GSTIN's,
 * a composition dealer is registered, and an overseas supplier (ADR-010 §4) is a supplier only, in state 96, with no
 * GSTIN or PAN. The database holds the same rules as CHECKs. */
export function partyTaxIssues(p: { gstin: string | null; pan: string | null; stateCode: string; composition: boolean; overseas?: boolean | undefined;
  kinds?: readonly string[] | undefined }) {
  const issues: { path: string[]; code: string; message: string }[] = [];
  if ((p.overseas ?? false) !== (p.stateCode === '96')) {
    issues.push({ path: ['stateCode'], code: 'overseas_state', message: p.overseas ? 'An overseas supplier’s state is 96, other country'
      : 'Only an overseas supplier is in 96, other country' });
  }
  if (p.overseas === true && (p.gstin !== null || p.pan !== null || p.composition)) {
    issues.push({ path: ['overseas'], code: 'overseas_unregistered', message: 'An overseas supplier has no GSTIN or PAN' });
  }
  if (p.overseas === true && p.kinds !== undefined && (p.kinds.length !== 1 || p.kinds[0] !== 'supplier')) {
    issues.push({ path: ['kinds'], code: 'overseas_supplier_only', message: 'An overseas party is a supplier only' });
  }
  if (p.gstin !== null && p.pan !== null && p.gstin.slice(2, 12) !== p.pan) {
    issues.push({ path: ['pan'], code: 'pan_not_gstin', message: 'The PAN isn’t the one in the GSTIN' });
  }
  if (p.gstin !== null && p.gstin.slice(0, 2) !== p.stateCode) {
    issues.push({ path: ['stateCode'], code: 'state_not_gstin', message: 'The state isn’t the GSTIN’s' });
  }
  if (p.composition && p.gstin === null) {
    issues.push({ path: ['composition'], code: 'composition_needs_gstin', message: 'A composition dealer has a GSTIN' });
  }
  return issues;
}

/** A party as it's answered: phone, email and address are personal data, masked unless the person holds pii:read or
 * parties:contact (Sarthak: "via own permission"; #182's seenWith), and each record shown unmasked is logged as a look.
 * The name is a business's, on every document. */
const party = piiRecord('parties', z.object({
  id: idString(), name: z.string(), kinds: z.array(z.enum(PARTY_KINDS)), gstin: z.string().nullable(),
  pan: z.string().nullable(), composition: z.boolean(), overseas: z.boolean(), stateCode: z.string(),
  phone: pii(z.string().nullable(), 'last4'), email: pii(z.string().nullable()),
  addressLine1: pii(z.string().nullable()), addressLine2: pii(z.string().nullable()), city: pii(z.string().nullable()),
  pincode: pii(z.string().nullable()),
  creditDays: z.number().int().nullable(), creditLimit: moneyString().nullable(), active: z.boolean(),
}), { seenWith: 'parties:contact' });

/** GET /parties (parties:read): by name, a page at a time, searched by name or GSTIN, filtered by kind and active. */
export const listParties = defineContract({
  method: 'GET', path: '/parties', auth: 'session', perm: 'parties:read', tx: read,
  input: listInput(z.object({ search: searchText().optional(), kind: z.enum(PARTY_KINDS).optional(), active: z.boolean().optional(),
    // The parties a sale may name (SELLS_TO_KINDS): for the sales screens' pickers, a dealer or franchisee too (RAD-131).
    sellsTo: z.literal(true).optional(),
    // The parties a purchase may name (BUYS_FROM_KINDS): for the purchasing screens' supplier picker (RAD-136).
    buysFrom: z.literal(true).optional(),
    // The parties with this phone, matched exactly once normalised: only for someone who sees phones (parties:contact,
    // RAD-103's rule), so the counter can pick the customer a quick bill's buyer already is (the architect on #318).
    phone: z.string().trim().min(1).max(20).optional() })),
  output: listOf(party),
});

/** GET /parties/:id (parties:read). */
export const getParty = defineContract({
  method: 'GET', path: '/parties/:id', auth: 'session', perm: 'parties:read', tx: read,
  input: z.object({ id: idString() }), output: party,
});

/** POST /parties (parties:write). Credit terms aren't here: they're set with parties:manage (setPartyCredit).
 * gstin_taken: a GSTIN names one party. */
export const createParty = defineContract({
  method: 'POST', path: '/parties', auth: 'session', perm: 'parties:write', tx: write,
  // Overseas: a supplier abroad of services paid in rupees, under reverse charge (ADR-010 §4, RAD-153).
  input: z.object({ ...partyFields, overseas: z.boolean().optional() }).superRefine((p, c) => {
    for (const i of partyTaxIssues(p)) c.addIssue({ code: 'custom', path: i.path, message: i.message });
  }),
  output: z.object({ id: idString() }), errors: ['gstin_taken'],
});

/** PATCH /parties/:id (parties:write): any of a party's own fields; the tax rules are checked on the party as it
 * will be. A party is switched off (`active: false`), never deleted (ADR-005 §3). */
export const updateParty = defineContract({
  method: 'PATCH', path: '/parties/:id', auth: 'session', perm: 'parties:write', tx: write,
  input: z.object(partyFields).partial().extend({ id: idString(), overseas: z.boolean().optional(), active: z.boolean().optional() }),
  output: z.object({}), errors: ['gstin_taken', 'system_party'],
});

/** PUT /parties/:id/credit (parties:manage): the party's credit days and limit, null for none, with the person's
 * reason. The only way to set them (M2-11). */
export const setPartyCredit = defineContract({
  method: 'PUT', path: '/parties/:id/credit', auth: 'session', perm: 'parties:manage', tx: write,
  input: z.object({ id: idString(), creditDays: z.number().int().min(0).max(365).nullable(), creditLimit: moneyString().nullable(),
    // Who manages the party (a person's id), or null for no one; left out, it stays as it is (RAD-119).
    accountManager: idString().nullable().optional(),
    reason: reason() }),
  output: z.object({}),
  errors: ['unknown_user', 'system_party'],
});

// The chart of accounts and the journal (RAD-86, M2-16's screens; ADR-006 §2, §3). The books are only posted and
// reversed: there's no route to edit or delete an entry. Posting and reversing move money, so their keys need the
// second factor (D-19).

/** An account as the chart lists it. `control` is true for a control account, which no manual journal touches; a
 * switched-off account (`active: false`) takes no new postings but a reversal or the year-end close. */
const account = z.object({
  id: idString(), code: z.string().nullable(), name: z.string(), systemKey: z.string().nullable(), type: z.enum(ACCOUNT_TYPES),
  controlKind: z.enum(CONTROL_KINDS), control: z.boolean(), parentId: idString().nullable(), active: z.boolean(),
});

/** GET /accounts (journal:read): every account, by code where it has one, then by name. The chart is small, so it's
 * one answer, not pages. */
export const listAccounts = defineContract({
  method: 'GET', path: '/accounts', auth: 'session', perm: 'journal:read', tx: read,
  input: z.object({}), output: z.object({ items: z.array(account) }),
});

/** GET /money-accounts (money_accounts:read): the switched-on accounts money moves through, Cash, Bank and those under it,
 * for a screen's payment picker (RAD-116, the architect's ruling): each one's code, name and whether it's cash, and no
 * balance, so it needs no journal:read. The chart is small, so it's one answer. */
export const listMoneyAccounts = defineContract({
  method: 'GET', path: '/money-accounts', auth: 'session', perm: 'money_accounts:read', tx: read,
  input: z.object({}),
  output: z.object({ items: z.array(z.object({ id: idString(), code: z.string().nullable(), name: z.string(), cash: z.boolean() })) }),
});

/** An account's code: upper-case letters and digits, with dots and hyphens after the first, at most 12. */
const accountCode = () => z.string().regex(/^[0-9A-Z][0-9A-Z.-]{0,11}$/, 'Use up to 12 capital letters, digits, dots or hyphens');

/** PATCH /accounts/:id (accounts:write): an account's code (null clears it), switched off or on, with the reason.
 * A system account is never switched off, and another only while its balance is zero (the architect on RAD-86). */
export const setAccount = defineContract({
  method: 'PATCH', path: '/accounts/:id', auth: 'session', perm: 'accounts:write', tx: write,
  input: z.object({ id: idString(), code: accountCode().nullable().optional(), active: z.boolean().optional(), reason: reason() })
    .refine((a) => a.code !== undefined || a.active !== undefined, 'Change the code, switch the account, or both'),
  output: z.object({}),
  errors: ['code_taken', 'system_account', 'account_not_empty'],
});

/** POST /accounts (accounts:write): an ordinary account, an expense head or a bank account, under a group: an account
 * that isn't a control account, whose type it takes (ADR-006 §2; the architect on RAD-152). Its control kind is always
 * `none`, and no system key is ever set here. */
export const createAccount = defineContract({
  method: 'POST', path: '/accounts', auth: 'session', perm: 'accounts:write', tx: write,
  input: z.object({ name: z.string().trim().min(1, 'Name it').max(120), parentId: idString(), code: accountCode().optional() }),
  output: z.object({ id: idString() }),
  errors: ['parent_not_group', 'duplicate_account', 'code_taken', 'system_account_insert'],
  // The database's own guard on a system or control account (0097); the route never asks for one.
  dbErrors: { 'RA006:system_account_insert': { code: 'system_account_insert', message: 'Only the system adds a system or control account' } },
});

/** An entry as the journal lists it: `total` is its debits' sum; `reversedBy` the entry reversing it, if any. */
const entry = z.object({
  id: idString(), number: z.string(), businessDate: dateString(), kind: z.enum(ENTRY_KINDS),
  source: z.object({ table: z.string(), id: idString() }), total: moneyString(), reversesEntryId: idString().nullable(),
  reversedBy: idString().nullable(), postedAt: momentString(), postedBy: principalOut,
});

/** GET /journal (journal:read): newest business date first, then number, a page at a time; by dates and kind. */
export const listJournal = defineContract({
  method: 'GET', path: '/journal', auth: 'session', perm: 'journal:read', tx: read,
  input: listInput(dateRange().and(z.object({ kind: z.enum(ENTRY_KINDS).optional() }))),
  output: listOf(entry),
});

/** GET /journal/:id (journal:read): one entry, its reason and its lines, each a debit or a credit. */
export const getJournal = defineContract({
  method: 'GET', path: '/journal/:id', auth: 'session', perm: 'journal:read', tx: read,
  input: z.object({ id: idString() }),
  output: entry.extend({ reason: z.string().nullable(), lines: z.array(z.object({
    lineNo: z.number().int(), account: z.object({ id: idString(), name: z.string() }), debit: moneyString(), credit: moneyString(),
    partyId: idString().nullable(), itemId: idString().nullable(), locationId: idString().nullable(),
  })) }),
});

/** A manual journal's line: one account, and a debit or a credit above zero. */
const manualLine = z.object({ accountId: idString(), debit: moneyString().optional(), credit: moneyString().optional() })
  .refine((l) => (l.debit === undefined) !== (l.credit === undefined), 'Enter a debit or a credit, not both')
  // Judged only once the amount is money: dec() throws on anything else (as recordAdSpend's did, RAD-110).
  .refine((l) => !moneyString().safeParse(l.debit ?? l.credit ?? '0').success || dec(l.debit ?? l.credit ?? '0').gt(0),
    'Enter an amount above zero');

/** POST /journal (journal:post): a manual journal on ordinary accounts, with the reason it was made (RC-093). */
export const postJournal = defineContract({
  method: 'POST', path: '/journal', auth: 'session', perm: 'journal:post', tx: write,
  input: z.object({ businessDate: dateString(), reason: reason(), lines: z.array(manualLine).min(2, 'Enter two lines or more').max(200) }),
  output: z.object({ id: idString(), number: z.string() }),
  errors: ['control_account', 'unbalanced', 'invalid_line', 'unknown_account', 'account_inactive', 'period_locked',
    'year_not_open'],
});

/** POST /journal/:id/reverse (journal:reverse): a manual journal's lines swapped, dated `businessDate`, with the reason.
 * A document's entry is reversed by cancelling the document, never here (ADR-006 §3): reverse_through_document. */
export const reverseJournal = defineContract({
  method: 'POST', path: '/journal/:id/reverse', auth: 'session', perm: 'journal:reverse', tx: write,
  input: z.object({ id: idString(), businessDate: dateString(), reason: reason() }),
  output: z.object({ id: idString(), number: z.string() }),
  errors: ['reverse_through_document', 'already_reversed', 'reversal_not_reversible', 'period_locked', 'year_not_open'],
});

// Receipts, payments and refunds (M3-12, RAD-116; ADR-007 §1–§5, §8). Recording and cancelling move money, so
// payments:write needs the second factor (D-19); cash past a day's limit waits for payments:approve.

/** A refund of a credit, checked by the database when it posts, each rule by name (RAD-114, the architect's build rules). */
const CREDIT_REFUND_DB_ERRORS = {
  'RA006:refund_credit_not_posted': { code: 'credit_not_posted', message: 'Refund a credit note only once it’s posted' },
  'RA006:refund_credit_party_mismatch': { code: 'refund_other_party', message: 'A refund goes back to the credit note’s party' },
  'RA006:refund_credit_before_source': { code: 'date_before_source', message: 'A refund is dated on or after its credit note' },
  'RA006:refund_credit_side_mismatch': { code: 'wrong_credit', message: 'A refund pays a customer back against a credit note' },
  'RA006:refund_exceeds_credit': { code: 'exceeds_credit', message: 'That’s more than is left of the credit note' },
  'RA006:allocatable_document_missing': { code: 'wrong_credit', message: 'There’s no such credit note' },
  '23503:fk_payments_credit_table': { code: 'wrong_credit', message: 'Refunds aren’t made against that kind of document' },
} as const;
const CREDIT_REFUND_ERRORS = ['credit_not_posted', 'wrong_credit', 'exceeds_credit'] as const;

/** POST /payments: a receipt (money in, Cr Debtors), payment (out, Dr Creditors) or refund (back to a customer,
 * against the receipt or the credit note it names). `amount` is the party's, gross of any TDS held back (F8). Posted
 * now, numbered RV or PV, or held as a draft for an owner when cash passes the day's limit (`pending_approval`). */
export const recordPaymentContract = defineContract({
  method: 'POST', path: '/payments', auth: 'session', perm: 'payments:write', tx: write,
  input: z.object({
    kind: z.enum(['receipt', 'payment', 'refund']), partyId: idString(), businessDate: dateString(), amount: moneyString(),
    tds: moneyString().optional(), accountId: idString(), refundOf: idString().optional(),
    credit: z.object({ table: z.string().regex(/^[a-z][a-z0-9_]*$/, 'Not a document table'), id: idString() }).optional(),
    narration: z.string().trim().min(1).max(500).optional(),
    // The money's own trail (RAD-115): a card machine's approval code, a UPI UTR, a cheque number.
    reference: z.string().trim().min(1).max(40).optional(),
  }),
  output: z.object({ id: idString(), status: z.enum(['posted', 'pending_approval']), number: z.string().nullable() }),
  errors: ['amount_not_positive', 'invalid_tds', 'date_in_future', 'year_not_open', 'period_locked', 'refund_needs_receipt', 'receipt_not_posted',
    'refund_other_party', 'date_before_source', 'exceeds_receipt', 'unknown_account', 'not_money_account', 'account_inactive', 'not_draft',
    'refund_through_owner', 'series_full', 'looks_like_card_number', ...CREDIT_REFUND_ERRORS],
  dbErrors: CREDIT_REFUND_DB_ERRORS,
});

/** POST /payments/:id/cancel: cancels a posted payment by a mirror entry dated `businessDate`, with the reason. */
export const cancelPaymentContract = defineContract({
  method: 'POST', path: '/payments/:id/cancel', auth: 'session', perm: 'payments:write', tx: write,
  input: z.object({ id: idString(), businessDate: dateString(), reason: reason() }),
  output: z.object({}),
  errors: ['not_posted', 'date_before_source', 'date_in_future', 'has_refunds', 'has_allocations', 'period_locked', 'year_not_open',
    'already_reversed'],
  dbErrors: { 'RA006:payment_still_allocated': { code: 'has_allocations', message: 'Reverse what this is applied to first' } },
});

/** An owner's override for cash past the day's limit (ADR-007 §8, RC-114): its approval posts the payment, so the
 * decision can meet the engine's refusals. */
export const cashLimitApproval = approvalContracts('cash-limit', 'payments:approve',
  ['account_inactive', 'period_locked', 'year_not_open', 'not_draft', 'receipt_not_posted', 'exceeds_receipt', 'refund_other_party',
    'date_before_source', 'series_full', ...CREDIT_REFUND_ERRORS], CREDIT_REFUND_DB_ERRORS);

// Allocations and credit applications (M3-12, RAD-116 part 2; ADR-005 §7a). A document is named by its table, one
// `allocatable_documents` lists, and its id. The rules the database checks at commit answer by name (dbErrors, §9).
const documentTable = () => z.string().regex(/^[a-z][a-z0-9_]*$/, 'Not a document table');
const ALLOCATION_DB_ERRORS = {
  'RA006:allocation_exceeds_document': { code: 'exceeds_document', message: 'That’s more than is left to pay on it' },
  'RA006:allocation_exceeds_payment': { code: 'exceeds_payment', message: 'That’s more than is left of the payment' },
  'RA006:allocation_party_mismatch': { code: 'party_mismatch', message: 'A payment applies to its own party’s documents' },
  'RA006:allocation_side_mismatch': { code: 'side_mismatch', message: 'A receipt pays a customer’s bill, and a payment a supplier’s' },
  'RA006:allocation_document_not_posted': { code: 'document_not_posted', message: 'A payment applies only to a posted document' },
  'RA006:allocatable_document_missing': { code: 'document_missing', message: 'There’s no such document' },
  '23503:fk_payment_allocations_document_table': { code: 'not_allocatable', message: 'Payments aren’t applied to that kind of document' },
  'RA006:allocation_before_source': { code: 'date_before_source', message: 'An allocation is dated on or after its document' },
} as const;
const CREDIT_DB_ERRORS = {
  'RA006:credit_application_exceeds_document': { code: 'exceeds_document', message: 'That’s more than is left to pay on it' },
  'RA006:credit_application_exceeds_credit': { code: 'exceeds_credit', message: 'That’s more than is left of the credit' },
  'RA006:credit_application_party_mismatch': { code: 'party_mismatch', message: 'A credit applies to its own party’s documents' },
  'RA006:credit_application_side_mismatch': { code: 'side_mismatch', message: 'A credit applies to a charge on its own side' },
  'RA006:credit_application_document_not_posted': { code: 'document_not_posted', message: 'Both the credit and the charge must be posted' },
  'RA006:allocatable_document_missing': { code: 'document_missing', message: 'There’s no such document' },
  '23503:fk_credit_applications_credit_table': { code: 'not_allocatable', message: 'That kind of document isn’t a credit' },
  '23503:fk_credit_applications_document_table': { code: 'not_allocatable', message: 'Credits aren’t applied to that kind of document' },
  'RA006:credit_application_before_source': { code: 'date_before_source', message: 'A credit is applied on or after both documents’ dates' },
} as const;

/** POST /payments/:id/allocations: applies a posted receipt (to customers' charges) or payment (to suppliers') to
 * documents, within what's left of each, gross of TDS held back (F8). */
export const allocatePaymentContract = defineContract({
  method: 'POST', path: '/payments/:id/allocations', auth: 'session', perm: 'payments:write', tx: write,
  input: z.object({ id: idString(), businessDate: dateString(), lines: z.array(z.object({ documentTable: documentTable(), documentId: idString(), amount: moneyString() }))
    .min(1, 'Apply it to one document or more').max(50) }),
  output: z.object({ ids: z.array(idString()) }),
  errors: ['not_allocatable', 'not_posted', 'exceeds_payment', 'exceeds_document', 'party_mismatch', 'side_mismatch', 'document_not_posted',
    'document_missing', 'date_in_future', 'date_before_source', 'period_locked', 'year_not_open'],
  dbErrors: ALLOCATION_DB_ERRORS,
});

/** POST /allocations/:id/reverse: undoes one allocation, whole, once, dated and with a reason (the architect on RAD-116). */
export const reverseAllocationContract = defineContract({
  method: 'POST', path: '/allocations/:id/reverse', auth: 'session', perm: 'payments:write', tx: write,
  input: z.object({ id: idString(), businessDate: dateString(), reason: reason() }), output: z.object({ id: idString() }),
  errors: ['already_reversed', 'date_in_future', 'date_before_source', 'period_locked', 'year_not_open'],
  dbErrors: { '23505:ux_payment_allocations_reverses': { code: 'already_reversed', message: 'That allocation is already reversed' } },
});

/** POST /credit-applications: applies a posted credit (a credit note) to a posted charge on its side, of its party. */
export const applyCreditContract = defineContract({
  method: 'POST', path: '/credit-applications', auth: 'session', perm: 'payments:write', tx: write,
  input: z.object({ creditTable: documentTable(), creditId: idString(), documentTable: documentTable(), documentId: idString(),
    amount: moneyString(), businessDate: dateString() }),
  output: z.object({ id: idString() }),
  errors: ['not_allocatable', 'exceeds_credit', 'exceeds_document', 'party_mismatch', 'side_mismatch', 'document_not_posted', 'document_missing',
    'date_in_future', 'date_before_source', 'period_locked', 'year_not_open'],
  dbErrors: CREDIT_DB_ERRORS,
});

/** POST /credit-applications/:id/reverse: undoes one credit application, whole, once, dated and with a reason. */
export const reverseCreditApplicationContract = defineContract({
  method: 'POST', path: '/credit-applications/:id/reverse', auth: 'session', perm: 'payments:write', tx: write,
  input: z.object({ id: idString(), businessDate: dateString(), reason: reason() }), output: z.object({ id: idString() }),
  errors: ['already_reversed', 'date_in_future', 'date_before_source', 'period_locked', 'year_not_open'],
  dbErrors: { '23505:ux_credit_applications_reverses': { code: 'already_reversed', message: 'That credit application is already reversed' } },
});

export * from './contract-collect.ts';
export * from './contract-payments.ts';
export * from './contract-period.ts';
export * from './contract-expenses.ts';
export * from './contract-transfers.ts';
