// lib-accounts' entry (ADR-001 §2): its services, for the api's route file and for other libraries.
export {
  changeAccount, chartOfAccounts, journalEntryById, journalPage, postManual, reverseJournalEntry, stockInHand, trialBalance,
} from './services/books.ts';
export { companyForInvoice, getCompanyProfile, setCompanyProfile } from './services/company.ts';
export {
  holdPeriod, JOURNAL_SERIES, lockPeriod, openFinancialYear, postEntry, postManualJournal, reverseEntriesOf, reverseEntry,
  type AccountRef, type JournalLine, type NewEntry, type Posted,
} from './services/journal.ts';
export {
  cancelPayment, CASH_PAYMENT_LIMIT, CASH_RECEIPT_LIMIT, cashLimitSpec, DEFAULT_CREDIT_DAYS, heldLeft, moneyAccountRefusal, PAYMENT_SERIES, RECEIPT_SERIES,
  recordCounterReceipt, recordHeldReceipt, recordPayment, refundCredit, refundHeld, systemAccountId,
  type HeldFor,
} from './services/payments.ts';
export { partyReceivable } from './services/receivables.ts';
export { listMoneyAccountsNow } from './services/money-accounts.ts';
// A receipt for its printout (RAD-120): lib-sales' template prints it.
export { receiptForPrint, type ReceiptForPrint } from './services/receipts.ts';
export { partyStatement, toCollectPage } from './services/collect.ts';
export { remind, remindersPage, type ReminderLink, type ReminderLinkFor } from './services/reminders.ts';
export {
  allocatePayment, applyCredit, creditApplicationsOf, paidOf, reverseAllocation, reverseCreditApplication,
} from './services/allocations.ts';
export type { Receivable } from './rules/receivable.ts';
export {
  addParty, changeParty, getPartyById, holdParty, listPartiesPage, partyNames, partyWithPhone, setCreditTerms, systemPartyId,
} from './services/parties.ts';

// The kinds a sale may name, for lib-sales' sellingTo and the parties list's sellsTo filter (RAD-131).
export { SELLS_TO_KINDS } from './contract.ts';

// This library's settings and number series, for apps/api's catalogue (RAD-132, ADR-001 §8c).
import type { Series, SettingDef } from '@radcore/lib-platform';
import { JOURNAL_SERIES as journal } from './services/journal.ts';
import { CASH_PAYMENT_LIMIT as cashOut, CASH_RECEIPT_LIMIT as cashIn, DEFAULT_CREDIT_DAYS as creditDays, PAYMENT_SERIES as paid,
  RECEIPT_SERIES as received } from './services/payments.ts';
export const settings: readonly SettingDef<unknown>[] = [cashIn, cashOut, creditDays];
export const series: readonly Series[] = [journal, received, paid];
