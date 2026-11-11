// RAD-65 (RC-213) on PostgreSQL 16: a secret stored in the migrated `secrets` table decrypts only as its own row, so
// a ciphertext copied into another row is refused. Runs where TEST_DATABASE_URL is set (CI's test job). Here in tools/
// because it writes the table as an operator would; inside one transaction that is rolled back.
import { randomUUID } from 'node:crypto';
import { platformTx, secrets as secretsTable } from '@radcore/db/platform';
import { inArray } from 'drizzle-orm';
import { createSecrets, SecretPlaceMismatch, watchSecretExpiry } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import { testSettings } from '@radcore/test-helpers';
import pg from 'pg';
import { describe, expect, it, vi } from 'vitest';

const url = process.env['TEST_DATABASE_URL'];
const secrets = () => createSecrets({ kmsKeyId: null, localKey: testSettings()['SECRETS_LOCAL_KEY'] ?? null });
const placeOf = (rowId: string) => ({ table: 'secrets', column: 'ciphertext', rowId });
// Built at run time and shaped like no real token, so the secret scanner has nothing to match.
const TOKEN = 'page token '.repeat(3);

describe.skipIf(!url)('the secrets table', () => {
  it('stores a ciphertext that decrypts as its own row and not when copied into another', async () => {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('app.principal', 'system:test', true)");
      const s = secrets();
      const insert = async (name: string): Promise<string> => {
        const [row] = (await client.query<{ id: string }>(
          "insert into radcore.secrets (name, ciphertext, key_id) values ($1, '', $2) returning id", [name, s.keyId])).rows;
        const rowId = row?.id ?? '';
        await client.query('update radcore.secrets set ciphertext = $1 where id = $2',
          [await s.encrypt(TOKEN, placeOf(rowId)), rowId]);
        return rowId;
      };
      const a = await insert('crm.meta_page_token');
      const b = await insert('crm.meta_page_token');
      await client.query('update radcore.secrets set ciphertext = (select ciphertext from radcore.secrets where id = $1) '
        + 'where id = $2', [a, b]);
      const read = async (rowId: string) => (await client.query<{ ciphertext: string; key_id: string }>(
        'select ciphertext, key_id from radcore.secrets where id = $1', [rowId])).rows[0];

      expect(await s.decrypt((await read(a))?.ciphertext ?? '', placeOf(a))).toBe(TOKEN);
      await expect(s.decrypt((await read(b))?.ciphertext ?? '', placeOf(b))).rejects.toThrow(SecretPlaceMismatch);
      expect((await read(a))?.key_id).toBe('local:secrets-local-v1');
    } finally {
      await client.query('rollback');
      await client.end();
    }
  });

  it('refuses a name that is not <module>.<name>', async () => {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('app.principal', 'system:test', true)");
      await expect(client.query("insert into radcore.secrets (name, ciphertext, key_id) values ('Meta Token', 'x', 'k')"))
        .rejects.toThrow(/ck_secrets_name/);
    } finally {
      await client.query('rollback');
      await client.end();
    }
  });
});

// RAD-65 part 2: the daily watch alerts on each secret expiring within two weeks, or already expired, and on nothing
// else; an alert names the secret and its date, never its value.
describe.skipIf(!url)('the secrets expiry watch', () => {
  it('alerts on the secrets that expire within two weeks, soonest first, without their values', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-11T00:00:00Z'), toFake: ['Date'] });
    const pool = new pg.Pool({ connectionString: url, max: 2 });
    const db = createDatabase(pool);
    const system = { kind: 'system', name: 'test', permissions: [] } as const;
    const WRITE = { readOnly: false, isolation: 'read committed' } as const;
    const plan = [['crm.meta_page_token', '2026-11-14T00:00:00Z'], ['crm.shopify_token', '2026-12-11T00:00:00Z'],
      ['hr.bank_mailbox', null], ['crm.whatsapp_token', '2026-11-10T00:00:00Z']] as const;
    const ids: string[] = [];
    try {
      await runInTransaction(db, WRITE, system, randomUUID(), async (ctx) => {
        const rows = await platformTx(ctx).insert(secretsTable).values(plan.map(([name, expiresAt]) =>
          ({ name, ciphertext: TOKEN, keyId: 'local:test', expiresAt: expiresAt === null ? null : new Date(expiresAt) })))
          .returning({ id: secretsTable.id });
        ids.push(...rows.map((r) => r.id));
      });
      const alert = vi.fn<(message: string) => Promise<void>>(async () => undefined);
      await runInTransaction(db, { readOnly: true, isolation: 'read committed' }, system, randomUUID(),
        (ctx) => watchSecretExpiry(ctx, null, { jobId: 'watch', alert }));
      const ours = alert.mock.calls.map((c) => c[0]).filter((m) => ids.some((id) => m.includes(id)));
      expect(ours.map((m) => m.split(' ')[1])).toEqual(['crm.whatsapp_token', 'crm.meta_page_token']);
      expect(ours[0]).toContain('has expired');
      expect(ours.join('\n')).not.toContain(TOKEN.trim());
    } finally {
      vi.useRealTimers();
      await runInTransaction(db, WRITE, system, randomUUID(), async (ctx) => {
        await platformTx(ctx).delete(secretsTable).where(inArray(secretsTable.id, ids));
      });
      await pool.end();
    }
  });
});