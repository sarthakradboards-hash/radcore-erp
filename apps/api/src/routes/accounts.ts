// lib-accounts' routes (ADR-001 §6): declarations only. The company profile (RAD-88), parties (RAD-90), and the chart
// of accounts and journal (RAD-86).
import {
  addParty, cancelPayment, cashLimitSpec, changeAccount, changeParty, chartOfAccounts, recordPayment, getCompanyProfile, getPartyById, journalEntryById, journalPage, listPartiesPage, postManual,
  reverseJournalEntry, setCompanyProfile, setCreditTerms,
} from '@radcore/lib-accounts';
import {
  cancelPaymentContract, cashLimitApproval, createParty, getCompany, recordPaymentContract, getJournal, getParty, listAccounts, listJournal, listParties, postJournal, reverseJournal, setAccount,
  setCompany, setPartyCredit, updateParty,
} from '@radcore/lib-accounts/contract';
import { defineApproval, defineRoute } from '@radcore/lib-platform';

export default [
  defineRoute(getCompany, getCompanyProfile),
  defineRoute(setCompany, setCompanyProfile),
  defineRoute(listParties, listPartiesPage),
  defineRoute(getParty, getPartyById),
  defineRoute(createParty, addParty),
  defineRoute(updateParty, changeParty),
  defineRoute(setPartyCredit, setCreditTerms),
  defineRoute(listAccounts, chartOfAccounts),
  defineRoute(recordPaymentContract, recordPayment),
  defineRoute(cancelPaymentContract, cancelPayment),
  ...defineApproval(cashLimitApproval, cashLimitSpec),
  defineRoute(setAccount, changeAccount),
  defineRoute(listJournal, journalPage),
  defineRoute(getJournal, journalEntryById),
  defineRoute(postJournal, postManual),
  defineRoute(reverseJournal, reverseJournalEntry),
];
