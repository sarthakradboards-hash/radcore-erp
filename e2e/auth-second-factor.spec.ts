// RAD-58: the authenticator for the roles that need it (D-19: admin and owner among them). The first sign-in enrols it
// and shows ten recovery codes once; after that each sign-in asks for its code, refuses a wrong one, and takes a
// recovery code once instead.
import { expect, expectAccessible, test } from './fixtures.ts';
import { codeFor, rememberSecret, seedPerson } from './people.ts';
import { submitPassword } from './sign-in-steps.ts';

test.use({ expectedStatuses: [401, 422] }); // refused codes, and the signed-out /me read
// Each sign-in needs a code from a step not used yet (the api takes each 30-second step once), so this waits for up to
// three fresh steps.
test.describe.configure({ timeout: 150_000 });

for (const role of ['owner', 'admin']) {
  test(`${role}: the first sign-in enrols the authenticator and shows ten recovery codes once; the next asks for the code`, async ({ page, browser }) => {
    const person = await seedPerson(role);
    await page.goto('/sign-in');
    const started = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/sign-in/second-factor/enrolment');
    await submitPassword(page, person.email);
    rememberSecret(person.email, ((await (await started).json()) as { otpauthUri: string }).otpauthUri);
    await expect(page.getByRole('img', { name: 'QR code to add RadCore to your authenticator app' })).toBeVisible();
    await expectAccessible(page);

    await page.getByLabel('Code from your authenticator app').fill('000000');
    await page.getByRole('button', { name: 'Turn on and continue' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /didn’t work/ })).toBeVisible();
    await page.getByLabel('Code from your authenticator app').fill(await codeFor(person.email));
    await page.getByRole('button', { name: 'Turn on and continue' }).click();

    const codes = page.locator('.recovery-codes li');
    await expect(codes).toHaveCount(10);
    const recovery = (await codes.allInnerTexts()).map((c) => c.trim());
    await page.getByRole('button', { name: 'I’ve saved them, continue' }).click();
    await expect(page.getByText(`Signed in as ${person.name}`)).toBeVisible({ timeout: 15_000 });

    // Another browser: the password alone isn't enough now; a wrong code is refused, the right one signs in.
    const other = await browser.newContext();
    try {
      const p2 = await other.newPage();
      await p2.goto('/sign-in');
      await submitPassword(p2, person.email);
      const code = p2.getByLabel('Code from your authenticator app');
      await expect(code).toBeVisible();
      await expect(p2.getByRole('img', { name: /QR code/ })).toHaveCount(0); // enrolled: no new QR code
      await code.fill('000000');
      await p2.getByRole('button', { name: 'Continue', exact: true }).click();
      await expect(p2.getByRole('alert').filter({ hasText: /didn’t work/ })).toBeVisible();
      await code.fill(await codeFor(person.email));
      await p2.getByRole('button', { name: 'Continue', exact: true }).click();
      await expect(p2.getByText(`Signed in as ${person.name}`)).toBeVisible({ timeout: 15_000 });
    } finally { await other.close(); }

    // A third: a recovery code instead of the app, once only.
    for (const attempt of ['first', 'again'] as const) {
      const ctx = await browser.newContext();
      try {
        const p3 = await ctx.newPage();
        await p3.goto('/sign-in');
        await submitPassword(p3, person.email);
        await p3.getByRole('button', { name: 'Use a recovery code instead' }).click();
        await p3.getByLabel('Recovery code').fill(recovery[0]!);
        await p3.getByRole('button', { name: 'Continue', exact: true }).click();
        if (attempt === 'first') await expect(p3.getByText(`Signed in as ${person.name}`)).toBeVisible({ timeout: 15_000 });
        else await expect(p3.getByRole('alert').filter({ hasText: /didn’t work/ })).toBeVisible();
      } finally { await ctx.close(); }
    }
  });
}
