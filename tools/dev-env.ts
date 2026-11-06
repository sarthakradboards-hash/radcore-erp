// Writes the local .env with fresh random passwords for compose.dev.yml (RC-198). Never overwrites an existing one.
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';

const secret = () => randomBytes(32).toString('base64url');

export function writeDevEnv(file = '.env'): boolean {
  if (existsSync(file)) return false;
  const pg = secret();
  const lines = [
    `POSTGRES_PASSWORD=${pg}`,
    `MINIO_ROOT_PASSWORD=${secret()}`,
    `DATABASE_URL=postgres://radcore:${pg}@127.0.0.1:5432/radcore`,
  ];
  writeFileSync(file, `${lines.join('\n')}\n`, { mode: 0o600, flag: 'wx' });
  return true;
}

if (import.meta.main) console.log(writeDevEnv() ? 'wrote .env with new passwords' : '.env exists, kept it');
