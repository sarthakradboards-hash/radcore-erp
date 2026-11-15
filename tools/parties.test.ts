// RAD-90 (M2-11): parties on a real PostgreSQL as the runtime login. Customers, dealers, franchisees and suppliers in
// one master; GSTIN, PAN, composition and state kept consistent in the service and in the database; credit terms set
// only through their own route, with parties:manage; personal fields masked without pii:read over the real routes,
// and a look logged with it (RAD-40); and a party switched off, never deleted. Every name and GSTIN is the test's own.
import { randomBytes, randomUUID } from 'node:crypto';
import { addParty, changeParty, getPartyById, listPartiesPage, setCreditTerms } from '@radcore/lib-accounts';
import { getParty } from '@radcore/lib-accounts/contract';
import { gstinCheckChar, moneyString, requestFor } from '@radcore/lib-common';
import { AppError, loadConfig, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import { testSettings } from '@radcore/test-helpers';
import pg from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { PERMISSIONS, SECOND_FACTOR_KEYS } from '../packages/lib-platform/src/permissions.ts';
import { createApp, listen } from '../apps/api/src/app.ts';
import accounts from '../apps/api/src/routes/accounts.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const write = { readOnly: false, isolation: 'read committed' } as const;
const AS: Principal = { kind: 'system', name: 'test', permissions: ['parties:manage'] };
const NO_MANAGE: Principal = { kind: 'system', name: 'test', permissions: [] };
const letters = (n: number) => [...randomBytes(n)].map((b) => String.fromCharCode(65 + (b % 26))).join('');
/** A valid GSTIN of its own, in Karnataka (29): a fresh PAN with a company's 4th letter, and its check character. */
const gstin = () => {
  const first14 = `29${letters(3)}C${letters(1)}${String(randomBytes(2).readUInt16BE() % 10000).padStart(4, '0')}${letters(1)}1Z`;
  return first14 + gstinCheckChar(first14);
};
const fields = (o: Record<string, unknown> = {}) => ({
  name: `Test party ${letters(8)}`, kinds: ['customer'] as ('customer' | 'dealer' | 'franchisee' | 'supplier')[], gstin: null,
  pan: null, composition: false, stateCode: '29', phone: '98765 43210', email: 'Asha@Example.IN', addressLine1: 'Plot 4',
  addressLine2: null, city: 'Bengaluru', pincode: '560058', ...o,
});

// Sarthak (RAD-90): credit terms need the second factor (D-19); contact details have a key of their own, at all scope.
it('marks parties:manage as needing the second factor, and parties:contact as all-scope only without it', () => {
  expect([SECOND_FACTOR_KEYS.includes('parties:manage'), SECOND_FACTOR_KEYS.includes('parties:contact')]).toEqual([true, false]);
  expect(PERMISSIONS.filter((p) => p.allOnly).map((p) => p.key)).toEqual(['parties:contact']);
});

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the party tests must run, not skip');
});

describe.skipIf(!url)('parties', { timeout: 30_000 }, () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const db = createDatabase(pool);
  const superPool = new pg.Pool({ connectionString: superUrl, max: 1 });
  afterAll(async () => { await Promise.all([pool.end(), superPool.end()]); });

  const run = <R>(fn: (ctx: Ctx) => Promise<R>) => runInTransaction(db, write, AS, randomUUID(), fn);
  const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof AppError ? e.code : String(e)));
  const add = (o: Record<string, unknown> = {}) => run((ctx) => addParty(ctx, fields(o) as never));

  it('keeps one party per GSTIN, its phone as E.164 and its email in lower case', async () => {
    const g = gstin();
    const { id } = await add({ gstin: g, pan: g.slice(2, 12), kinds: ['dealer', 'supplier'] });
    expect(await run((ctx) => getPartyById(ctx, { id }))).toMatchObject({ gstin: g, kinds: ['dealer', 'supplier'],
      phone: '+919876543210', email: 'asha@example.in', stateCode: '29', creditDays: null, creditLimit: null, active: true });
    expect(await code(add({ gstin: g }))).toBe('gstin_taken');
  });

  it('checks the GSTIN, PAN, state and composition together when a party changes, and in the database', async () => {
    const g = gstin();
    const { id } = await add({ gstin: g });
    const change = (c: Record<string, unknown>) => code(run((ctx) => changeParty(ctx, { id, ...c })));
    expect(await Promise.all([change({ stateCode: '27' }), change({ pan: 'AAAPA1234A' }), change({ gstin: null, composition: true })]))
      .toEqual(['invalid_input', 'invalid_input', 'invalid_input']);
    expect(await change({ gstin: null, stateCode: '27' })).toBe('ok');
    expect(await code(add({ composition: true }))).toBe('invalid_input');
    const c = await superPool.connect();
    try {
      const refused = async (set: string) => {
        await c.query('begin');
        await c.query("set local app.principal = 'system:test'");
        const r = await c.query(`update radcore.parties set ${set} where id = $1`, [id]).then(() => 'ok', (e: { constraint?: string }) => e.constraint);
        await c.query('rollback');
        return r;
      };
      // One at a time on the one connection, each breaking only the rule it names (the auditor on #180).
      const got = [];
      for (const set of [`gstin = '${g}'`, 'composition = true', 'customer = false', "phone = '98765'"]) got.push(await refused(set));
      expect(got).toEqual(['ck_parties_state', 'ck_parties_composition', 'ck_parties_kinds', 'ck_parties_phone']);
    } finally {
      c.release();
    }
  });

  it('sets credit terms only through their own route, and keeps them out of a party create or change', async () => {
    const { id } = await add({ creditDays: 30, creditLimit: '50000.00' });
    expect(await run((ctx) => getPartyById(ctx, { id }))).toMatchObject({ creditDays: null, creditLimit: null });
    await run((ctx) => setCreditTerms(ctx, { id, creditDays: 30, creditLimit: moneyString().parse('50000.00'), reason: 'Agreed with the dealer' }));
    expect(await run((ctx) => getPartyById(ctx, { id }))).toMatchObject({ creditDays: 30, creditLimit: '50000.00' });
    expect(await code(run((ctx) => setCreditTerms(ctx, { id: randomUUID(), creditDays: null, creditLimit: null, reason: 'x' })))).toBe('not_found');
    // The service checks parties:manage itself, so a caller from another library can't set terms without it.
    expect(await code(runInTransaction(db, write, NO_MANAGE, randomUUID(), (ctx) =>
      setCreditTerms(ctx, { id, creditDays: 60, creditLimit: null, reason: 'x' })))).toBe('forbidden');
  });

  it('lists by name, found by a word of the name or the whole GSTIN, filtered by kind and active', async () => {
    const word = `Zq${letters(6)}`;
    const g = gstin();
    const a = await add({ name: `${word} Motors`, kinds: ['customer'] });
    const b = await add({ name: `${word} Spares`, kinds: ['supplier'], gstin: g });
    const find = async (filter: Record<string, unknown>) =>
      (await run((ctx) => listPartiesPage(ctx, { filter, limit: 10 }))).items.map((p) => p.id);
    expect(await find({ search: word })).toEqual([a.id, b.id]);
    expect(await find({ search: g.toLowerCase() })).toEqual([b.id]);
    expect(await find({ search: word, kind: 'supplier' })).toEqual([b.id]);
    await run((ctx) => changeParty(ctx, { id: a.id, active: false }));
    expect(await find({ search: word, active: true })).toEqual([b.id]);
    expect(await pool.query('delete from radcore.parties where id = $1', [a.id]).then(() => 'ok', (e: { code?: string }) => e.code)).toBe('42501');
  });

  it('masks a party’s phone, email and address without pii:read over the real route, and logs a look with it', async () => {
    const { id } = await add();
    const user = (permissions: string[]): Principal => ({ kind: 'user', userId: randomUUID(), permissions: ['parties:read', ...permissions] });
    const cfg = loadConfig(testSettings(), 'api');
    const fetchAs = async (p: Principal) => {
      const server = await listen(createApp(cfg, { info: vi.fn(), error: vi.fn() }, { db, authenticate: async () => p, routes: accounts }), 0, '127.0.0.1');
      try {
        const sent = requestFor(getParty, { id });
        return await (await fetch(`http://127.0.0.1:${server.port}${sent.path}`, { headers: { origin: cfg.publicOrigin } })).json() as Record<string, unknown>;
      } finally {
        await server.stop();
      }
    };
    const looks = async () => (await superPool.query("select 1 from radcore.access_log where record_table = 'parties' and record_id = $1", [id])).rows.length;
    const hidden = await fetchAs(user([]));
    expect([hidden['phone'], hidden['email'], hidden['city'], hidden['name']])
      .toEqual([{ masked: '••••••3210' }, { masked: '••••••' }, { masked: '••••••' }, expect.stringContaining('Test party')]);
    expect(await looks()).toBe(0);
    const shown = await fetchAs(user(['pii:read']));
    expect([shown['phone'], shown['email']]).toEqual(['+919876543210', 'asha@example.in']);
    expect(await looks()).toBe(1);
  });

  it('refuses an own-scope grant of parties:contact in the database, which unmasks by key, not scope', async () => {
    const c = await superPool.connect();
    try {
      const grant = async (table: string, scope: string) => {
        await c.query('begin');
        await c.query("set local app.principal = 'system:test'");
        const r = await c.query(`insert into radcore.${table} (role, permission, scope) values ('technician', 'parties:contact', $1)`, [scope])
          .then(() => 'ok', (e: { constraint?: string }) => e.constraint);
        await c.query('rollback');
        return r;
      };
      expect([await grant('role_grants', 'own'), await grant('role_templates', 'own'), await grant('role_grants', 'all')])
        .toEqual(['ck_role_grants_scope', 'ck_role_templates_scope', 'ok']);
    } finally {
      c.release();
    }
  });
});
