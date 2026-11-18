// lib-accounts' routes (ADR-001 §6): declarations only. The company profile (RAD-88).
import { getCompanyProfile, setCompanyProfile } from '@radcore/lib-accounts';
import { getCompany, setCompany } from '@radcore/lib-accounts/contract';
import { defineRoute } from '@radcore/lib-platform';

export default [defineRoute(getCompany, getCompanyProfile), defineRoute(setCompany, setCompanyProfile)];
