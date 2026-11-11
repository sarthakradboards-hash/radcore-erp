// Browser journeys (RAD-15, ADR-003 §2): Playwright starts the API, the worker and a production build of the web app
// from this checkout, on fixed ports, against the e2e database. Run with `npm run e2e`; see e2e/README.md.
import { defineConfig, devices } from '@playwright/test';

// Fixed ports. The override is for running beside another checkout's suite on one machine; CI uses the defaults.
const WEB_PORT = Number(process.env['E2E_WEB_PORT'] ?? 3100);
const API_PORT = Number(process.env['E2E_API_PORT'] ?? 3101);
const CI = Boolean(process.env['CI']);
// The e2e database, never the dev one: tests will write to it once there are tables (M1).
const DATABASE_URL = process.env['E2E_DATABASE_URL'] ?? 'postgres://radcore_app@127.0.0.1:5432/radcore_e2e';
// The api and worker refuse to start without ADR-004 §5's settings (RAD-28). `npm run e2e` writes them to the root
// .env first (`npm run dev:env`), and both load it; these win over it. APP_ENV ci: the e2e database uses trust auth,
// so its URL has no password, which only CI may use.
// PUBLIC_ORIGIN is the e2e web app's, not dev's, so the origin check (M1-21) accepts e2e's writes.
const serverEnv = { DATABASE_URL, API_PORT: String(API_PORT), APP_ENV: 'ci', PUBLIC_ORIGIN: `http://127.0.0.1:${WEB_PORT}` };

export default defineConfig({
  testDir: '.',
  outputDir: 'test-results',
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  // Every spec runs in Chromium. The UI kit runs in Firefox and WebKit too (RAD-75): its widgets are where engines
  // differ. The harness self-checks stay Chromium-only; some check Chromium's own error texts.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, testMatch: /kit\.spec\.ts$/ },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, testMatch: /kit\.spec\.ts$/ },
  ],
  // Never reuse a server already on a port: it may be another checkout's code. A busy port fails the run instead.
  webServer: [
    {
      name: 'api',
      command: 'node --env-file=.env apps/api/src/main.ts',
      cwd: '..',
      env: serverEnv,
      url: `http://127.0.0.1:${API_PORT}/health`,
    },
    {
      name: 'worker',
      // It runs pg-boss, so the e2e database needs the migrations first (CI's db:migrate step; e2e/README.md).
      command: 'node --env-file=.env apps/worker/src/main.ts',
      cwd: '..',
      env: serverEnv,
      // No url to poll, so wait for the line startProcess logs only after the queue starts; a failed start fails the run.
      wait: { stdout: /worker: started/ },
    },
    {
      name: 'web',
      // A production build, as people will use it: no dev overlay or hot reload in the page.
      command: `npx next build && npx next start --hostname 127.0.0.1 --port ${WEB_PORT}`,
      cwd: '../apps/web',
      // The dev/ci /api rewrite (RAD-50, apps/web/next.config.ts) is fixed at `next build`, so the build needs these:
      // the browser's /api calls then reach the e2e API, as Caddy routes them when deployed (RAD-74).
      // KIT_PAGE turns on /kit, the UI kit gallery kit.spec.ts drives (RAD-75); kit-guard allows it only in dev and CI.
      env: { APP_ENV: 'ci', API_INTERNAL_URL: `http://127.0.0.1:${API_PORT}`, KIT_PAGE: '1' },
      url: `http://127.0.0.1:${WEB_PORT}`,
      timeout: 180_000,
    },
  ],
});
