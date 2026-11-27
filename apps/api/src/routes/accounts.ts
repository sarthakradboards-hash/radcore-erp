// lib-accounts' routes (ADR-001 §6): declarations only. The company profile (RAD-88), parties (RAD-90), and the chart
// of accounts and journal (RAD-86), what parties owe (RAD-119), and the period lock and year close (RAD-157).
import {
  addParty, allocatePayment, applyCredit, cancelPayment, getPaymentById, listPaymentsPage, reverseAllocation, reverseCreditApplication, cashLimitSpec, changeAccount, changeParty, chartOfAccounts, recordPayment, getCompanyProfile, getPartyById, journalEntryById, journalPage, listPartiesPage, postManual,
  addAccount, addExpenseCategory, changeExpenseCategory, expenseCategoriesList, partyStatement, remindersPage, reverseJournalEntry, setCompanyProfile, setCreditTerms, toCollectPage, listMoneyAccountsNow,
  askToUnlock, moveLockForward, periodState, periodUnlockSpec,
} from '@radcore/lib-accounts';
import {
  allocatePaymentContract, applyCreditContract, cancelPaymentContract, cashLimitApproval, getPaymentContract, listPaymentsContract, reverseAllocationContract,
  reverseCreditApplicationContract, createParty, getCompany, recordPaymentContract, getJournal, getParty, listAccounts, listMoneyAccounts, listJournal, listParties, postJournal, reverseJournal, setAccount,
  createAccount, createExpenseCategory, listExpenseCategories, setExpenseCategory, getPartyStatement, listReminders, listToCollect, recordReminder, setCompany, setPartyCredit, updateParty,
  askUnlockContract, closeYearContract, getPeriodContract, lockPeriodContract, periodUnlockApproval,
} from '@radcore/lib-accounts/contract';
import { defineApproval, defineRoute } from '@radcore/lib-platform';
import { remindWithLink } from '@radcore/lib-sales';
import { closeYearChecked } from '@radcore/lib-service';

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
  defineRoute(createAccount, addAccount),
  defineRoute(setAccount, changeAccount),
  defineRoute(listExpenseCategories, expenseCategoriesList),
  defineRoute(createExpenseCategory, addExpenseCategory),
  defineRoute(setExpenseCategory, changeExpenseCategory),
  defineRoute(listJournal, journalPage),
  defineRoute(getJournal, journalEntryById),
  defineRoute(postJournal, postManual),
  defineRoute(reverseJournal, reverseJournalEntry),
  // The period lock and year close (RAD-157): the close runs lib-service's books check as at the year's 31 March.
  defineRoute(getPeriodContract, periodState),
  defineRoute(lockPeriodContract, moveLockForward),
  defineRoute(askUnlockContract, askToUnlock),
  ...defineApproval(periodUnlockApproval, periodUnlockSpec),
  defineRoute(closeYearContract, closeYearChecked),
];
