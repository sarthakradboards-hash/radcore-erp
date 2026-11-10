// RC-161 on a real PostgreSQL 16 database: the settings table holds settings only, keyed `<module>.<name>`, so job
// state and the period lock can't share its key space. The table is the one migration 0003_settings built in the
// run's database (tools/test-database.ts); every write runs in a transaction that is rolled back.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env['TEST_DATABASE_URL'];

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the settings tests must run, not skip');
});

describe.skipIf(!url)('settings table on PostgreSQL (RC-161)', () => {
  const client = new pg.Client({ connectionString: url });

  beforeAll(async () => {
    await client.connect();
    await client.query('begin');
    await client.query('set local search_path = radcore');
    await client.query("set local app.principal = 'system:test'");
  });

  afterAll(async () => {
    await client.query('rollback');
    await client.end();
  });

  // Runs the insert in a savepoint and returns the SQLSTATE it raised, or 'ok'.
  const put = async (key: string, value: unknown) => {
    await client.query('savepoint attempt');
    try {
      await client.query('insert into settings (key, value) values ($1, $2)', [key, JSON.stringify(value)]);
      return 'ok';
    } catch (e) {
      return (e as { code?: string }).code ?? 'error';
    } finally {
      await client.query('rollback to savepoint attempt');
    }
  };

  it('stores a module setting as JSON', async () => {
    expect(await put('sales.invoice_prefix', 'INV')).toBe('ok');
    expect(await put('platform.session_idle_minutes', 30)).toBe('ok');
  });

  it.each(['jobs.last_run', 'period_lock', 'lock.accounts', 'Sales.prefix', 'sales.', 'sales.invoice-prefix', 'sales.x.y'])(
    'refuses "%s": not a module setting', async (key) => {
      expect(await put(key, 1)).toBe('23514');
    });

  it('carries the audit columns and nothing else but key and value', async () => {
    const { rows } = await client.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema = 'radcore' and table_name = 'settings' order by 1");
    expect(rows.map((r) => r.column_name)).toEqual(['created_at', 'created_by', 'key', 'updated_at', 'updated_by', 'value']);
  });
});
