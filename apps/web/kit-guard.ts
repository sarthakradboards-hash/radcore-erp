// The UI kit gallery (app/kit) is for browser tests only. A web server outside development and CI refuses to start
// with KIT_PAGE set (instrumentation.ts), as the api refuses the owner's credentials there (ADR-004 §3).
const TEST_ENVS = ['development', 'ci'];

export function kitPageProblem(env: Readonly<Record<string, string | undefined>>): string | null {
  if (env['KIT_PAGE'] === undefined || env['KIT_PAGE'] === '') return null;
  // An APP_ENV that is missing or unknown counts as deployed, the strictest reading (as lib-platform's config does).
  const appEnv = env['APP_ENV'] ?? '';
  if (TEST_ENVS.includes(appEnv)) return null;
  return `KIT_PAGE must not be set when APP_ENV is ${appEnv === '' ? 'not set' : appEnv} (the UI kit page is for tests only)`;
}

/** Called once at start-up. A throw only makes Next answer 500 while it keeps running, so a refused start ends the
 * process, as the api's does. */
export function refuseKitPageWhenDeployed(): void {
  const problem = kitPageProblem(process.env);
  if (problem === null) return;
  console.error(problem);
  process.exit(1);
}
