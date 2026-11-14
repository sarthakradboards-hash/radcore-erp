// Signing in through the screen, as a person does (RAD-58): the sign-in page, or the signed-out dialog, which shows the
// same steps. The authenticator step is answered with the code the person's phone would show (people.ts).
import { expect, type Locator, type Page } from '@playwright/test';
import { codeFor, password, rememberSecret } from './people.ts';

/** Fills the password step in `scope` (the page, or the signed-out dialog) and submits it. */
export async function submitPassword(scope: Page | Locator, email: string, typed = password()): Promise<void> {
  await scope.getByLabel('Email address').fill(email);
  await scope.getByLabel('Password', { exact: true }).fill(typed);
  await scope.getByRole('button', { name: 'Sign in', exact: true }).click();
}

/**
 * Signs `email` in through `scope`, answering whatever second step the role needs: enrolling the authenticator the
 * first time (keeping its secret, as the phone would), or the code from it after that. `page` hears the api's answers.
 */
export async function signInThroughScreen(page: Page, scope: Page | Locator, email: string): Promise<void> {
  const enrolment = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/sign-in/second-factor/enrolment',
    { timeout: 10_000 }).catch(() => null);
  const answer = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/sign-in' && r.request().method() === 'POST');
  await submitPassword(scope, email);
  const next = ((await (await answer).json()) as { next?: string }).next;
  if (next === 'enrol_second_factor') {
    const started = await enrolment;
    if (started === null) throw new Error('enrolment never started');
    rememberSecret(email, ((await started.json()) as { otpauthUri: string }).otpauthUri);
    await scope.getByLabel('Code from your authenticator app').fill(await codeFor(email));
    await scope.getByRole('button', { name: 'Turn on and continue' }).click();
    await scope.getByRole('button', { name: 'I’ve saved them, continue' }).click();
  } else if (next === 'second_factor') {
    await scope.getByLabel('Code from your authenticator app').fill(await codeFor(email));
    await scope.getByRole('button', { name: 'Continue', exact: true }).click();
  }
  await expect(page.getByText(/^Signed in as /)).toBeVisible({ timeout: 15_000 });
}
