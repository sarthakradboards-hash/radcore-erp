// `npm run dev -w @radcore/web`: next dev with the repo's root .env loaded, as the api and worker load it (RAD-50:
// API_INTERNAL_URL, APP_ENV). Not `node --env-file-if-exists`, which next dev passes on in NODE_OPTIONS, where Node
// refuses it. Development only; a built image never reads a .env.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const env = new URL('../../../.env', import.meta.url);
if (existsSync(env)) process.loadEnvFile(env);

const next = createRequire(import.meta.url).resolve('next/dist/bin/next');
spawn(process.execPath, [next, 'dev', '--hostname', '127.0.0.1', '--port', '3000'], { stdio: 'inherit' })
  .on('exit', (code) => process.exit(code ?? 1));
