// `npm run dev -w @radcore/web`: next dev with the settings web reads taken from the repo's root .env, as the api and
// worker load it. Only those keys (auditor on #88): the root .env also holds database URLs, the secrets key and S3
// keys, which web must never quietly rely on in development and then lack when deployed. Not
// `node --env-file-if-exists`, which next dev passes on in NODE_OPTIONS, where Node refuses it. Development only; a
// built image never reads a .env.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parseEnv } from 'node:util';

/** What web reads (ADR-004 §5's web column, plus APP_ENV). */
export const WEB_KEYS = ['APP_ENV', 'API_INTERNAL_URL', 'PUBLIC_ORIGIN', 'TURNSTILE_SITE_KEY', 'S3_FILES_ORIGIN'] as const;

/** The web keys from a .env's text; a value already in the environment wins, as with Node's own --env-file. */
export function webSettings(text: string, current: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const parsed = parseEnv(text);
  const out: Record<string, string> = {};
  for (const key of WEB_KEYS) {
    const value = current[key] ?? parsed[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

if (import.meta.main) {
  const env = new URL('../../../.env', import.meta.url);
  if (existsSync(env)) Object.assign(process.env, webSettings(readFileSync(env, 'utf8'), process.env));
  const next = createRequire(import.meta.url).resolve('next/dist/bin/next');
  spawn(process.execPath, [next, 'dev', '--hostname', '127.0.0.1', '--port', '3000'], { stdio: 'inherit' })
    .on('exit', (code) => process.exit(code ?? 1));
}
