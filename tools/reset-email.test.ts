// RAD-32 (M1-14, ADR-001 §7a, ADR-002 §4): the password-reset request and its email job, on a real PostgreSQL as the
// runtime login. The request answers the same for any address and only queues the job. The job looks the address
// up, emails a one-time link (the token in the #fragment) at most once per address in a short window, sends nothing
// more when run again with the same job id, and makes the email outside its transaction.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { loadConfig, type Ctx } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import { testSettings } from '@radcore/test-helpers';
import pg from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { PASSWORD_RESET_EMAIL, passwordResetEmailJob, requestPasswordReset } from '../packages/lib-platform/src/auth/reset-email.ts';
import type { OpenJob } from '../packages/lib-platform/src/jobs.ts';
import type { Mail } from '../packages/lib-platform/src/mail.ts';

const url = process.env['TEST_DATABASE_URL'];
const superUrl = process.env['TEST_DATABASE_SUPERUSER_URL'];
const ORIGIN = loadConfig(testSettings(), 'api').publicOrigin;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const write = { readOnly: false, isolation: 'read committed' } as const;

describe('the password-reset request', () => {
  it('only queues the email job, with the address normalised, whatever the address', async () => {
    const send = vi.fn(async () => undefined);
    const ctx = { jobs: { send } } as unknown as Ctx;
    expect(await requestPasswordReset(ctx, { email: ' Asha.Rao@Example.IN ' })).toEqual({});
    expect(await requestPasswordReset(ctx, { email: 'nobody@example.in' })).toEqual({});
    expect(send.mock.calls).toEqual([[PASSWORD_RESET_EMAIL, { email: 'asha.rao@example.in' }],
      [PASSWORD_RESET_EMAIL, { email: 'nobody@example.in' }]]);
  });
});

describe.skipIf(!url)('the password-reset email job', () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const db = createDatabase(pool);
  afterAll(() => pool.end());
  const open: OpenJob = (principal, jobId, work) => runInTransaction(db, write, principal, `job-${jobId}`, work);

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
  async function setup(fail = false) {
    const email = `user.${randomBytes(4).toString('hex')}@example.in`;
    await asAdmin(`insert into radcore.users (email, display_name, status, password_hash, password_set_at)
      values ($1, 'Test', 'active', '$argon2id$v=19$m=19456,t=2,p=1$x$y', now())`, [email]);
    const sent: Mail[] = [];
    const mailer = { send: vi.fn(async (m: Mail) => {
      if (fail) throw new Error('SES did not answer');
      sent.push(m);
    }) };
    const job = passwordResetEmailJob({ mailer, publicOrigin: ORIGIN });
    const run = (jobId: string, address = email) => job.handle({ input: { email: address }, by: 'system:password-reset' }, jobId,
      { open, load: async () => null, alert: async () => undefined });
    const rows = async () => asAdmin<{ token_hash: string; used: boolean; sent: boolean; job_id: string | null }>(
      `select r.token_hash, r.used_at is not null as used, r.sent_at is not null as sent, r.job_id::text from radcore.password_resets r
       join radcore.users u on u.id = r.user_id where u.email = $1 order by r.created_at, r.id`, [email]);
    return { email, sent, mailer, run, rows };
  }
  const tokenIn = (m: Mail | undefined) => /\/password-reset\/new#token=([A-Za-z0-9_-]{16,512})$/m.exec(m?.text ?? '')?.[1] ?? '';

  it('emails a one-time link to the person, with the token in the fragment, and records it as sent', async () => {
    const s = await setup();
    await s.run(randomUUID());
    expect(s.sent.map((m) => m.to)).toEqual([s.email]);
    const token = tokenIn(s.sent[0]);
    expect(s.sent[0]?.text).toContain(`${ORIGIN}/password-reset/new#token=${token}`);
    expect(await s.rows()).toEqual([{ token_hash: sha256(token), used: false, sent: true, job_id: expect.any(String) }]);
  });

  it('sends nothing more when the same job runs again, even once the window has passed', async () => {
    const s = await setup();
    const id = randomUUID();
    await s.run(id);
    // Past the window, only the job id can stop a second email.
    await asAdmin("update radcore.password_resets set sent_at = now() - interval '1 hour' where job_id = $1", [id]);
    await s.run(id);
    expect(s.sent).toHaveLength(1);
    // A new request after the window does get an email.
    await s.run(randomUUID());
    expect(s.sent).toHaveLength(2);
  });

  it('sends at most one email per address in the window, and none to an address no account has', async () => {
    const s = await setup();
    await s.run(randomUUID());
    await s.run(randomUUID());
    await s.run(randomUUID(), `nobody.${randomBytes(4).toString('hex')}@example.in`);
    expect(s.sent).toHaveLength(1);
    expect(await s.rows()).toHaveLength(1);
  });

  // The auditor's SHOULD on #111: jobs for one address at the same moment can't all pass the window.
  it('sends one email when several reset jobs for one address run at once', async () => {
    const s = await setup();
    await Promise.all([s.run(randomUUID()), s.run(randomUUID()), s.run(randomUUID())]);
    expect(s.sent).toHaveLength(1);
  });

  it('after a failed send, spends the unsent link and mails a fresh one when the job is retried', async () => {
    const s = await setup(true);
    const id = randomUUID();
    await expect(s.run(id)).rejects.toThrow(/SES/);
    expect(await s.rows()).toEqual([{ token_hash: expect.any(String), used: false, sent: false, job_id: id }]);
    s.mailer.send.mockImplementation(async (m: Mail) => {
      s.sent.push(m);
    });
    await s.run(id);
    const token = tokenIn(s.sent[0]);
    expect(await s.rows()).toEqual([
      { token_hash: expect.any(String), used: true, sent: false, job_id: null },
      { token_hash: sha256(token), used: false, sent: true, job_id: id },
    ]);
  });
});
