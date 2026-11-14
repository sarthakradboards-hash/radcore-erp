// RAD-47 part 2 (RC-086, RC-031, ADR-002 Exports, ADR-001 §8b): an export from its start route to a downloaded file,
// on a real PostgreSQL 16 as the app login. The job runs as the person who started it, in a read-only repeatable-read
// snapshot, uploads only after commit, and is complete or fails `too_large`, never cut short. Each export and download
// is a security event. The file store is a fake that keeps the upload in memory; the rows come from a fixture list.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { exportContract } from '@radcore/lib-platform/contract';
import {
  defineExport, defineExportJob, EXPORT_GIVE_UP_MS, exportDownload, exportOf, exportStatus, listSecurityEventsPage,
  type Principal,
} from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import type { TxSpec } from '@radcore/db/schema';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { FileStore } from '../packages/lib-platform/src/files/store.ts';

const url = process.env['TEST_DATABASE_URL'];

it.runIf(process.env['CI'] && !url)('has its test database in CI', () => {
  expect.fail('TEST_DATABASE_URL is not set: in CI the export tests must run, not skip');
});

// A fixture list: `n` rows, served two at a time through an opaque cursor, as a module's screen list would.
const parties = exportContract('crm.fixture-parties', 'crm:export', z.object({ n: z.number().int() }), ['name', 'phone']);
const partiesExport = exportOf(parties, async (_ctx, { n }, { after }) => {
  const start = after === undefined ? 0 : Number(after);
  const items = Array.from({ length: Math.min(2, n - start) }, (_, i) => ({ name: `Party ${String(start + i)}`, phone: '+919876543210' }));
  return { items, next: start + 2 < n ? String(start + 2) : null };
});

it('refuses an export kind declared twice', () => {
  expect(() => defineExportJob([partiesExport, partiesExport])).toThrow(/declared twice/);
});

describe.skipIf(!url)('an export, start to download', () => {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  const db = createDatabase(pool);
  afterAll(async () => { await pool.end(); });
  const write = { readOnly: false, isolation: 'read committed' } as const;
  const read = { readOnly: true, isolation: 'read committed' } as const;
  const [start] = defineExport([partiesExport]);
  const job = defineExportJob([partiesExport], { cap: 5 });

  // A file store that keeps uploads in memory, so the test reads back exactly what the job uploaded.
  const uploaded = new Map<string, string>();
  const files: FileStore = {
    putFile: vi.fn(async (_kind, path) => {
      const key = `export/${randomUUID()}`;
      uploaded.set(key, await readFile(path, 'utf8'));
      return { key, size: 1 };
    }),
    downloadUrl: async (key, name) => `https://files.test/${key}?name=${name}`,
    verifyUpload: async () => ({ size: 0, contentType: '' }),
    presignUpload: async () => ({ key: '', url: '', fields: {} }),
  };

  // A person who may export, as a real user row: each test that leaves an export queued makes its own, so a person's
  // one-at-a-time rule never reaches across tests.
  const person = async (): Promise<Principal & { kind: 'user' }> => {
    const { rows } = await pool.query<{ id: string }>(`with p as (select set_config('app.principal', 'system:test', true))
      insert into radcore.users (email, display_name) select $1, 'Asha' from p returning id`, [`asha.${randomUUID()}@example.com`]);
    return { kind: 'user', userId: rows[0]?.id ?? '', permissions: ['crm:export', 'session:read', 'audit:read'] };
  };
  // The person the other tests share: each of their exports finishes, so none stays queued.
  const me = { userId: '' };
  const owner = (): Principal => ({ kind: 'user', userId: me.userId, permissions: ['crm:export', 'session:read', 'audit:read'] });
  beforeAll(async () => {
    me.userId = (await person()).userId;
  });

  // Starts an export through its route's service, as the API would, and answers its id.
  const begin = async (n: number, who: Principal = owner()) => {
    const out = await runInTransaction(db, write, who, randomUUID(), (ctx) => start?.service(ctx, { filter: { n } }, { before: undefined }) ?? Promise.reject());
    return (out as { exportId: string }).exportId;
  };
  // Runs the export job as the worker would: the enqueuer loaded as they are now, each step in its own transaction.
  const txs: (TxSpec | undefined)[] = [];
  const run = (exportId: string, holder: Principal = owner()) => job.handle(
    { input: { exportId, kind: parties.kind }, by: `user:${holder.kind === 'user' ? holder.userId : ''}` },
    randomUUID(), {
      open: (principal, jobId, work, tx) => {
        txs.push(tx);
        return runInTransaction(db, tx ?? write, principal, jobId, work, files);
      },
      load: async () => holder,
      alert: async () => undefined,
      files,
    });
  const status = (exportId: string, who: Principal = owner()) =>
    runInTransaction(db, read, who, randomUUID(), (ctx) => exportStatus(ctx, { id: exportId }));

  it('writes every row, uploads after the read-only snapshot, and is ready to download (RC-086)', async () => {
    const exportId = await begin(5);
    expect(await status(exportId)).toEqual({ status: 'queued', rows: null, failure: null });
    txs.length = 0;
    await run(exportId);
    // The snapshot, then the short write that marks it ready.
    expect(txs[0]).toEqual({ readOnly: true, isolation: 'repeatable read', statementTimeoutMs: 60_000 });
    expect(txs[1]).toBeUndefined();
    expect(await status(exportId)).toEqual({ status: 'ready', rows: 5, failure: null });
    const { url: link } = await runInTransaction(db, write, owner(), randomUUID(), (ctx) => exportDownload(ctx, { id: exportId }), files);
    const key = /export\/[0-9a-f-]{36}/.exec(link)?.[0] ?? '';
    const lines = (uploaded.get(key) ?? '').replace(/^﻿/, '').trimEnd().split('\n');
    expect(lines).toEqual(['name,phone', ...[0, 1, 2, 3, 4].map((i) => `Party ${String(i)},+919876543210`)]);
  });

  it('fails too_large past its cap and uploads nothing, rather than a truncated file', async () => {
    const exportId = await begin(6);
    const calls = vi.mocked(files.putFile).mock.calls.length;
    await run(exportId);
    expect(await status(exportId)).toEqual({ status: 'failed', rows: null, failure: 'too_large' });
    expect(vi.mocked(files.putFile).mock.calls.length).toBe(calls);
    await expect(runInTransaction(db, write, owner(), randomUUID(), (ctx) => exportDownload(ctx, { id: exportId }), files))
      .rejects.toMatchObject({ code: 'not_ready' });
  });

  it('records the export and its download as security events, with the list and count but no row data (RC-031)', async () => {
    const exportId = await begin(3);
    await run(exportId);
    await runInTransaction(db, write, owner(), randomUUID(), (ctx) => exportDownload(ctx, { id: exportId }), files);
    // The events carry the database's time, so the range is the database's India day.
    const { rows } = await pool.query<{ day: string }>("select to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as day");
    const day = rows[0]?.day ?? '';
    const { items } = await runInTransaction(db, read, owner(), randomUUID(), (ctx) => listSecurityEventsPage(ctx,
      { filter: { occurred: { from: day, to: day }, principal: me.userId }, limit: 50 }));
    expect(items.find((e) => e.kind === 'download' && e.detail.fileId === exportId)).toBeDefined();
    expect(items.some((e) => e.kind === 'export' && e.detail.what === parties.kind && e.detail.rows === 3)).toBe(true);
  });

  it("shows an export only to its starter, and refuses the job when they no longer hold the export's permission", async () => {
    const asha = await person();
    const exportId = await begin(2, asha);
    const someoneElse: Principal = { kind: 'user', userId: randomUUID(), permissions: ['session:read'] };
    await expect(status(exportId, someoneElse)).rejects.toMatchObject({ code: 'not_found' });
    await expect(run(exportId, { ...asha, permissions: ['session:read'] })).rejects.toThrow(/no longer holds crm:export/);
    expect(await status(exportId, asha)).toEqual({ status: 'queued', rows: null, failure: null });
    // One queued at a time: the refused one still waits, so another start is refused until it's given up on.
    await expect(begin(1, asha)).rejects.toMatchObject({ code: 'export_in_progress' });
    // Six hours on, it reads failed and frees the person to start again (auditor on #125).
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.advanceTimersByTime(EXPORT_GIVE_UP_MS + 60_000);
    try {
      expect(await status(exportId, asha)).toEqual({ status: 'failed', rows: null, failure: 'failed' });
      const next = await begin(1, asha);
      await run(next, asha);
      expect(await status(next, asha)).toEqual({ status: 'ready', rows: 1, failure: null });
    } finally {
      vi.useRealTimers();
    }
  });
});
