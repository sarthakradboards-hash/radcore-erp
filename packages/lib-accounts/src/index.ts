// lib-accounts' entry (ADR-001 §2): its services, for the api's route file and for other libraries.
export {
  changeAccount, chartOfAccounts, journalEntryById, journalPage, postManual, reverseJournalEntry, stockInHand, trialBalance,
} from './services/books.ts';
export { companyForInvoice, getCompanyProfile, setCompanyProfile } from './services/company.ts';
export {
  holdPeriod, JOURNAL_SERIES, openFinancialYear, postEntry, postManualJournal, reverseEntry,
  type AccountRef, type JournalLine, type NewEntry, type Posted,
} from './services/journal.ts';
export {
  cancelPayment, CASH_PAYMENT_LIMIT, CASH_RECEIPT_LIMIT, cashLimitSpec, DEFAULT_CREDIT_DAYS, heldLeft, PAYMENT_SERIES, RECEIPT_SERIES, recordHeldReceipt, recordPayment, refundHeld,
  type HeldFor,
} from './services/payments.ts';
export { partyReceivable } from './services/receivables.ts';
export {
  allocatePayment, applyCredit, paidOf, reverseAllocation, reverseCreditApplication,
} from './services/allocations.ts';
export type { Receivable } from './rules/receivable.ts';
export { addParty, changeParty, getPartyById, listPartiesPage, setCreditTerms } from './services/parties.ts';
