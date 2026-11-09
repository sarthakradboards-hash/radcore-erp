// Browser journeys (RAD-15, ADR-003 §2): Playwright starts the API, the worker and a production build of the web app
// from this checkout, on fixed ports, against the e2e database. Run with `npm run e2e`; see e2e/README.md.
import { defineConfig, devices } from '@playwright/test';

// Fixed ports. The override is for running beside another checkout's suite on one machine; CI uses the defaults.
const WEB_PORT = Number(process.env['E2E_WEB_PORT'] ?? 3100);
const API_PORT = Number(process.env['E2E_API_PORT'] ?? 3101);
const CI = Boolean(process.env['CI']);
// The e2e database, never the dev one: tests will write to it once there are tables (M1).
const DATABASE_URL = process.env['E2E_DATABASE_URL'] ?? 'postgres://radcore@127.0.0.1:5432/radcore_e2e';
// The api and worker refuse to start without ADR-004 §5's settings (RAD-28). `npm run e2e` writes them to the root
// .env first (`npm run dev:env`), and both load it; these win over it. APP_ENV ci: the e2e database uses trust auth,
// so its URL has no password, which only CI may use.
const serverEnv = { DATABASE_URL, API_PORT: String(API_PORT), APP_ENV: 'ci' };

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
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
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
      // shortcut: the placeholder worker exits at once, so --watch keeps it running; drop it when M1-26 adds the job loop.
      command: 'node --env-file=.env --watch apps/worker/src/main.ts',
      cwd: '..',
      env: serverEnv,
    },
    {
      name: 'web',
      // A production build, as people will use it: no dev overlay or hot reload in the page.
      command: `npx next build && npx next start --hostname 127.0.0.1 --port ${WEB_PORT}`,
      cwd: '../apps/web',
      url: `http://127.0.0.1:${WEB_PORT}`,
      timeout: 180_000,
    },
  ],
});
