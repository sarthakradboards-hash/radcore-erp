// `npm run secret:set -- <name>`: stores an integration's secret (RAD-107), such as crm.google_lead_key, replacing the
// old one. The value is read from stdin only, never an argument or an environment variable, so it reaches neither the
// shell history nor the process list. It's encrypted with the app's own keys (SECRETS_KMS_KEY_ID, or SECRETS_LOCAL_KEY
// in development) for its place, then written with the owner login (MIGRATION_DATABASE_URL), since the app login
// only reads the table. A stopgap until M7's integrations screen (the architect).
import { randomUUID } from 'node:crypto';
import { createSecrets, storeSecret, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import pg from 'pg';

const NAME = /^(platform|hr|gst|ops|accounts|crm|stock|payroll|purchasing|sales|service)\.[a-z][a-z0-9_]*$/;
const WHO: Principal = { kind: 'system', name: 'set-secret', permissions: [] };
const WRITE = { readOnly: false, isolation: 'read committed' } as const;

/** The whole of stdin, without its trailing newline. */
async function stdin(): Promise<string> {
  const parts: Buffer[] = [];
  for await (const part of process.stdin) parts.push(Buffer.from(part as Buffer));
  return Buffer.concat(parts).toString('utf8').replace(/\r?\n$/, '');
}

const name = process.argv[2] ?? '';
if (!NAME.test(name) || process.argv.length !== 3) throw new Error('usage: npm run secret:set -- <module>.<name>, with the value on stdin');
const url = process.env['MIGRATION_DATABASE_URL'];
if (!url) throw new Error('MIGRATION_DATABASE_URL is not set: secrets are written with the owner login');
const secrets = createSecrets({ kmsKeyId: process.env['SECRETS_KMS_KEY_ID'] ?? null, localKey: process.env['SECRETS_LOCAL_KEY'] ?? null });
const value = await stdin();
if (value === '') throw new Error('no value on stdin');
const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  const db = createDatabase(pool);
  await storeSecret((work) => runInTransaction(db, WRITE, WHO, randomUUID(), work), secrets, name, value);
  console.log(`${name} stored`);
} finally {
  await pool.end();
}
