// RAD-36: the people list on a real PostgreSQL, as the runtime login. Paged by the sort column and id, so no row is
// skipped or repeated; sorted by last sign-in on user_sign_ins' key, epoch for "never" (the architect on RAD-36), answering
// the real time or null. Each test finds only its own people, by a tag in their names: the database is shared.
import { randomBytes, randomUUID } from 'node:crypto';
import { AppError, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { listPeople } from '../packages/lib-platform/src/auth/people-list.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const read = { readOnly: true, isolation: 'read committed' } as const;
const letters = () => [...randomBytes(8)].map((b) => String.fromCharCode(97 + (b % 26))).join('');
type Sort = { column: 'displayName' | 'email' | 'lastSignInAt'; desc: boolean };

describe.skipIf(!url)('the people list', () => {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  const db = createDatabase(pool);
  afterAll(() => pool.end());

  async function asAdmin<T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
    const c = new pg.Client({ connectionString: superUrl });
    await c.connect();
    try {
      await c.query('begin');
      await c.query("set local app.principal = 'system:test'");
      const { rows } = await c.query<T>(text, values);
      await c.query('commit');
      return rows;
    } finally {
      await c.end();
    }
  }
  /** People named `<tag> <n>`, in this role and status, signed in `hoursAgo` hours ago (null: never). */
  async function people(tag: string, specs: { n: number; role?: string; status?: 'active' | 'invited' | 'disabled'; hoursAgo?: number | null }[]) {
    const ids: Record<number, string> = {};
    for (const { n, role = 'sales', status = 'active', hoursAgo = null } of specs) {
      // The person; the database makes their sign-in row (0031), which then gets the time.
      const [row] = await asAdmin<{ id: string }>(`insert into radcore.users (email, display_name, status, password_hash,
        password_set_at, role) values ($1, $2, $3, $4, case when $4::text is null then null else now() end, $5) returning id`,
      [`${tag}.${String(n)}@example.in`, `${tag} ${String(n)}`, status, status === 'invited' ? null : '$argon2id$v=19$m=19456,t=2,p=1$x$y',
        role]);
      await asAdmin(`update radcore.user_sign_ins set last_sign_in_at =
        case when $2::int is null then null else now() - make_interval(hours => $2::int) end where user_id = $1`, [row?.id, hoursAgo]);
      ids[n] = row?.id ?? '';
    }
    return ids;
  }
  const caller = (userId: string = randomUUID(), more: string[] = []): Principal =>
    ({ kind: 'user', userId, permissions: ['users:read', ...more] });
  // Someone who may see addresses, so may find and order people by them (RAD-103).
  const reader = () => caller(randomUUID(), ['pii:read']);
  const page = (as: Principal, input: { filter: Record<string, unknown>; sort?: Sort; limit: number; after?: string }) =>
    runInTransaction(db, read, as, randomUUID(), (ctx: Ctx) => listPeople(ctx, input as never));
  /** Every row, page by page, so a skipped or repeated row shows. */
  async function all(as: Principal, filter: Record<string, unknown>, sort: Sort, limit: number) {
    const ids: string[] = [];
    let after: string | undefined;
    for (let i = 0; i < 20; i += 1) {
      const p = await page(as, { filter, sort, limit, ...(after === undefined ? {} : { after }) });
      ids.push(...p.items.map((r) => r.id));
      if (p.next === null) return ids;
      after = p.next;
    }
    throw new Error('more than 20 pages');
  }

  it('pages by last sign-in across people who never signed in: newest first, never last, none skipped or repeated', async () => {
    const tag = `pl${letters()}`;
    const p = await people(tag, [{ n: 1, hoursAgo: 3 }, { n: 2, hoursAgo: 1 }, { n: 3, hoursAgo: 2 },
      { n: 4 }, { n: 5 }, { n: 6 }, { n: 7 }]);
    const never = [p[4], p[5], p[6], p[7]].map(String).toSorted();
    const as = caller();
    // Pages of 2, so boundaries fall among the never-signed-in.
    expect(await all(as, { search: tag }, { column: 'lastSignInAt', desc: true }, 2))
      .toEqual([p[2], p[3], p[1], ...never.toReversed()]);
    expect(await all(as, { search: tag }, { column: 'lastSignInAt', desc: false }, 2))
      .toEqual([...never, p[1], p[3], p[2]]);
    const first = await page(as, { filter: { search: tag }, sort: { column: 'lastSignInAt', desc: true }, limit: 7 });
    expect(first.items.map((r) => r.lastSignInAt === null)).toEqual([false, false, false, true, true, true, true]);
    expect(first.next).toBeNull();
  });

  it('sorts by name by default, and by address, both ways, a page at a time', async () => {
    const tag = `pn${letters()}`;
    const p = await people(tag, [{ n: 3 }, { n: 1 }, { n: 2 }, { n: 4 }]);
    const as = reader();
    expect(await all(as, { search: tag }, { column: 'displayName', desc: false }, 3)).toEqual([p[1], p[2], p[3], p[4]]);
    expect((await page(as, { filter: { search: tag }, limit: 10 })).items.map((r) => r.displayName))
      .toEqual([1, 2, 3, 4].map((n) => `${tag} ${String(n)}`));
    expect(await all(as, { search: tag }, { column: 'email', desc: true }, 1)).toEqual([p[4], p[3], p[2], p[1]]);
  });

  it('filters by status and role, and says who needs a second factor and which row is the caller', async () => {
    const tag = `pf${letters()}`;
    const p = await people(tag, [{ n: 1, role: 'admin' }, { n: 2, role: 'sales', status: 'invited' },
      { n: 3, role: 'sales', status: 'disabled' }, { n: 4, role: 'accounts' }]);
    await asAdmin(`insert into radcore.second_factors (user_id, secret, secret_key_id, confirmed_at)
      values ($1, 'sealed', 'local:test', now())`, [p[4]]);
    const as = caller(p[1]);
    const rows = (await page(as, { filter: { search: tag }, limit: 10 })).items;
    expect(rows.map((r) => [r.displayName.split(' ')[1], r.status, r.role, r.secondFactor, r.self])).toEqual([
      ['1', 'active', 'admin', 'enrolment_required', true], ['2', 'invited', 'sales', 'not_required', false],
      ['3', 'disabled', 'sales', 'not_required', false], ['4', 'active', 'accounts', 'enrolled', false]]);
    expect((await page(as, { filter: { search: tag, status: 'invited' }, limit: 10 })).items.map((r) => r.id)).toEqual([p[2]]);
    expect((await page(as, { filter: { search: tag, role: 'sales' }, limit: 10 })).items.map((r) => r.id)).toEqual([p[2], p[3]]);
  });

  it('needs a second factor for a role that holds such a key, even with its own setting off (roleNeedsSecondFactor)', async () => {
    const tag = `ps${letters()}`;
    // A stray grant on a role whose flag is off: sign-in asks for the factor, so the list says so too.
    const key = `t_${letters()}`;
    await asAdmin("insert into radcore.roles (key, name, description) values ($1, $1, 'For people-list.test.ts')", [key]);
    await asAdmin("insert into radcore.role_grants (role, permission, scope) values ($1, 'pay:read', 'all')", [key]);
    const p = await people(tag, [{ n: 1, role: key }]);
    expect((await page(caller(), { filter: { search: tag }, limit: 10 })).items.map((r) => [r.id, r.secondFactor]))
      .toEqual([[p[1], 'enrolment_required']]);
  });

  it("doesn't find or order people by an address the caller can't see (RAD-103)", async () => {
    const tag = `pm${letters()}`;
    const p = await people(tag, [{ n: 1 }, { n: 2 }]);
    // Their addresses are `<tag>.<n>@example.in`: ".1@" is in an address only, never in a name.
    expect((await page(reader(), { filter: { search: `${tag}.1@` }, limit: 10 })).items.map((r) => r.id)).toEqual([p[1]]);
    expect((await page(caller(), { filter: { search: `${tag}.1@` }, limit: 10 })).items).toEqual([]);
    expect((await page(caller(), { filter: { search: tag }, limit: 10 })).items.map((r) => r.id)).toEqual([p[1], p[2]]);
    const sorted = await page(caller(), { filter: { search: tag }, sort: { column: 'email', desc: false }, limit: 10 })
      .catch((e: unknown) => e as AppError);
    expect([(sorted as AppError).code, (sorted as AppError).issues.map((i) => [i.path, i.code])])
      .toEqual(['invalid_input', [[['sort', 'column'], 'needs_pii_read']]]);
  });

  it('refuses a page key made under another sort', async () => {
    const tag = `pk${letters()}`;
    await people(tag, [{ n: 1 }, { n: 2 }]);
    const as = reader();
    const first = await page(as, { filter: { search: tag }, sort: { column: 'email', desc: false }, limit: 1 });
    const other = await page(as, { filter: { search: tag }, sort: { column: 'displayName', desc: false }, limit: 1, after: first.next ?? '' })
      .catch((e: unknown) => e);
    expect((other as AppError).code).toBe('invalid_input');
  });
});
