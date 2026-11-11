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
  which the web server turns on with `KIT_PAGE=1`. It is the one spec that also runs in Firefox and WebKit: widgets
  are where engines differ. When the kit changes, change the gallery and this spec together.
- Specs run code in the browser through `page.evaluate`, so `e2e/` has its own `tsconfig.json` with the DOM's types.
