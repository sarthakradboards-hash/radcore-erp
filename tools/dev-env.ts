// Writes the local .env with fresh random credentials for compose.dev.yml (RC-198). Never overwrites an existing one;
// settings added since it was written are appended, so its credentials (and the database volume's password) stay.
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const secret = () => randomBytes(32).toString('base64url');
// The shape of an AWS access key id: 20 upper-case letters and digits.
const accessKeyId = () => randomBytes(15).toString('base64url').toUpperCase().replace(/[^A-Z0-9]/g, '0').slice(0, 20);

// What the api and worker check at start (ADR-004 §5, RAD-28), with development values. 1x00…AA is Cloudflare's
// published Turnstile test site key, which always passes.
const settings = () => [
  'NODE_ENV=development', 'APP_ENV=development', 'PUBLIC_ORIGIN=http://127.0.0.1:3000', 'TRUST_PROXY=127.0.0.1',
  'DB_POOL_MAX=10', 'DB_POOL_WAIT_MS=5000', 'DB_STATEMENT_TIMEOUT_MS=15000', 'DB_LOCK_TIMEOUT_MS=5000',
  'DB_IDLE_TX_TIMEOUT_MS=10000', 'S3_BUCKET_FILES=radcore-files', `SECRETS_LOCAL_KEY=${secret()}`,
  'TURNSTILE_SITE_KEY=1x00000000000000000000AA', 'LOG_LEVEL=info',
  // Where web reaches the api (ADR-004 §5): the browser's /api through Next's dev rewrite, and the server's /me read.
  // The api's own dev port (API_PORT, default 3001).
  'API_INTERNAL_URL=http://127.0.0.1:3001',
  // The files bucket's origin as the browser sees it: SeaweedFS, path-style (RAD-43). web's CSP allows only this.
  'S3_FILES_ORIGIN=http://127.0.0.1:8333',
];

export function writeDevEnv(file = '.env'): boolean {
  if (existsSync(file)) {
    const text = readFileSync(file, 'utf8');
    const have = new Set(text.split(/\r?\n/).map((l) => l.split('=', 1)[0]));
    const missing = settings().filter((l) => !have.has(l.split('=', 1)[0]));
    if (missing.length > 0) appendFileSync(file, `${text === '' || text.endsWith('\n') ? '' : '\n'}${missing.join('\n')}\n`);
    return false;
  }
  const pg = secret();
  const [owner, app, read] = [secret(), secret(), secret()];
  const at = (login: string, password: string) => `postgres://${login}:${password}@127.0.0.1:5432/radcore`;
  const lines = [
    '# Local development only. DATABASE_ADMIN_URL is the compose superuser, used only by `npm run db:logins` (RAD-24).',
    '# The api and worker use the runtime login, and `npm run db:migrate` the owner login, as in production.',
    `POSTGRES_PASSWORD=${pg}`,
    `DATABASE_ADMIN_URL=${at('radcore', pg)}`,
    `RADCORE_OWNER_PASSWORD=${owner}`,
    `RADCORE_APP_PASSWORD=${app}`,
    `RADCORE_READ_PASSWORD=${read}`,
    `DATABASE_URL=${at('radcore_app', app)}`,
    `MIGRATION_DATABASE_URL=${at('radcore_owner', owner)}`,
    `DATABASE_READ_URL=${at('radcore_read', read)}`,
    `S3_ENDPOINT=http://127.0.0.1:8333`,
    `S3_REGION=us-east-1`,
    `S3_ACCESS_KEY_ID=${accessKeyId()}`,
    `S3_SECRET_ACCESS_KEY=${secret()}`,
    ...settings(),
  ];
  writeFileSync(file, `${lines.join('\n')}\n`, { mode: 0o600, flag: 'wx' });
  return true;
}

if (import.meta.main) console.log(writeDevEnv() ? 'wrote .env with new credentials' : '.env exists, kept it');
