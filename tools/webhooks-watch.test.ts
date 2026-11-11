// RAD-45 part 2 (RC-084) on PostgreSQL 16, as the app login: a webhook delivery left unprocessed for over half an hour
// is alerted on, once per webhook, by its count and its oldest delivery's id and time; a newer one and a processed one
// are not, and no alert carries a payload. Here in tools/ because it writes webhook_deliveries as an operator would.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { STUCK_AFTER_MS, watchStuckDeliveries } from '@radcore/lib-platform';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const url = process.env['TEST_DATABASE_URL'];
const system = { kind: 'system', name: 'webhook-stuck', permissions: [] } as const;
const PAYLOAD = 'personal payload that must never reach an alert';

describe.skipIf(!url)('the stuck-delivery watch', () => {
  const tag = randomBytes(4).toString('hex');
  const [a, b] = [`POST /hooks/a-${tag}`, `POST /hooks/b-${tag}`];
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const db = createDatabase(pool);
  const stored: { ids: Record<string, string>; created: Record<string, string>; at: Date } = { ids: {}, created: {}, at: new Date(0) };

  beforeAll(async () => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('app.principal', 'system:test', true)");
      for (const [name, source, processed] of [['a1', a, false], ['a2', a, false], ['done', a, true], ['b1', b, false]] as const) {
        const body = `${PAYLOAD} ${name} ${tag}`;
        const [row] = (await client.query<{ id: string }>(
          `insert into radcore.webhook_deliveries (source, delivery_id, body_sha256, payload, processed_at)
           values ($1, $2, $3, $4, case when $5 then now() end) returning id`,
          [source, randomUUID(), createHash('sha256').update(body).digest('hex'), body, processed])).rows;
        stored.ids[name] = row?.id ?? '';
      }
      await client.query('commit');
      // The rows' own clock, as the stamp trigger set it, so the test never reads this machine's.
      stored.at = (await client.query<{ at: Date }>('select max(created_at) as at from radcore.webhook_deliveries '
        + 'where source = any($1)', [[a, b]])).rows[0]?.at ?? new Date(0);
      for (const [name, id] of Object.entries(stored.ids)) {
        stored.created[name] = ((await client.query<{ at: Date }>('select created_at as at from radcore.webhook_deliveries '
          + 'where id = $1', [id])).rows[0]?.at ?? new Date(0)).toISOString();
      }
    } finally {
      client.release();
    }
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  afterAll(() => pool.end());

  // The watch as the worker runs it, at `later` ms after the rows were stored; only this file's webhooks' alerts.
  const watchAt = async (later: number) => {
    vi.useFakeTimers({ now: new Date(stored.at.getTime() + later), toFake: ['Date'] });
    const alert = vi.fn<(text: string) => Promise<void>>(async () => undefined);
    await runInTransaction(db, { readOnly: false, isolation: 'read committed' }, system, randomUUID(),
      (ctx) => watchStuckDeliveries(ctx, null, { jobId: 'watch', alert }));
    return alert.mock.calls.map(([text]) => text).filter((text) => text.includes(tag));
  };

  it('stays quiet while deliveries are younger than half an hour', async () => {
    expect(await watchAt(STUCK_AFTER_MS - 60_000)).toEqual([]);
  });

  it('alerts once per webhook with unprocessed deliveries, by count and oldest, never the payload or a processed one', async () => {
    const texts = await watchAt(STUCK_AFTER_MS + 60_000);
    // The oldest by time, then by id, as the watch orders them.
    const [oldestA = ''] = ['a1', 'a2'].sort((x, y) => `${stored.created[x]} ${stored.ids[x]}`.localeCompare(`${stored.created[y]} ${stored.ids[y]}`));
    expect(texts).toEqual([
      `webhook ${a}: 2 deliveries unprocessed for over 30 minutes; the oldest is ${stored.ids[oldestA]}, `
        + `received ${stored.created[oldestA]}`,
      `webhook ${b}: 1 delivery unprocessed for over 30 minutes; the oldest is ${stored.ids['b1']}, received ${stored.created['b1']}`,
    ]);
    expect(texts.join('\n')).not.toContain(PAYLOAD);
  });
});
