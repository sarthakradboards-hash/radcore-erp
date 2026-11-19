// lib-accounts' entry (ADR-001 §2): its services, for the api's route file and for other libraries.
export {
  changeAccount, chartOfAccounts, journalEntryById, journalPage, postManual, reverseJournalEntry, stockInHand, trialBalance,
} from './services/books.ts';
export { companyForInvoice, getCompanyProfile, setCompanyProfile } from './services/company.ts';
export {
  holdPeriod, JOURNAL_SERIES, openFinancialYear, postEntry, postManualJournal, reverseEntry,
  type AccountRef, type JournalLine, type NewEntry, type Posted,
} from './services/journal.ts';
export { partyReceivable } from './services/receivables.ts';
export type { Receivable } from './rules/receivable.ts';
export { addParty, changeParty, getPartyById, listPartiesPage, setCreditTerms } from './services/parties.ts';
