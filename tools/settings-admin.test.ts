// RAD-132 (ADR-001 §8c, ADR-006 §3) on a real PostgreSQL: the settings screen's routes and the number-series prefix
// rules. apps/api composes every library's settings and series; a change takes a reason, passes the setting's schema
// and its own check, and null puts the default back. A series' prefix changes from next year, or from this year before
// its first number; an issued number never changes. Series here are the test's own, so no real series moves.
import { randomBytes, randomUUID } from 'node:crypto';
import { financialYear, requestFor, type Contract } from '@radcore/lib-common';
import {
  changeSeriesPrefix, declaredSeriesKeys, declaredSettingKeys, defineSeries, listSeriesOf, loadConfig, nextNumber, roleNeedsSecondFactor, type Ctx,
  type Principal,
} from '@radcore/lib-platform';
import { listSettings, setSeriesPrefix, setSetting } from '@radcore/lib-platform/contract';
import { getPartyList } from '@radcore/lib-sales';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import { testSettings } from '@radcore/test-helpers';
import pg from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { SECOND_FACTOR_KEYS } from '../packages/lib-platform/src/permissions.ts';
import { createApp, listen } from '../apps/api/src/app.ts';
import { API_SERIES, API_SETTINGS, settingsRoutes } from '../apps/api/src/catalogue.ts';
import { apiRoutes } from '../apps/api/src/routes.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const ADMIN: Principal = { kind: 'user', userId: randomUUID(), permissions: ['settings:read', 'settings:write'] };
const letters = () => [...randomBytes(8)].map((b) => String.fromCharCode(97 + (b % 26))).join('');
// A test's own series are platform.t_*: the composition check leaves them out.
const own = (k: string) => !k.startsWith('platform.t_');

// D-19, widened (Sarthak, 20 Nov: "Yes, require it"): settings:write sets what every party with none of its own takes.
it('marks settings:write as a key that needs the second factor, and settings:read not', () => {
  expect([SECOND_FACTOR_KEYS.includes('settings:write'), SECOND_FACTOR_KEYS.includes('settings:read')]).toEqual([true, false]);
});

it('composes every setting and series a library declares, once each (ADR-001 §8c)', () => {
  // The api's route list imports every library, so every setting and series declared anywhere is in the registries.
  expect(typeof apiRoutes).toBe('function');
  const keys = API_SETTINGS.map((s) => s.key);
  expect(keys.toSorted()).toEqual(declaredSettingKeys().filter(own));
  expect(new Set(keys).size).toBe(keys.length);
  expect(API_SERIES.map((s) => s.key).toSorted()).toEqual(declaredSeriesKeys().filter(own));
  expect(API_SETTINGS.every((s) => s.label !== '' && s.description !== '')).toBe(true);
});

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the settings tests must run, not skip');
});

describe.skipIf(!url || !superUrl)('the settings and number-series screens', { timeout: 30_000 }, () => {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  const su = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  const cfg = loadConfig(testSettings(), 'api');
  afterAll(async () => {
    await pool.end();
    await su.end();
  });
  const run = <R>(fn: (ctx: Ctx) => Promise<R>) => runInTransaction(db, { readOnly: false, isolation: 'read committed' }, ADMIN, randomUUID(), fn);
  const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => String((e as { code?: string }).code ?? e));

  async function api<T>(fn: (send: (c: Contract, input: unknown) => Promise<[number, Record<string, unknown>]>) => Promise<T>): Promise<T> {
    const server = await listen(createApp(cfg, { info: vi.fn(), error: vi.fn() }, { db, authenticate: async () => ADMIN, routes: settingsRoutes }),
      0, '127.0.0.1');
    try {
      return await fn(async (contract, input) => {
        const sent = requestFor(contract, input);
        const res = await fetch(`http://127.0.0.1:${server.port}${sent.path}`, { method: sent.method, body: sent.body ?? null,
          headers: { 'content-type': 'application/json', origin: cfg.publicOrigin, 'sec-fetch-site': 'same-origin', 'idempotency-key': randomUUID() } });
        return [res.status, (await res.json()) as Record<string, unknown>];
      });
    } finally {
      await server.stop();
    }
  }
  type Row = { key: string; value: unknown; default: unknown; changed: boolean; changedBy: { id: string } | null; label: string };
  const listed = async (send: (c: Contract, input: unknown) => Promise<[number, Record<string, unknown>]>, key: string) =>
    ((await send(listSettings, {}))[1]['settings'] as Row[]).find((s) => s.key === key);

  it('asks the second factor of someone whose role holds settings:write, whatever the role says (D-19)', async () => {
    const role = `t_${letters()}`;
    const c = await su.connect();
    try {
      await c.query('begin');
      await c.query("set local app.principal = 'system:test'");
      await c.query("insert into radcore.roles (key, name, description) values ($1, $1, 'For settings-admin.test.ts')", [role]);
      await c.query("insert into radcore.role_grants (role, permission, scope) values ($1, 'session:read', 'all'), ($1, 'settings:write', 'all')", [role]);
      const { rows } = await c.query<{ id: string }>(`insert into radcore.users (email, display_name, status, password_hash, role)
        values ($1, 'Test', 'active', 'x', $2) returning id`, [`settings.${randomUUID()}@example.test`, role]);
      await c.query('commit');
      expect(await run((ctx) => roleNeedsSecondFactor(ctx, rows[0]?.id ?? ''))).toBe(true);
    } finally {
      c.release();
    }
  });

  it('lists each setting, changes one with a reason, refuses what its schema or its check refuses by name, and resets it', async () => {
    const key = 'platform.public_link_max_days';
    await api(async (send) => {
      expect(await listed(send, 'accounts.cash_receipt_limit')).toMatchObject({ label: expect.any(String), default: '200000.00',
        changed: false, changedBy: null });
      expect((await send(setSetting, { key: 'sales.nothing_here', value: 1, reason: 'Testing' }))[0]).toBe(404);
      expect(await send(setSetting, { key: 'accounts.default_credit_days', value: 'soon', reason: 'Testing' })).toMatchObject([422,
        { code: 'invalid_value' }]);
      // Another kind's label: refused by the setting's own check, as the location-kinds screen refuses it.
      const [kinds] = API_SETTINGS.filter((s) => s.key.startsWith('stock.location_kind_label_'));
      const [, other] = API_SETTINGS.filter((s) => s.key.startsWith('stock.location_kind_label_'));
      expect(await send(setSetting, { key: kinds?.key, value: other?.fallback, reason: 'Testing' })).toMatchObject([422, { code: 'value_refused' }]);
      // A default price list that doesn't exist: refused by its check, before anything is stored.
      expect(await send(setSetting, { key: 'sales.default_price_list', value: randomUUID(), reason: 'Testing' }))
        .toMatchObject([422, { code: 'value_refused' }]);
      try {
        expect((await send(setSetting, { key, value: 45, reason: 'Links for a longer tender' }))[0]).toBe(200);
        expect(await listed(send, key)).toMatchObject({ value: 45, default: 30, changed: true, changedBy: { id: ADMIN.userId } });
        const why = await su.query<{ reason: string }>(`select r.reason from radcore.audit_log a join radcore.change_reasons r on r.id = a.reason_id
          where a.table_name = 'settings' and a.record_id = $1 order by a.seq desc limit 1`, [key]);
        expect(why.rows).toEqual([{ reason: 'Links for a longer tender' }]);
      } finally {
        expect((await send(setSetting, { key, value: null, reason: 'Back to the default' }))[0]).toBe(200);
      }
      expect(await listed(send, key)).toMatchObject({ value: 30, changed: false });
      expect((await su.query('select 1 from radcore.settings where key = $1', [key])).rowCount).toBe(0);
    });
  });

  it('reads a default price list switched off since it was chosen as none (ADR-001 §8c; the auditor on #264)', async () => {
    // Switched off before it's the default, so a test running alongside sees what it would with none.
    const [list] = (await su.query<{ id: string }>(`with p as (select set_config('app.principal', 'system:test', true))
      insert into radcore.price_lists (name, active) select $1, false from p returning id`, [`Old list ${randomUUID()}`])).rows;
    const party = (await su.query<{ id: string }>(`with p as (select set_config('app.principal', 'system:test', true))
      insert into radcore.parties (name, customer, state_code) select $1, true, '27' from p returning id`, [`List party ${randomUUID()}`])).rows[0]?.id ?? '';
    const asSystem = (text: string, values: unknown[]) => su.query(`with p as (select set_config('app.principal', 'system:test', true)) ${text}`, values);
    try {
      await asSystem("insert into radcore.settings (key, value) select 'sales.default_price_list', to_jsonb($1::text) from p", [list?.id]);
      expect(await run((ctx) => getPartyList(ctx, { partyId: party }))).toEqual({ priceListId: null, own: false });
    } finally {
      await asSystem("delete from radcore.settings where key = 'sales.default_price_list' and exists (select 1 from p)", []);
    }
  });

  it('changes a prefix from this year only before its first number, and from next year always; an issued number never changes', async () => {
    const s = defineSeries(`platform.t_${letters()}`, 'AB', { label: 'Test' });
    // This year and next, as the service sees them: a test never reads the run date (RC-156).
    const { thisYear, nextYear } = await run((ctx) => listSeriesOf(ctx, [s]));
    const year = financialYear(thisYear.start);
    const next = financialYear(nextYear.start);
    expect([thisYear.label, nextYear.label]).toEqual([year.label, next.label]);
    const last = financialYear(`${Number(year.start.slice(0, 4)) - 1}-04-01`);
    const change = (prefix: string, from: 'this_year' | 'next_year') => run((ctx) => changeSeriesPrefix(ctx, [s], { key: s.key, prefix, from,
      reason: 'Testing' }));
    const shown = async () => (await run((ctx) => listSeriesOf(ctx, [s]))).series[0];
    const short = (label: string) => label.slice(2);
    expect(await shown()).toEqual({ key: s.key, label: 'Test', prefixThisYear: 'AB', prefixNextYear: 'AB', next: `AB/${short(year.label)}/00001`,
      thisYearDrawn: false });
    expect(await change('CD', 'this_year')).toEqual({ fromYear: year.label });
    expect(await run((ctx) => nextNumber(ctx, s, year.start))).toBe(`CD/${short(year.label)}/00001`);
    expect(await code(change('EF', 'this_year'))).toBe('series_in_use');
    // The database refuses it too, once a number is drawn: the year keeps the prefix its first number took.
    const c = await su.connect();
    try {
      await c.query('begin');
      await c.query("set local app.principal = 'system:test'");
      expect(await c.query("update radcore.number_counters set prefix = 'ZZ' where series = $1 and financial_year = $2", [s.key, year.label])
        .then(() => 'ok', (e: { code?: string }) => e.code)).toBe('RA001');
    } finally {
      await c.query('rollback');
      c.release();
    }
    expect(await change('EF', 'next_year')).toEqual({ fromYear: next.label });
    expect(await shown()).toMatchObject({ prefixThisYear: 'CD', prefixNextYear: 'EF', next: `CD/${short(year.label)}/00002`, thisYearDrawn: true });
    expect(await run((ctx) => nextNumber(ctx, s, year.end))).toBe(`CD/${short(year.label)}/00002`);
    expect(await run((ctx) => nextNumber(ctx, s, next.start))).toBe(`EF/${short(next.label)}/00001`);
    // A document dated in last year keeps last year's prefix: the declared one, as nothing was changed for it.
    expect(await run((ctx) => nextNumber(ctx, s, last.start))).toBe(`AB/${short(last.label)}/00001`);
    await api(async (send) => {
      expect((await send(setSeriesPrefix, { key: 'platform.t_nothing', prefix: 'ZZ', from: 'next_year', reason: 'Testing' }))[0]).toBe(404);
    });
  });
});
