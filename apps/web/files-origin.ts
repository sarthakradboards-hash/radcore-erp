// The files bucket's origin the web CSP allows (RAD-43). Kept apart from web-settings.ts, which ends the process on a
// bad setting, so proxy.ts (the middleware) imports nothing with process.exit.
const TEST_ENVS = ['development', 'ci'];

/**
 * The files bucket's origin as the browser sees it (ADR-004 §2): the page uploads there with a presigned POST and
 * shows previews from there, so the CSP allows exactly this one origin. null when it isn't a bare origin: no path,
 * no trailing slash, no wildcard, and https:// outside development and CI.
 */
export function filesOrigin(env: Readonly<Record<string, string | undefined>>): string | null {
  const value = env['S3_FILES_ORIGIN'] ?? '';
  if (value === '' || value.includes('*')) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  const scheme = url.protocol === 'https:' || (url.protocol === 'http:' && TEST_ENVS.includes(env['APP_ENV'] ?? ''));
  return scheme && url.origin === value ? url.origin : null;
}
