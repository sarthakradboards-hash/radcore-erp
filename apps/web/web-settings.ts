// The web app's own settings, checked once as the server starts (instrumentation.ts), as the api checks its own
// (ADR-004 §5). A refused start ends the process: a throw there only makes Next answer 500 while it keeps running.
import { filesOrigin } from './files-origin.ts';

export function webSettingsProblem(env: Readonly<Record<string, string | undefined>>): string | null {
  return filesOrigin(env) === null
    ? "S3_FILES_ORIGIN must be the files bucket's origin alone, like https://radcore-files.s3.ap-south-1.amazonaws.com "
      + '(http:// only in development and CI)'
    : null;
}

export function refuseBadWebSettings(): void {
  const problem = webSettingsProblem(process.env);
  if (problem === null) return;
  console.error(problem);
  process.exit(1);
}
