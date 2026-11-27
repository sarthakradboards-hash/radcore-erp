// lib-accounts' routes (ADR-001 §6): declarations only. The company profile (RAD-88), parties (RAD-90), and the chart
// of accounts and journal (RAD-86), and what parties owe (RAD-119).
import {
  addParty, allocatePayment, applyCredit, cancelPayment, getPaymentById, listPaymentsPage, reverseAllocation, reverseCreditApplication, cashLimitSpec, changeAccount, changeParty, chartOfAccounts, recordPayment, getCompanyProfile, getPartyById, journalEntryById, journalPage, listPartiesPage, postManual,
  partyStatement, remindersPage, reverseJournalEntry, setCompanyProfile, setCreditTerms, toCollectPage, listMoneyAccountsNow,
  importStatement, statementFormatOf, statementImportById, statementLinesPage, undoStatementImport,
} from '@radcore/lib-accounts';
import {
  allocatePaymentContract, applyCreditContract, cancelPaymentContract, cashLimitApproval, getPaymentContract, listPaymentsContract, reverseAllocationContract,
  reverseCreditApplicationContract, createParty, getCompany, recordPaymentContract, getJournal, getParty, listAccounts, listMoneyAccounts, listJournal, listParties, postJournal, reverseJournal, setAccount,
  getPartyStatement, listReminders, listToCollect, recordReminder, setCompany, setPartyCredit, updateParty,
  getStatementFormatContract, getStatementImportContract, importStatementContract, listStatementLinesContract, undoStatementImportContract,
} from '@radcore/lib-accounts/contract';
import { defineApproval, defineRoute } from '@radcore/lib-platform';
import { remindWithLink } from '@radcore/lib-sales';

export default [
  defineRoute(getCompany, getCompanyProfile),
  defineRoute(setCompany, setCompanyProfile),
  defineRoute(listParties, listPartiesPage),
  defineRoute(getParty, getPartyById),
  defineRoute(getPartyStatement, partyStatement),
  defineRoute(listToCollect, toCollectPage),
  // lib-accounts' contract, served by lib-sales: the reminder's invoice link is lib-sales' (RAD-119).
  defineRoute(recordReminder, remindWithLink),
  defineRoute(listReminders, remindersPage),
  defineRoute(createParty, addParty),
  defineRoute(updateParty, changeParty),
  defineRoute(setPartyCredit, setCreditTerms),
  defineRoute(listAccounts, chartOfAccounts),
  defineRoute(listMoneyAccounts, listMoneyAccountsNow),
  defineRoute(listPaymentsContract, listPaymentsPage),
  defineRoute(getPaymentContract, getPaymentById),
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
  // Bank statements (RAD-159): the import is queued here and done by the worker.
  defineRoute(getStatementFormatContract, statementFormatOf),
  defineRoute(importStatementContract, importStatement),
  defineRoute(getStatementImportContract, statementImportById),
  defineRoute(undoStatementImportContract, undoStatementImport),
  defineRoute(listStatementLinesContract, statementLinesPage),
];
