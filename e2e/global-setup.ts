// Before the journeys (RAD-58): a fresh password, then one person per built-in role, each signed in for real through
// the api (the authenticator enrolled where the role needs it) with their browser state saved. Playwright starts the
// web servers first, so the api is up. A journey signed in as a role uses `test.use({ storageState: stateFor(role) })`.
import type { FullConfig } from '@playwright/test';
import { apiSignIn, BOOKS_ROLE, builtInRoles, newPassword, roleEmail, seedBooksChecker, seedCompany, seedPerson, stateFor } from './people.ts';

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL;
  if (baseURL === undefined) throw new Error('playwright.config.ts gives no baseURL');
  newPassword();
  await seedCompany(); // the company profile, as an invoice, a quote or an order needs it (RAD-112)
  for (const { key, name } of await builtInRoles()) {
    await seedPerson(key, { email: roleEmail(key), name: `E2E ${name}` });
    const api = await apiSignIn(baseURL, roleEmail(key));
    await api.storageState({ path: stateFor(key) });
    await api.dispose();
  }
  // The books check after each test (RAD-95, fixtures.ts) reads as its own person, who can only read the journal.
  await seedBooksChecker();
  const books = await apiSignIn(baseURL, roleEmail(BOOKS_ROLE));
  await books.storageState({ path: stateFor(BOOKS_ROLE) });
  await books.dispose();
}
