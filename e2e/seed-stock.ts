// Stock for a journey (RAD-131). The API has no stock-in route yet, so goods are received through the real stock engine, as the
// app's own login, the way the repo's database tests do (tools/stock-posting.ts); the batch ids are read back as the owner. A
// price list for a party is written the way tools/price-list-fixture.ts does: approving a version through the service puts it in
// force from today, which a dated journey can't use.
import { randomUUID } from 'node:crypto';
import { quantityString, unitPriceString } from '@radcore/lib-common';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import pg from 'pg';
import { priceListFrom } from '../tools/price-list-fixture.ts';
import { postDocument, SOURCE_TABLE } from '../tools/stock-posting.ts';

const APP_URL = process.env['E2E_DATABASE_URL'] ?? 'postgres://radcore_app@127.0.0.1:5432/radcore_e2e';
const SEED_URL = process.env['E2E_SEED_DATABASE_URL'] ?? 'postgres://radcore@127.0.0.1:5432/radcore_e2e';

/** Receives `qty` of each item into the place as one batch "B1" on `businessDate`, and answers each item's batch id. */
export async function receiveStock(items: { itemId: string; qty: string; rate: string }[], locationId: string, businessDate: string): Promise<Record<string, string>> {
  const app = new pg.Pool({ connectionString: APP_URL, max: 1 });
  const su = new pg.Pool({ connectionString: SEED_URL, max: 1 });
  try {
    const db = createDatabase(app);
    await runInTransaction(db, { readOnly: false, isolation: 'read committed' }, { kind: 'system', name: 'e2e-seed-stock', permissions: [] }, randomUUID(), async (ctx) => {
      for (const it of items) {
        await postDocument(ctx, { sourceTable: SOURCE_TABLE, sourceId: randomUUID(), businessDate, ins: [{ itemId: it.itemId, locationId,
          qty: quantityString().parse(it.qty), rate: unitPriceString().parse(it.rate), batches: [{ batchNo: 'B1', qty: quantityString().parse(it.qty) }] }] });
      }
    });
    const { rows } = await su.query<{ id: string; item_id: string }>('select id, item_id from radcore.batches where item_id = any($1)', [items.map((i) => i.itemId)]);
    return Object.fromEntries(items.map((i) => [i.itemId, rows.find((r) => r.item_id === i.itemId)!.id]));
  } finally {
    await app.end();
    await su.end();
  }
}

/** A price list in force from `from`, with these rates (item id to rate), that the party is sold from. */
export async function sellFromPriceList(partyId: string, from: string, rates: Record<string, string>): Promise<void> {
  const su = new pg.Pool({ connectionString: SEED_URL, max: 1 });
  try {
    await priceListFrom(su, from, rates, { partyId });
  } finally {
    await su.end();
  }
}

/** Opens the financial year `date` falls in (April to March), as the owner; once open it stays open, so a rerun finds it. */
export async function openYearFor(date: string): Promise<void> {
  const su = new pg.Client({ connectionString: SEED_URL });
  await su.connect();
  try {
    await su.query('begin');
    await su.query("select set_config('app.principal', 'system:e2e-seed', true)");
    const start = Number(date.slice(5, 7)) >= 4 ? `${date.slice(0, 4)}-04-01` : `${Number(date.slice(0, 4)) - 1}-04-01`;
    await su.query('insert into radcore.financial_years (start) values ($1) on conflict do nothing', [start]);
    await su.query('commit');
  } finally {
    await su.end();
  }
}
