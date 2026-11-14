// RAD-41 (RC-047, ADR-001 §6a) on PostgreSQL 16, as the app login: a public link's token is stored only as its hash
// and is found nowhere else, not even in the audit trail; a link works for its one action and record until it expires,
// is revoked or runs out of uses; and what its holder writes is stamped with the link's id. Here in tools/ because it
// reads the tables and the audit log as an operator would.
import { createHash, randomUUID } from 'node:crypto';
import { createLink, describeError, linkPrincipal, linkUrl, listLinks, revokeLink, useLink, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import pg from 'pg';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

const url = process.env['TEST_DATABASE_URL'];
const WRITE = { readOnly: false, isolation: 'read committed' } as const;
const staff: Principal = { kind: 'user', userId: randomUUID(), permissions: ['sales:write'] };
const ACTION = 'sales.invoice_view';
// A table of radcore's that exists today, standing in for the module's own (`invoices`).
const TABLE = 'files';
const DAY = 86_400_000;

describe.skipIf(!url)('public links', () => {
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  const db = createDatabase(pool);
  afterEach(() => {
    vi.useRealTimers();
  });
  afterAll(() => pool.end());

  const as = <R>(who: Principal, work: Parameters<typeof runInTransaction<R>>[4]) => runInTransaction(db, WRITE, who, randomUUID(), work);
  // The database's own clock, so a link's expiry never depends on this machine's.
  const dbNow = async () => (await pool.query<{ now: Date }>('select now()')).rows[0]?.now ?? new Date(0);
  const made = async (over: { uses?: number; days?: number } = {}) => {
    const recordId = randomUUID();
    const expiresAt = new Date((await dbNow()).getTime() + (over.days ?? 7) * DAY);
    const link = await as(staff, (ctx) => createLink(ctx, { action: ACTION, recordTable: TABLE, recordId, expiresAt,
      ...(over.uses === undefined ? {} : { uses: over.uses }) }));
    return { ...link, recordId, expiresAt };
  };
  const holder = (token: string, action = ACTION) => as(staff, (ctx) => linkPrincipal(ctx, token, action));

  it('stores only the token\'s hash, and the token is in no row of the table or the audit trail (RC-047)', async () => {
    const { id, token } = await made();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [row] = (await pool.query<Record<string, unknown>>('select * from radcore.public_links where id = $1', [id])).rows;
    expect(row?.['token_hash']).toBe(createHash('sha256').update(token).digest('hex'));
    const audit = (await pool.query<{ changed: unknown }>("select changed from radcore.audit_log where table_name = 'public_links' "
      + 'and record_id = $1', [id])).rows;
    expect(audit).toEqual([{ changed: expect.objectContaining({ token_hash: '[redacted]', action: ACTION }) }]);
    expect(JSON.stringify([row, audit])).not.toContain(token);
    expect(linkUrl('https://erp.example.test', '/l/invoice', token)).toBe(`https://erp.example.test/l/invoice#token=${token}`);
  });

  it('gives its holder the one action on the one record, and nothing for another action or token', async () => {
    const { id, token, recordId } = await made();
    expect(await holder(token)).toEqual({ kind: 'link', linkId: id, action: ACTION, recordId, permissions: [] });
    expect([await holder(token, 'sales.estimate_view'), await holder(`${token}x`)]).toEqual([null, null]);
  });

  it('stops working when it expires, or once revoked, and says who revoked it', async () => {
    const live = await made({ days: 1 });
    vi.useFakeTimers({ now: new Date(live.expiresAt.getTime() + 1000), toFake: ['Date'] });
    expect(await holder(live.token)).toBeNull();
    vi.useRealTimers();
    const revoked = await made();
    await as(staff, (ctx) => revokeLink(ctx, revoked.id));
    // Again is fine, and changes nothing.
    await as(staff, (ctx) => revokeLink(ctx, revoked.id));
    expect(await holder(revoked.token)).toBeNull();
    expect(await as(staff, (ctx) => listLinks(ctx, ACTION, revoked.recordId))).toEqual([expect.objectContaining({
      id: revoked.id, revokedAt: expect.any(Date), createdBy: `user:${staff.kind === 'user' ? staff.userId : ''}` })]);
    await expect(as(staff, (ctx) => revokeLink(ctx, randomUUID()))).rejects.toMatchObject({ code: 'not_found' });
  });

  it('counts down a link\'s uses in the work\'s own transaction; the last one is used once, even raced', async () => {
    const { token } = await made({ uses: 1 });
    const principal = await holder(token);
    expect(principal).not.toBeNull();
    const use = () => as(principal ?? staff, (ctx) => useLink(ctx));
    const outcomes = await Promise.allSettled([use(), use()]);
    expect(outcomes.map((o) => o.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(await holder(token)).toBeNull();
    // The use was written by the link's holder, as the link's id: never a token, never a person.
    const [row] = (await pool.query<{ uses_left: number; updated_by: string }>('select uses_left, updated_by from '
      + 'radcore.public_links where token_hash = $1', [createHash('sha256').update(token).digest('hex')])).rows;
    expect(row).toEqual({ uses_left: 0, updated_by: `link:${principal?.kind === 'link' ? principal.linkId : ''}` });
  });

  it('leaves a link with any number of uses as it is, and lets no link make another', async () => {
    const { token } = await made();
    const principal = await holder(token);
    expect(principal).not.toBeNull();
    await as(principal ?? staff, (ctx) => useLink(ctx));
    expect(await holder(token)).not.toBeNull();
    const expiresAt = new Date((await dbNow()).getTime() + DAY);
    await expect(as(principal ?? staff, (ctx) => createLink(ctx, { action: ACTION, recordTable: TABLE, recordId: randomUUID(), expiresAt })))
      .rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses a link with no future expiry, one past the 30-day maximum, a bad action, or a use count that isn\'t a whole number of at least 1', async () => {
    const soon = new Date((await dbNow()).getTime() + DAY);
    const make = (over: object) => as(staff, (ctx) => createLink(ctx, { action: ACTION, recordTable: TABLE, recordId: randomUUID(), expiresAt: soon, ...over }));
    await expect(make({ expiresAt: new Date((await dbNow()).getTime() - DAY) })).rejects.toThrow('a link must expire in the future');
    await expect(make({ expiresAt: new Date((await dbNow()).getTime() + 31 * DAY) })).rejects.toThrow('at most 30 days');
    await expect(make({ action: 'Sales.View' })).rejects.toThrow('not a link action');
    await expect(make({ uses: 0 })).rejects.toThrow('at least 1');
    await expect(make({ uses: 1.5 })).rejects.toThrow('at least 1');
    // Not a table of radcore's: access_log would name nothing anyone can look up (the architect on RAD-41).
    const checkViolation = (err: unknown) => describeError(err).code === '23514';
    await expect(make({ recordTable: 'no_such_table' })).rejects.toSatisfy(checkViolation);
    await expect(make({ recordTable: 'Files; drop' })).rejects.toSatisfy(checkViolation);
  });
});
