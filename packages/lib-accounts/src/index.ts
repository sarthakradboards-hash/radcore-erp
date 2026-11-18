// lib-accounts' entry (ADR-001 §2): its services, for the api's route file and for other libraries.
export { changeAccount, chartOfAccounts, journalEntryById, journalPage, postManual, reverseJournalEntry } from './services/books.ts';
export { companyForInvoice, getCompanyProfile, setCompanyProfile } from './services/company.ts';
export {
  JOURNAL_SERIES, openFinancialYear, postEntry, postManualJournal, reverseEntry,
  type AccountRef, type JournalLine, type NewEntry, type Posted,
} from './services/journal.ts';
export { addParty, changeParty, getPartyById, listPartiesPage, setCreditTerms } from './services/parties.ts';
