// RAD-43 part 2 (RC-096, RC-191, ADR-001 §8) over real HTTP on the migrated database, as the app login: the upload
// routes of each kind answer only to that kind's permission; a confirmed upload is `checking` and queues the check
// job; the job checks S3 before its transaction and records ready or refused; only a ready file gets a link, and
// every answer is no-store. The S3 store is a stand-in: tools/s3.test.ts proves the real one. Here in tools/ because
// server code may not call fetch (ADR-002 L8).
import { randomUUID } from 'node:crypto';
import {
  checkUpload, defineJob, fileCheck, loadConfig, recordFileCheck, UploadRefused, type FileStore, type Principal,
} from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import { testPassword, testSettings } from '@radcore/test-helpers';
import pg from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createApp, listen } from '../apps/api/src/app.ts';
import routes from '../apps/api/src/routes/files.ts';

const url = process.env['TEST_DATABASE_URL'];
const config = () => loadConfig(testSettings({ DATABASE_URL: `postgres://radcore:${testPassword()}@127.0.0.1:1/radcore` }), 'api');
const ORIGIN = config().publicOrigin;
const logger = () => ({ info: vi.fn<(m: string) => void>(), error: vi.fn<(m: string, e?: unknown) => void>() });
// event_log.user_id is a uuid; the person needn't exist for the event to be kept.
const USER_ID = randomUUID();
const user = (permissions: string[]): Principal => ({ kind: 'user', userId: USER_ID, permissions });
const PHOTOS = user(['photo_files:read', 'photo_files:write']);
const LINK = 'https://files.example.test/bucket';

// The store's signing calls, as ctx.files sees them; verifyUpload is each check's own.
const store = (verifyUpload: FileStore['verifyUpload'] = async () => ({ size: 2048, contentType: 'image/png' })): FileStore => ({
  presignUpload: async (kind) => ({ key: `${kind}/${randomUUID()}`, url: LINK, fields: { policy: 'signed' } }),
  downloadUrl: async (key, filename) => `${LINK}/${key}?name=${encodeURIComponent(filename)}`,
  verifyUpload,
  putFile: async () => { throw new Error('not used here'); },
});

describe.skipIf(!url)('uploaded files', () => {
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  const db = createDatabase(pool);
  afterAll(() => pool.end());

  async function serve(principal: Principal, fn: (call: (method: string, path: string, body?: unknown) => Promise<Response>) => Promise<void>) {
    const app = createApp(config(), logger(), { db, authenticate: async () => principal, routes, files: store() });
    const server = await listen(app, 0, '127.0.0.1');
    try {
      await fn((method, path, body) => fetch(`http://127.0.0.1:${server.port}${path}`, {
        method, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        headers: { 'content-type': 'application/json', origin: ORIGIN, 'idempotency-key': randomUUID() },
      }));
    } finally {
      await server.stop();
    }
  }
  const row = async (id: string) => (await pool.query<{ status: string; size: number | null; kind: string }>(
    'select status, size, kind from radcore.files where id = $1', [id])).rows[0];
  const downloads = async (fileId: string) => (await pool.query<{ kind: string; user_id: string; created_by: string }>(
    "select kind, user_id, created_by from radcore.event_log where kind = 'download' and detail->>'fileId' = $1", [fileId])).rows;
  const queued = async (id: string) => (await pool.query<{ name: string; data: unknown; principal: string }>(
    "select name, data, principal from radcore.jobs_outbox where data->>'id' = $1", [id])).rows;
  // The worker's run of the check job: the store's check first, then its own transaction.
  const runCheck = (input: unknown, verify: FileStore['verifyUpload']) =>
    defineJob(fileCheck, recordFileCheck, checkUpload).handle({ input, by: 'system:file-check' }, randomUUID(), {
      open: (principal, jobId, work) => runInTransaction(db, { readOnly: false, isolation: 'read committed' }, principal, jobId, work),
      load: async () => null, alert: async () => undefined, files: store(verify),
    });
  const start = async (call: (m: string, p: string, b?: unknown) => Promise<Response>) => {
    const res = await call('POST', '/files/photo', { filename: 'bill 12.png', contentType: 'image/png' });
    return { status: res.status, body: await res.json() as { id: string; url: string; fields: Record<string, string> } };
  };

  it('starts an upload as a pending file with a presigned POST, and answers no-store (RC-191)', async () => {
    await serve(PHOTOS, async (call) => {
      const res = await call('POST', '/files/photo', { filename: 'bill 12.png', contentType: 'image/png' });
      const body = await res.json() as { id: string };
      expect([res.status, res.headers.get('cache-control'), body]).toEqual([200, 'no-store',
        { id: expect.any(String), url: LINK, fields: { policy: 'signed' } }]);
      expect(await row(body.id)).toEqual({ status: 'pending', size: null, kind: 'photo' });
    });
  });

  it.each([
    ['another kind\'s write permission', ['statement_files:write'], 'POST', '/files/photo', 403],
    ['the read permission only', ['photo_files:read'], 'POST', '/files/photo', 403],
    ['the write permission only', ['photo_files:write'], 'POST', `/files/photo/${randomUUID()}/download`, 403],
  ])('refuses a person with %s (RC-096)', async (_why, permissions, method, path, status) => {
    await serve(user(permissions), async (call) => {
      const res = await call(method, path, { filename: 'a.png', contentType: 'image/png' });
      expect([res.status, (await res.json() as { code: string }).code]).toEqual([status, 'forbidden']);
    });
  });

  it('refuses a type its kind doesn\'t take before signing anything', async () => {
    await serve(PHOTOS, async (call) => {
      const res = await call('POST', '/files/photo', { filename: 'cv.pdf', contentType: 'application/pdf' });
      expect([res.status, (await res.json() as { code: string }).code]).toEqual([400, 'invalid_input']);
    });
  });

  it('confirms once: the file is checking and the check job is queued with its row\'s key, then not_pending', async () => {
    await serve(PHOTOS, async (call) => {
      const { body } = await start(call);
      const first = await call('POST', `/files/photo/${body.id}/confirm`, {});
      expect([first.status, await first.json()]).toEqual([200, { status: 'checking' }]);
      expect(await row(body.id)).toMatchObject({ status: 'checking' });
      expect(await queued(body.id)).toEqual([{ name: 'platform.file-check', principal: `user:${USER_ID}`,
        data: { id: body.id, kind: 'photo', key: expect.stringMatching(/^photo\/[0-9a-f-]{36}$/) } }]);
      const again = await call('POST', `/files/photo/${body.id}/confirm`, {});
      expect([again.status, (await again.json() as { code: string }).code]).toEqual([422, 'not_pending']);
    });
  });

  it('gives a link only once the check has recorded the file ready, with its size', async () => {
    await serve(PHOTOS, async (call) => {
      const { body } = await start(call);
      await call('POST', `/files/photo/${body.id}/confirm`, {});
      const early = await call('POST', `/files/photo/${body.id}/download`, {});
      expect([early.status, (await early.json() as { code: string }).code]).toEqual([422, 'not_ready']);
      const [job] = await queued(body.id);
      await runCheck(job?.data, async () => ({ size: 2048, contentType: 'image/png' }));
      expect(await row(body.id)).toEqual({ status: 'ready', size: 2048, kind: 'photo' });
      const ready = await call('POST', `/files/photo/${body.id}/download`, {});
      expect([ready.status, ready.headers.get('cache-control'), await ready.json()]).toEqual([200, 'no-store',
        { url: expect.stringMatching(/^https:\/\/files\.example\.test\/bucket\/photo\/.+\?name=bill%2012\.png$/) }]);
      // RC-031: the link handed out is recorded once as a download by this person; the refusals before it weren't.
      expect(await downloads(body.id)).toEqual([{ kind: 'download', user_id: USER_ID, created_by: `user:${USER_ID}` }]);
    });
  });

  it('records a refused upload, which never gets a link; S3 being down is retried instead', async () => {
    await serve(PHOTOS, async (call) => {
      const { body } = await start(call);
      await call('POST', `/files/photo/${body.id}/confirm`, {});
      const [job] = await queued(body.id);
      await expect(runCheck(job?.data, async () => { throw new Error('S3 is unreachable'); })).rejects.toThrow('S3 is unreachable');
      expect(await row(body.id)).toMatchObject({ status: 'checking' });
      await runCheck(job?.data, async () => { throw new UploadRefused('the file doesn\'t begin the way a image/png must'); });
      expect(await row(body.id)).toEqual({ status: 'refused', size: null, kind: 'photo' });
      const res = await call('POST', `/files/photo/${body.id}/download`, {});
      expect([res.status, (await res.json() as { code: string }).code]).toEqual([422, 'upload_refused']);
      expect(await downloads(body.id)).toEqual([]);
    });
  });

  it('answers not_found for another kind\'s file, so one kind\'s permission never reaches another\'s', async () => {
    await serve(user(['photo_files:write', 'photo_files:read', 'resume_files:read']), async (call) => {
      const { body } = await start(call);
      const res = await call('POST', `/files/resume/${body.id}/download`, {});
      expect([res.status, (await res.json() as { code: string }).code]).toEqual([404, 'not_found']);
    });
  });
});
