// RAD-116 (the architect's ruling) on a real PostgreSQL, as the runtime login: GET /money-accounts, the accounts a
// payment may name, for a screen's picker. It's the payment service's own rule (takesMoney): Cash, Bank, and those under
// Bank, switched on; never another account, and no balance.
import { randomBytes, randomUUID } from 'node:crypto';
import { listMoneyAccountsNow } from '@radcore/lib-accounts';
import { listMoneyAccounts, recordPaymentContract } from '@radcore/lib-accounts/contract';
import { requestFor } from '@radcore/lib-common';
import { loadConfig, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import { testSettings } from '@radcore/test-helpers';
import pg from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createApp, listen } from '../apps/api/src/app.ts';
import accountRoutes from '../apps/api/src/routes/accounts.ts';
import { takesMoney } from '../packages/lib-accounts/src/services/money-accounts.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const READ = { readOnly: true, isolation: 'read committed' } as const;
const letters = () => randomBytes(4).toString('hex').toUpperCase();

it('takes Cash, Bank and an account under Bank, and nothing else', () => {
  expect([takesMoney({ key: 'cash', parentKey: null }), takesMoney({ key: 'bank', parentKey: null }), takesMoney({ key: null, parentKey: 'bank' }),
    takesMoney({ key: 'card_settlements', parentKey: 'bank' }), takesMoney({ key: 'sales', parentKey: null }), takesMoney({ key: null, parentKey: 'cash' })])
    .toEqual([true, true, true, true, false, false]);
});

describe.skipIf(!url || !superUrl)('money accounts', { timeout: 30_000 }, () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const su = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
    await su.end();
  });
  /** An account under `parent` (a system key), switched on or off, written as the system. */
  const account = async (type: string, parent: string | null, active = true) => {
    const c = await su.connect();
    try {
      await c.query('begin');
      await c.query("set local app.principal = 'system:test'");
      const { rows } = await c.query<{ id: string }>(`insert into radcore.accounts (name, type, parent_id, active)
        values ($1, $2, (select id from radcore.accounts where system_key = $3), $4) returning id`, [`Test ${letters()}`, type, parent, active]);
      await c.query('commit');
      return rows[0]?.id ?? '';
    } finally {
      c.release();
    }
  };
  const roleOf = async (role: string): Promise<Principal> => {
    const { rows } = await su.query<{ permission: string }>('select permission from radcore.role_grants where role = $1', [role]);
    return { kind: 'user', userId: randomUUID(), role, permissions: rows.map((r) => r.permission) };
  };

  it('lists Cash, Bank and a bank account under it, switched on; never another account or one switched off', async () => {
    const [hdfc, off, rent] = [await account('asset', 'bank'), await account('asset', 'bank', false), await account('expense', null)];
    const out = await runInTransaction(db, READ, await roleOf('counter'), randomUUID(), (ctx) => listMoneyAccountsNow(ctx));
    const ids = out.items.map((a) => a.id);
    const { rows: system } = await su.query<{ id: string; system_key: string }>("select id, system_key from radcore.accounts where system_key in ('cash', 'bank')");
    expect([...system.map((s) => ids.includes(s.id)), ids.includes(hdfc), ids.includes(off), ids.includes(rent)]).toEqual([true, true, true, false, false]);
    expect(out.items.find((a) => a.id === system.find((s) => s.system_key === 'cash')?.id)?.cash).toBe(true);
    expect(out.items.find((a) => a.id === hdfc)).toMatchObject({ cash: false });
  });

  // A credit note's counter refund names an account too (the coordinator on RAD-116): whoever drafts one by template can
  // pick it.
  it('is granted, by template, to every role that drafts credit notes', async () => {
    const { rows } = await su.query<{ role: string }>(`select t.role from radcore.role_templates t where t.permission = 'credit_notes:write'
      and not exists (select 1 from radcore.role_templates m where m.role = t.role and m.permission = 'money_accounts:read')`);
    expect(rows.map((r) => r.role)).toEqual([]);
  });

  // Never card digits in a payment's reference, on POST /payments as in the quick bill (backend on #304): refused by
  // name through the route, before anything is written.
  it('refuses card digits in a reference on POST /payments, by name', async () => {
    const config = loadConfig(testSettings(), 'api');
    const accounts = await roleOf('accounts');
    const server = await listen(createApp(config, { info: vi.fn(), error: vi.fn() }, { db, authenticate: async () => accounts, routes: accountRoutes }),
      0, '127.0.0.1');
    try {
      const { rows } = await su.query<{ party: string; bank: string }>(`select (select id from radcore.parties where system_key = 'walk_in') as party,
        (select id from radcore.accounts where system_key = 'bank') as bank`);
      const sent = requestFor(recordPaymentContract, { kind: 'receipt', partyId: rows[0]?.party, businessDate: '2026-11-15', amount: '100',
        accountId: rows[0]?.bank, reference: '4111 1111 1111 1111' });
      const res = await fetch(`http://127.0.0.1:${server.port}${sent.path}`, { method: sent.method, body: sent.body ?? null,
        headers: { 'content-type': 'application/json', origin: config.publicOrigin, 'sec-fetch-site': 'same-origin', 'idempotency-key': randomUUID() } });
      expect([res.status, (await res.json() as { code?: string }).code]).toEqual([422, 'looks_like_card_number']);
    } finally {
      await server.stop();
    }
  });

  it('answers the counter over the API, and refuses a role without money_accounts:read', async () => {
    const config = loadConfig(testSettings(), 'api');
    const get = async (as: Principal) => {
      const server = await listen(createApp(config, { info: vi.fn(), error: vi.fn() }, { db, authenticate: async () => as, routes: accountRoutes }),
        0, '127.0.0.1');
      try {
        const sent = requestFor(listMoneyAccounts, {});
        const res = await fetch(`http://127.0.0.1:${server.port}${sent.path}`, { method: sent.method,
          headers: { origin: config.publicOrigin, 'sec-fetch-site': 'same-origin' } });
        return res.status;
      } finally {
        await server.stop();
      }
    };
    const counter = await roleOf('counter');
    expect([await get(counter), await get({ ...counter, permissions: counter.permissions.filter((p) => p !== 'money_accounts:read') })])
      .toEqual([200, 403]);
  });
});
