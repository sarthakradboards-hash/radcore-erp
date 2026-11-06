// Writes the local .env with fresh random credentials for compose.dev.yml (RC-198). Never overwrites an existing one.
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';

const secret = () => randomBytes(32).toString('base64url');
// The shape of an AWS access key id: 20 upper-case letters and digits.
const accessKeyId = () => randomBytes(15).toString('base64url').toUpperCase().replace(/[^A-Z0-9]/g, '0').slice(0, 20);

export function writeDevEnv(file = '.env'): boolean {
  if (existsSync(file)) return false;
  const pg = secret();
  const lines = [
    `POSTGRES_PASSWORD=${pg}`,
    `DATABASE_URL=postgres://radcore:${pg}@127.0.0.1:5432/radcore`,
    `S3_ENDPOINT=http://127.0.0.1:8333`,
    `S3_REGION=us-east-1`,
    `S3_ACCESS_KEY_ID=${accessKeyId()}`,
    `S3_SECRET_ACCESS_KEY=${secret()}`,
  ];
  writeFileSync(file, `${lines.join('\n')}\n`, { mode: 0o600, flag: 'wx' });
  return true;
}

if (import.meta.main) console.log(writeDevEnv() ? 'wrote .env with new credentials' : '.env exists, kept it');
