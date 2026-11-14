// Before the journeys (RAD-58): a fresh password, then one person per built-in role, each signed in for real through
// the api (the authenticator enrolled where the role needs it) with their browser state saved. Playwright starts the
// web servers first, so the api is up. A journey signed in as a role uses `test.use({ storageState: stateFor(role) })`.
import type { FullConfig } from '@playwright/test';
import { apiSignIn, builtInRoles, newPassword, roleEmail, seedPerson, stateFor } from './people.ts';

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL;
  if (baseURL === undefined) throw new Error('playwright.config.ts gives no baseURL');
  newPassword();
  for (const { key, name } of await builtInRoles()) {
    await seedPerson(key, { email: roleEmail(key), name: `E2E ${name}` });
    const api = await apiSignIn(baseURL, roleEmail(key));
    await api.storageState({ path: stateFor(key) });
    await api.dispose();
  }
}
