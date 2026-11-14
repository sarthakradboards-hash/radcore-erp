// RAD-36 (M1-14, M1-18, RC-033): inviting, deactivating and reactivating people, and the invite email, on a real
// PostgreSQL as the runtime login. The same rule as a role change holds: nobody acts on someone whose role holds keys
// they don't, and only an admin for admin. Nobody deactivates themselves; deactivating ends every session and spends
// every open link. The services queue the invite email through a recording ctx.jobs: a committed outbox row would be
// taken by outbox.test's relay, which runs alongside (tests-run-shuffled). Each test works on roles of its own (t_…).
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AppError, type Ctx, type Principal } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import pg from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { inviteEmailJob, INVITE_EMAIL } from '../packages/lib-platform/src/auth/invite-email.ts';
import { deactivatePerson, invitePerson, reactivatePerson, resendPersonInvite } from '../packages/lib-platform/src/auth/people-admin.ts';
import { principalFor } from '../packages/lib-platform/src/auth/principal.ts';
import type { OpenJob } from '../packages/lib-platform/src/jobs.ts';
import type { Mail } from '../packages/lib-platform/src/mail.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const write = { readOnly: false, isolation: 'read committed' } as const;
const SYSTEM: Principal = { kind: 'system', name: 'test', permissions: [] };
const letters = () => [...randomBytes(8)].map((b) => String.fromCharCode(97 + (b % 26))).join('');
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const reason = 'Left the company';

describe.skipIf(!url)('inviting, deactivating and reactivating people', () => {
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
  // A transaction as the handler opens it, with ctx.jobs recording what it would queue instead of writing the outbox.
  const run = <R>(principal: Principal, fn: (ctx: Ctx) => Promise<R>, queued: unknown[][] = []) =>
    runInTransaction(db, write, principal, randomUUID(), (ctx) => fn({ ...ctx,
      jobs: { send: async (job, input) => { queued.push([job.name, input]); } } }));
  const outcome = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof AppError ? e.code : String(e)));

  async function role(grants: string[]): Promise<string> {
    const key = `t_${letters()}`;
    await asAdmin("insert into radcore.roles (key, name, description) values ($1, $1, 'For people-admin.test.ts')", [key]);
    for (const permission of grants) {
      await asAdmin("insert into radcore.role_grants (role, permission, scope) values ($1, $2, 'all')", [key, permission]);
    }
    return key;
  }
  async function person(roleKey: string, status: 'active' | 'invited' = 'active'): Promise<{ id: string; email: string; as: () => Promise<Principal> }> {
    const email = `person.${letters()}@example.in`;
    const [row] = await asAdmin<{ id: string }>(`insert into radcore.users (email, display_name, status, password_hash,
      password_set_at, role) values ($1, 'Test', $2, $3, case when $3::text is null then null else now() end, $4) returning id`,
    [email, status, status === 'active' ? '$argon2id$v=19$m=19456,t=2,p=1$x$y' : null, roleKey]);
    const id = row?.id ?? '';
    return { id, email, as: async () => (await run(SYSTEM, (ctx) => principalFor(ctx, id))) ?? SYSTEM };
  }
  const admin = async () => person('admin');
  // May manage people, but isn't an admin, and lacks pii:read and pay:read, which owner holds.
  const manager = async () => person(await role(['session:read', 'users:read', 'users:write', 'audit:read']));
  const statusOf = async (id: string) => (await asAdmin<{ status: string }>('select status from radcore.users where id = $1', [id]))[0]?.status;

  it('invites someone into a role the caller may give, and queues their email, never with the address', async () => {
    const mgr = await manager();
    const plain = await role(['session:read', 'audit:read']);
    const queued: unknown[][] = [];
    const email = `New.Person.${letters()}@Example.in`;
    const { id } = await run(await mgr.as(), (ctx) => invitePerson(ctx, { email, displayName: 'New Person', role: plain }), queued);
    expect(await asAdmin('select email, status, role, role_since is not null as since from radcore.users where id = $1', [id]))
      .toEqual([{ email: email.toLowerCase(), status: 'invited', role: plain, since: true }]);
    expect(queued).toEqual([[INVITE_EMAIL.name, { userId: id }]]);
    const again = async (address: string, r: string) =>
      outcome(run(await mgr.as(), (ctx) => invitePerson(ctx, { email: address, displayName: 'X', role: r })));
    expect(await again(email.toUpperCase(), plain)).toBe('email_taken');
    // Owner holds keys the manager lacks; admin is an admin's to give.
    expect(await again(`a.${letters()}@example.in`, 'owner')).toBe('role_not_grantable');
    expect(await again(`b.${letters()}@example.in`, 'admin')).toBe('role_not_grantable');
    expect(await again(`c.${letters()}@example.in`, 'no_such_role')).toBe('invalid_input');
  });

  it('resends an invite only to someone still invited', async () => {
    const a = await admin();
    const plain = await role(['session:read']);
    const [invited, active] = [await person(plain, 'invited'), await person(plain)];
    const queued: unknown[][] = [];
    expect(await run(await a.as(), (ctx) => resendPersonInvite(ctx, { id: invited.id }), queued)).toEqual({});
    expect(queued).toEqual([[INVITE_EMAIL.name, { userId: invited.id }]]);
    expect(await outcome(run(await a.as(), (ctx) => resendPersonInvite(ctx, { id: active.id })))).toBe('not_invited');
    // An invited admin's or owner's link isn't for a manager to spend (the auditor on #143).
    const mgr = await manager();
    const [invitedAdmin, invitedOwner] = [await person('admin', 'invited'), await person('owner', 'invited')];
    expect([await outcome(run(await mgr.as(), (ctx) => resendPersonInvite(ctx, { id: invitedAdmin.id }))),
      await outcome(run(await mgr.as(), (ctx) => resendPersonInvite(ctx, { id: invitedOwner.id })))])
      .toEqual(['role_not_grantable', 'role_not_grantable']);
  });

  it('emails a one-time link to someone invited, spends their older link, and sends nothing more on a rerun', async () => {
    const plain = await role(['session:read']);
    const p = await person(plain, 'invited');
    await asAdmin("insert into radcore.invites (user_id, token_hash, expires_at) values ($1, $2, now() + interval '1 day')", [p.id, sha256('old')]);
    const sent: Mail[] = [];
    const job = inviteEmailJob({ mailer: { send: vi.fn(async (m: Mail) => { sent.push(m); }) }, publicOrigin: 'https://erp.example.in' });
    const open: OpenJob = (principal, jobId, work) => runInTransaction(db, write, principal, `job-${jobId}`, work);
    const jobId = randomUUID();
    const handle = () => job.handle({ input: { userId: p.id }, by: 'system:invites' }, jobId, { open, load: async () => null, alert: async () => undefined });
    await handle();
    await handle();
    expect(sent.map((m) => m.to)).toEqual([p.email]);
    const token = /\/invite#token=([A-Za-z0-9_-]{43})$/m.exec(sent[0]?.text ?? '')?.[1] ?? '';
    expect(await asAdmin<{ token_hash: string; used: boolean; sent: boolean }>(`select token_hash, used_at is not null as used,
      sent_at is not null as sent from radcore.invites where user_id = $1 order by created_at, id`, [p.id]))
      .toEqual([{ token_hash: sha256('old'), used: true, sent: false }, { token_hash: sha256(token), used: false, sent: true }]);
    // Someone no longer invited gets nothing.
    await asAdmin("update radcore.users set status = 'disabled' where id = $1", [p.id]);
    await job.handle({ input: { userId: p.id }, by: 'system:invites' }, randomUUID(), { open, load: async () => null, alert: async () => undefined });
    expect(sent).toHaveLength(1);
  });

  it('deactivates someone: no session, no open link, then reactivates them', async () => {
    const a = await admin();
    const plain = await role(['session:read']);
    const p = await person(plain);
    await asAdmin(`insert into radcore.sessions (user_id, token_hash, device, idle_expires_at, absolute_expires_at)
      values ($1, $2, 'test', now() + interval '1 hour', now() + interval '2 hours')`, [p.id, randomBytes(32).toString('hex')]);
    await asAdmin("insert into radcore.password_resets (user_id, token_hash, expires_at) values ($1, $2, now() + interval '1 hour')",
      [p.id, randomBytes(32).toString('hex')]);
    expect(await run(await a.as(), (ctx) => deactivatePerson(ctx, { id: p.id, reason }))).toEqual({ sessionsEnded: 1 });
    expect([await statusOf(p.id), await p.as()]).toEqual(['disabled', SYSTEM]);
    expect(await asAdmin('select ended_reason from radcore.sessions where user_id = $1', [p.id])).toEqual([{ ended_reason: 'deactivated' }]);
    expect(await asAdmin('select used_at is not null as used from radcore.password_resets where user_id = $1', [p.id])).toEqual([{ used: true }]);
    expect(await outcome(run(await a.as(), (ctx) => deactivatePerson(ctx, { id: p.id, reason })))).toBe('already_disabled');
    expect(await run(await a.as(), (ctx) => reactivatePerson(ctx, { id: p.id, reason }))).toEqual({ status: 'active' });
    expect(await outcome(run(await a.as(), (ctx) => reactivatePerson(ctx, { id: p.id, reason })))).toBe('not_disabled');
  });

  it('deactivates someone invited who never set a password, and reactivates them as invited', async () => {
    const a = await admin();
    const p = await person(await role(['session:read']), 'invited');
    await asAdmin("insert into radcore.invites (user_id, token_hash, expires_at) values ($1, $2, now() + interval '1 day')",
      [p.id, randomBytes(32).toString('hex')]);
    expect(await run(await a.as(), (ctx) => deactivatePerson(ctx, { id: p.id, reason }))).toEqual({ sessionsEnded: 0 });
    expect(await asAdmin('select used_at is not null as used from radcore.invites where user_id = $1', [p.id])).toEqual([{ used: true }]);
    expect(await run(await a.as(), (ctx) => reactivatePerson(ctx, { id: p.id, reason }))).toEqual({ status: 'invited' });
  });

  it('refuses your own account, a role whose keys you lack, and admin unless you are one', async () => {
    const mgr = await manager();
    const [owner, adm] = [await person('owner'), await admin()];
    const as = await mgr.as();
    expect(await outcome(run(as, (ctx) => deactivatePerson(ctx, { id: mgr.id, reason })))).toBe('own_account');
    expect(await outcome(run(as, (ctx) => deactivatePerson(ctx, { id: owner.id, reason })))).toBe('role_not_grantable');
    expect(await outcome(run(as, (ctx) => deactivatePerson(ctx, { id: adm.id, reason })))).toBe('role_not_grantable');
    await asAdmin("update radcore.users set status = 'disabled' where id = $1", [owner.id]);
    expect(await outcome(run(as, (ctx) => reactivatePerson(ctx, { id: owner.id, reason })))).toBe('role_not_grantable');
    expect(await statusOf(owner.id)).toBe('disabled');
  });

  it('lets two admins deactivating each other at once take turns: the second is no longer signed in', async () => {
    const [x, y] = [await admin(), await admin()];
    const [xa, ya] = [await x.as(), await y.as()];
    const results = await Promise.all([outcome(run(xa, (ctx) => deactivatePerson(ctx, { id: y.id, reason }))),
      outcome(run(ya, (ctx) => deactivatePerson(ctx, { id: x.id, reason })))]);
    expect(results.toSorted()).toEqual(['ok', 'signed_out']);
    expect([await statusOf(x.id), await statusOf(y.id)].toSorted()).toEqual(['active', 'disabled']);
  });
});
