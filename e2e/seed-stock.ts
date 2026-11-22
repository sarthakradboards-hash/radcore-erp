// Stock for a journey (RAD-131). The API has no stock-in route yet, so goods are received through the real stock engine, as the
// app's own login, the way the repo's database tests do (tools/stock-posting.ts); the batch ids are read back as the owner. The
// financial year is opened by the real service, in the same way.
import { randomUUID } from 'node:crypto';
import { openFinancialYear } from '@radcore/lib-accounts';
import { quantityString, unitPriceString } from '@radcore/lib-common';
import { createDatabase, runInTransaction } from '@radcore/lib-platform/runtime';
import pg from 'pg';
import { postDocument, SOURCE_TABLE } from '../tools/stock-posting.ts';

const APP_URL = process.env['E2E_DATABASE_URL'] ?? 'postgres://radcore_app@127.0.0.1:5432/radcore_e2e';
const SEED_URL = process.env['E2E_SEED_DATABASE_URL'] ?? 'postgres://radcore@127.0.0.1:5432/radcore_e2e';

/** Receives `qty` of each item into the place as one batch "B1" on `businessDate` (a date in a year that is open), and answers each item's batch id. */
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

/** Opens the financial year `date` falls in, through the real service as the app's own login; opening one already open does nothing. */
export async function openYearFor(date: string): Promise<void> {
  const app = new pg.Pool({ connectionString: APP_URL, max: 1 });
  try {
    await runInTransaction(createDatabase(app), { readOnly: false, isolation: 'read committed' }, { kind: 'system', name: 'e2e-seed-stock', permissions: [] }, randomUUID(),
      (ctx) => openFinancialYear(ctx, date));
  } finally {
    await app.end();
  }
}
