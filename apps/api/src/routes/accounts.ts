// lib-accounts' routes (ADR-001 §6): declarations only. The company profile (RAD-88) and parties (RAD-90).
import { addParty, changeParty, getCompanyProfile, getPartyById, listPartiesPage, setCompanyProfile, setCreditTerms } from '@radcore/lib-accounts';
import {
  createParty, getCompany, getParty, listParties, setCompany, setPartyCredit, updateParty,
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
];
