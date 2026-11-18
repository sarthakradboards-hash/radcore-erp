// lib-accounts' routes (ADR-001 §6): declarations only. The company profile (RAD-88), parties (RAD-90), and the chart
// of accounts and journal (RAD-86).
import {
  addParty, changeParty, chartOfAccounts, getCompanyProfile, getPartyById, journalEntryById, journalPage, listPartiesPage, postManual,
  reverseJournalEntry, setCompanyProfile, setCreditTerms,
} from '@radcore/lib-accounts';
import {
  createParty, getCompany, getJournal, getParty, listAccounts, listJournal, listParties, postJournal, reverseJournal, setCompany,
  setPartyCredit, updateParty,
} from '@radcore/lib-accounts/contract';
import { defineRoute } from '@radcore/lib-platform';

export default [
  defineRoute(getCompany, getCompanyProfile),
  defineRoute(setCompany, setCompanyProfile),
  defineRoute(listParties, listPartiesPage),
  defineRoute(getParty, getPartyById),
  defineRoute(createParty, addParty),
  defineRoute(updateParty, changeParty),
  defineRoute(setPartyCredit, setCreditTerms),
  defineRoute(listAccounts, chartOfAccounts),
  defineRoute(listJournal, journalPage),
  defineRoute(getJournal, journalEntryById),
  defineRoute(postJournal, postManual),
  defineRoute(reverseJournal, reverseJournalEntry),
];
