# Browser journeys (Playwright)

Real-browser tests of the whole app. Playwright starts the API, the worker and a production build of the web app
from this checkout, then drives Chromium against them. CI runs them on every PR that touches `apps`, `packages`, `e2e`,
the workflow or the dependencies (`.github/workflows/e2e.yml`).

## Run locally

```bash
npm ci
npx playwright install chromium   # once, and after a Playwright update
npm run e2e
```

- Ports are fixed: web on `127.0.0.1:3100`, API on `127.0.0.1:3101`. If either port is busy the run stops: it never
  tests a server it didn't start. To run beside another checkout's suite, pick other ports:
  `E2E_WEB_PORT=3110 E2E_API_PORT=3111 npm run e2e`.
- The servers get `DATABASE_URL` from `E2E_DATABASE_URL`, default `postgres://radcore@127.0.0.1:5432/radcore_e2e`.
  Point it at a database used only for these tests, never the dev one. The API's `/health` must reach it before the
  run starts (RAD-28), and it needs the migrations, since the worker runs pg-boss on its schema (RAD-44):
  `MIGRATION_DATABASE_URL=postgres://radcore@127.0.0.1:5432/radcore_e2e npm run db:migrate` after each pull.
- The API and worker check their settings at start. `npm run e2e` writes them to the root `.env` first
  (`npm run dev:env`, which keeps an existing `.env` and adds only missing settings). The servers run with
  `APP_ENV=ci`, since the e2e database URL has no password.
- Before the journeys, `global-setup.ts` seeds one person per built-in role and signs each one in (below). It writes
  to the same database as its superuser, from `E2E_SEED_DATABASE_URL`, default
  `postgres://radcore@127.0.0.1:5432/radcore_e2e`. Nothing else uses that login.
- `npx playwright test -c e2e --ui` opens the interactive runner. `npx playwright show-trace <trace.zip>` opens a
  trace from `e2e/test-results/` or from a CI run's `e2e-results` artifact.

## Add a journey

- **One file per user flow** of the application plan, numbered as the plan numbers them:
  `flow-01-walk-in.spec.ts`, `flow-02-…`. Auth and permission journeys are `auth-*.spec.ts`.
- Import `test`, `expect` and `expectAccessible` from `./fixtures.ts`, never from `@playwright/test`. Then every
  test fails on a console error, an uncaught error, a Content Security Policy violation, or a request that fails or
  answers 4xx/5xx, without asking. That covers every page of the test's browser context, popups and new tabs
  included. CSP violations are caught from the browser's `securitypolicyviolation` event, since Chromium never logs
  them to the console. A violation inside a web worker fires in the worker, not the page, so the guard doesn't see
  it: whoever adds the first worker extends the guard to it.
  Requests the browser aborts itself (Next cancels prefetches on navigation) don't count. A journey that expects
  a status says so: `test.use({ expectedStatuses: [401] })`.
- Call `expectAccessible(page)` on each new screen the journey reaches. It fails on serious or critical WCAG 2.2
  A/AA issues (axe).
- Find elements the way a person does: `getByRole`, `getByLabel`, `getByText`. No CSS classes or test ids unless
  there is no accessible name to use, which is itself worth raising.
- `harness.spec.ts` proves each guard still catches what it promises, for its own reason. Keep it passing.
- `kit.spec.ts` drives the UI kit gallery at `/kit` (forms, menu and dialogs, the table, the saved view, the picker),
  which the web server turns on with `KIT_PAGE=1`. It also runs in Firefox and WebKit: widgets are where engines
  differ. When the kit changes, change the gallery and this spec together. The `auth-*` journeys run in WebKit too.
- Specs run code in the browser through `page.evaluate`, so `e2e/` has its own `tsconfig.json` with the DOM's types.

## People and signing in (RAD-58)

- **One person per built-in role.** `global-setup.ts` seeds them as `<role>@e2e.test`, with a password that's new
  each run (`password()` in `people.ts`). It signs each one in through the API, enrolling the authenticator where the
  role needs one (D-19). A journey that starts signed in as a role uses
  `test.use({ storageState: stateFor('sales') })`.
- **A journey that changes someone** seeds its own person: `await seedPerson('admin')` gives a fresh address with
  no authenticator yet. Enrolling, locking out or revoking then can't touch another test, engine or rerun.
- **Signing in is never faked.**
  - `sign-in-steps.ts` signs in through the screen: the sign-in page, or the signed-out dialog.
  - `apiSignIn` signs in through the API, the way the screen does.
  - Both answer the authenticator with the code the person's phone would show (`codeFor`). The API accepts each
    30-second step once, so `codeFor` waits for a fresh step when needed; a journey that signs the same person in
    more than once needs room in its timeout for that.
- **Rate limits are per address**, and every test comes from 127.0.0.1. Sign-in allows 100 a minute, so the auth
  journeys run in Chromium and WebKit, not Firefox. Before adding sign-ins, count them.
- The run's password, authenticator secrets and signed-in states live in `e2e/.auth/`, which git ignores.
