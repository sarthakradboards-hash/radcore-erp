# Browser journeys (Playwright)

Real-browser tests of the whole app. Playwright starts the API, the worker and a production build of the web app
from this checkout, then drives Chromium against them. CI runs them on every PR that touches `apps/web`, `e2e`,
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
  Point it at a database used only for these tests, never the dev one. Nothing reads it yet; the M1 tickets add
  migrations and seeded users to it.
- `npx playwright test -c e2e --ui` opens the interactive runner. `npx playwright show-trace <trace.zip>` opens a
  trace from `e2e/test-results/` or from a CI run's `e2e-results` artifact.

## Add a journey

- **One file per user flow** of the application plan, numbered as the plan numbers them:
  `flow-01-walk-in.spec.ts`, `flow-02-…`. Auth and permission journeys are `auth-*.spec.ts`.
- Import `test`, `expect` and `expectAccessible` from `./fixtures.ts`, never from `@playwright/test`. Then every
  test fails on a console error, an uncaught error, or a request that fails or answers 4xx/5xx, without asking.
- Call `expectAccessible(page)` on each new screen the journey reaches. It fails on serious or critical WCAG 2.2
  A/AA issues (axe).
- Find elements the way a person does: `getByRole`, `getByLabel`, `getByText`. No CSS classes or test ids unless
  there is no accessible name to use, which is itself worth raising.
- `harness.spec.ts` proves the guards still fail when they should. Keep it passing.
