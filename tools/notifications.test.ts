// RAD-121 (M3-17, RC-142's alert part) on a real PostgreSQL 16, as the app login. A service raises a notification in
// its own save's transaction, so a save that rolls back raises none. A notification holds its kind and the record's
// table and id, never a copy: its text is built when it's read, for the viewer and masked for them (M6-16), so a later
// change to the record shows. Each person reads, counts and marks only their own, newest first, paged without skips.
// It's machinery: the who-and-when trigger, no audit rows (ADR-005 §7c). Each test makes its own people.
import { randomBytes, randomUUID } from 'node:crypto';
import { platformTx, users } from '@radcore/db/platform';
import { maskOf } from '@radcore/lib-common';
import { defineNotification, markNotificationsRead, myNotificationsPage, notify, unreadNotifications, type Ctx, type Principal }
  from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import { inArray } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
const READ = { readOnly: true, isolation: 'read committed' } as const;
const SYSTEM: Principal = { kind: 'system', name: 'test', permissions: [] };
const letters = () => [...randomBytes(8)].map((b) => String.fromCharCode(97 + (b % 26))).join('');

// A person's name and email, the email shown only to a viewer who may see personal data.
const PERSON = defineNotification('platform.t_person', { table: 'users', label: 'Someone needs you',
  describe: async (ctx, ids) => new Map((await platformTx(ctx).select({ id: users.id, name: users.displayName, email: users.email })
    .from(users).where(inArray(users.id, [...ids]))).map((u) => [u.id,
    `${u.name} (${ctx.shows('whole') ? u.email : maskOf(u.email, 'whole').masked})`])) });
const PLAIN = defineNotification('platform.t_plain', { table: 'users', label: 'Something changed' });

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the notification tests must run, not skip');
});

describe.skipIf(!url || !superUrl)('notifications', { timeout: 30_000 }, () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const su = new pg.Pool({ connectionString: superUrl, max: 1 });
  const db = createDatabase(pool);
  afterAll(async () => {
    await pool.end();
    await su.end();
  });
  const as = (p: Principal, spec: typeof WRITE | typeof READ = WRITE) => <R>(fn: (ctx: Ctx) => Promise<R>) =>
    runInTransaction(db, spec, p, randomUUID(), fn);
  /** One statement as the owner, in a transaction that names who wrote it. */
  async function owner<T extends pg.QueryResultRow>(text: string, values: unknown[]): Promise<T[]> {
    const c = await su.connect();
    try {
      await c.query('begin');
      await c.query("set local app.principal = 'system:test'");
      const { rows } = await c.query<T>(text, values);
      await c.query('commit');
      return rows;
    } finally {
      c.release();
    }
  }
  const person = async (name = `Asha ${letters()}`) => (await owner<{ id: string }>(
    "insert into radcore.users (email, display_name, role) values ($1, $2, 'sales') returning id", [`${letters()}@example.test`, name]))[0]?.id ?? '';
  const viewer = (userId: string, permissions: string[] = []): Principal => ({ kind: 'user', userId, permissions });
  const page = (p: Principal, input: { limit?: number; after?: string; unread?: boolean } = {}) =>
    as(p, READ)((ctx) => myNotificationsPage(ctx, { limit: input.limit ?? 50, filter: input.unread === undefined ? {} : { unread: input.unread },
      ...(input.after === undefined ? {} : { after: input.after }) }));

  it('raises a notification with its save, and none when the save rolls back', async () => {
    const [to, about] = [await person(), await person()];
    await expect(as(SYSTEM)(async (ctx) => {
      await notify(ctx, PLAIN, { to, recordId: about });
      throw new Error('the save failed after its notification');
    })).rejects.toThrow('the save failed');
    expect(await as(viewer(to), READ)((ctx) => unreadNotifications(ctx))).toEqual({ unread: 0 });
    await as(SYSTEM)((ctx) => notify(ctx, PLAIN, { to, recordId: about }));
    expect(await as(viewer(to), READ)((ctx) => unreadNotifications(ctx))).toEqual({ unread: 1 });
    expect(await as(viewer(about), READ)((ctx) => unreadNotifications(ctx))).toEqual({ unread: 0 });
  });

  it('holds references, never copies: the text is built when read, for the viewer, and masked for them', async () => {
    const to = await person();
    const about = await person('Ravi Kumar');
    await as(SYSTEM)((ctx) => notify(ctx, PERSON, { to, recordId: about }));
    const stored = (await su.query('select * from radcore.notifications where user_id = $1', [to])).rows[0] as Record<string, unknown>;
    expect(Object.keys(stored).filter((k) => !['created_at', 'created_by', 'updated_at', 'updated_by'].includes(k)).sort())
      .toEqual(['at', 'id', 'kind', 'read_at', 'record_id', 'record_table', 'user_id']);
    const masked = (await page(viewer(to))).items[0];
    expect(masked).toMatchObject({ kind: 'platform.t_person', record: { table: 'users', id: about }, text: 'Ravi Kumar (••••••)', readAt: null });
    expect((await page(viewer(to, ['pii:read']))).items[0]?.text).toMatch(/^Ravi Kumar \([a-z]+@example\.test\)$/);
    // Renamed after the notification was raised: the text shows the record as it is now.
    await owner("update radcore.users set display_name = 'Ravi K' where id = $1", [about]);
    expect((await page(viewer(to))).items[0]?.text).toBe('Ravi K (••••••)');
  });

  it('shows the label where the record can’t be described, or the kind isn’t known to this process', async () => {
    const [to, about] = [await person(), await person()];
    await as(SYSTEM)((ctx) => notify(ctx, PLAIN, { to, recordId: about }));
    expect((await page(viewer(to))).items.map((n) => n.text)).toEqual(['Something changed']);
    const gone = randomUUID();
    await as(SYSTEM)((ctx) => notify(ctx, PERSON, { to, recordId: gone }));
    await owner("insert into radcore.notifications (user_id, kind, record_table, record_id) values ($1, 'crm.t_unknown', 'users', $2)", [to, about]);
    expect((await page(viewer(to))).items.map((n) => n.text)).toEqual(['Something needs your attention', 'Someone needs you', 'Something changed']);
  });

  it('lists a person’s own newest first, a page at a time, never skipping one raised in the same moment', async () => {
    const [to, other, about] = [await person(), await person(), await person()];
    await as(SYSTEM)(async (ctx) => {
      for (let i = 0; i < 3; i += 1) await notify(ctx, PLAIN, { to, recordId: about });
      await notify(ctx, PLAIN, { to: other, recordId: about });
    });
    await as(SYSTEM)((ctx) => notify(ctx, PLAIN, { to, recordId: about }));
    const seen: string[] = [];
    let after: string | undefined;
    do {
      const p = await page(viewer(to), { limit: 1, ...(after === undefined ? {} : { after }) });
      seen.push(...p.items.map((n) => n.id));
      after = p.next ?? undefined;
    } while (after !== undefined);
    const { rows } = await su.query<{ id: string }>('select id from radcore.notifications where user_id = $1 order by at desc, id desc', [to]);
    expect(seen).toEqual(rows.map((r) => r.id));
    expect(seen).toHaveLength(4);
  });

  it('marks some or all of a person’s own as read, and never another person’s', async () => {
    const [to, other, about] = [await person(), await person(), await person()];
    await as(SYSTEM)(async (ctx) => {
      for (let i = 0; i < 3; i += 1) await notify(ctx, PLAIN, { to, recordId: about });
      await notify(ctx, PLAIN, { to: other, recordId: about });
    });
    const [first, second] = (await page(viewer(to))).items.map((n) => n.id);
    const theirs = (await page(viewer(other))).items[0]?.id ?? '';
    expect(await as(viewer(to))((ctx) => markNotificationsRead(ctx, { ids: [first ?? '', theirs] }))).toEqual({ marked: 1 });
    expect(await as(viewer(other), READ)((ctx) => unreadNotifications(ctx))).toEqual({ unread: 1 });
    expect((await page(viewer(to), { unread: true })).items.map((n) => n.id)).not.toContain(first);
    expect(second).toBeDefined();
    expect(await as(viewer(to))((ctx) => markNotificationsRead(ctx, {}))).toEqual({ marked: 2 });
    expect(await as(viewer(to), READ)((ctx) => unreadNotifications(ctx))).toEqual({ unread: 0 });
    expect((await page(viewer(to))).items.every((n) => n.readAt !== null)).toBe(true);
  });

  it('answers nothing to a principal that isn’t a person', async () => {
    expect(await as(SYSTEM, READ)((ctx) => unreadNotifications(ctx))).toEqual({ unread: 0 });
    expect((await page(SYSTEM)).items).toEqual([]);
  });

  it('is machinery: who-and-when only, no audit rows; the app can’t retarget or delete one', async () => {
    const { rows } = await su.query<{ tgname: string }>(`select tgname from pg_trigger
      where tgrelid = 'radcore.notifications'::regclass and not tgisinternal order by tgname`);
    expect(rows.map((r) => r.tgname)).toEqual(['stamp_who_when']);
    const [to, about] = [await person(), await person()];
    await as(SYSTEM)((ctx) => notify(ctx, PLAIN, { to, recordId: about }));
    const app = async (text: string) => {
      const c = await pool.connect();
      try {
        await c.query('begin');
        await c.query("set local app.principal = 'system:test'");
        await c.query(text, [to]);
        await c.query('rollback');
        return 'ok';
      } catch (e) {
        await c.query('rollback');
        return (e as { code?: string }).code ?? 'error';
      } finally {
        c.release();
      }
    };
    expect(await app("update radcore.notifications set kind = 'crm.other' where user_id = $1")).toBe('42501');
    expect(await app('delete from radcore.notifications where user_id = $1')).toBe('42501');
    expect(await app('update radcore.notifications set read_at = now() where user_id = $1')).toBe('ok');
  });
});
