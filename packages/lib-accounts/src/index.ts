// lib-accounts' entry (ADR-001 §2): its services, for the api's route file and for other libraries.
export {
  changeAccount, chartOfAccounts, journalEntryById, journalPage, postManual, reverseJournalEntry, stockInHand, trialBalance,
} from './services/books.ts';
export { companyForInvoice, getCompanyProfile, setCompanyProfile } from './services/company.ts';
export {
  holdPeriod, JOURNAL_SERIES, openFinancialYear, postEntry, postManualJournal, reverseEntriesOf, reverseEntry,
  type AccountRef, type JournalLine, type NewEntry, type Posted,
} from './services/journal.ts';
export {
  cancelPayment, CASH_PAYMENT_LIMIT, CASH_RECEIPT_LIMIT, cashLimitSpec, DEFAULT_CREDIT_DAYS, heldLeft, PAYMENT_SERIES, RECEIPT_SERIES, recordHeldReceipt, recordPayment, refundCredit, refundHeld,
  type HeldFor,
} from './services/payments.ts';
export { partyReceivable } from './services/receivables.ts';
export { partyStatement, toCollectPage } from './services/collect.ts';
export { remind, remindersPage } from './services/reminders.ts';
export {
  allocatePayment, applyCredit, paidOf, reverseAllocation, reverseCreditApplication,
} from './services/allocations.ts';
export type { Receivable } from './rules/receivable.ts';
export { addParty, changeParty, getPartyById, holdParty, listPartiesPage, setCreditTerms } from './services/parties.ts';

// This library's settings and number series, for apps/api's catalogue (RAD-132, ADR-001 §8c).
import type { Series, SettingDef } from '@radcore/lib-platform';
import { JOURNAL_SERIES as journal } from './services/journal.ts';
import { CASH_PAYMENT_LIMIT as cashOut, CASH_RECEIPT_LIMIT as cashIn, DEFAULT_CREDIT_DAYS as creditDays, PAYMENT_SERIES as paid,
  RECEIPT_SERIES as received } from './services/payments.ts';
export const settings: readonly SettingDef<unknown>[] = [cashIn, cashOut, creditDays];
export const series: readonly Series[] = [journal, received, paid];
