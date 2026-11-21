// lib-accounts' routes (ADR-001 §6): declarations only. The company profile (RAD-88), parties (RAD-90), and the chart
// of accounts and journal (RAD-86), and what parties owe (RAD-119).
import {
  addParty, allocatePayment, applyCredit, cancelPayment, reverseAllocation, reverseCreditApplication, cashLimitSpec, changeAccount, changeParty, chartOfAccounts, recordPayment, getCompanyProfile, getPartyById, journalEntryById, journalPage, listPartiesPage, postManual,
  partyStatement, remind, remindersPage, reverseJournalEntry, setCompanyProfile, setCreditTerms, toCollectPage,
} from '@radcore/lib-accounts';
import {
  allocatePaymentContract, applyCreditContract, cancelPaymentContract, cashLimitApproval, reverseAllocationContract,
  reverseCreditApplicationContract, createParty, getCompany, recordPaymentContract, getJournal, getParty, listAccounts, listJournal, listParties, postJournal, reverseJournal, setAccount,
  getPartyStatement, listReminders, listToCollect, recordReminder, setCompany, setPartyCredit, updateParty,
} from '@radcore/lib-accounts/contract';
import { defineApproval, defineRoute } from '@radcore/lib-platform';

export default [
  defineRoute(getCompany, getCompanyProfile),
  defineRoute(setCompany, setCompanyProfile),
  defineRoute(listParties, listPartiesPage),
  defineRoute(getParty, getPartyById),
  defineRoute(getPartyStatement, partyStatement),
  defineRoute(listToCollect, toCollectPage),
  defineRoute(recordReminder, remind),
  defineRoute(listReminders, remindersPage),
  defineRoute(createParty, addParty),
  defineRoute(updateParty, changeParty),
  defineRoute(setPartyCredit, setCreditTerms),
  defineRoute(listAccounts, chartOfAccounts),
  defineRoute(recordPaymentContract, recordPayment),
  defineRoute(cancelPaymentContract, cancelPayment),
  defineRoute(allocatePaymentContract, allocatePayment),
  defineRoute(reverseAllocationContract, reverseAllocation),
  defineRoute(applyCreditContract, applyCredit),
  defineRoute(reverseCreditApplicationContract, reverseCreditApplication),
  ...defineApproval(cashLimitApproval, cashLimitSpec),
  defineRoute(setAccount, changeAccount),
  defineRoute(listJournal, journalPage),
  defineRoute(getJournal, journalEntryById),
  defineRoute(postJournal, postManual),
  defineRoute(reverseJournal, reverseJournalEntry),
];
