// The stock tests' document (RAD-93): what a document's service does with the stock engine (ADR-006 §1). It posts the
// movements, then its own entry from what they answered, in the same transaction: transfers as `stock_transfer` (Stock
// in Hand by location), goods out as `stock_adjustment`, goods in as `opening`. The engine posts any revaluation itself.
// The year is opened first, so a test never depends on another file having opened it.
import { openFinancialYear, postEntry, type JournalLine } from '@radcore/lib-accounts';
import { dec } from '@radcore/lib-common';
import type { Ctx } from '@radcore/lib-platform';
import { postStock, type PostedMovement, type StockPosting } from '@radcore/lib-stock';

// Any table the database knows: a journal entry's source must name one (journal_entries' CHECK), as journal.test.ts's do.
export const SOURCE_TABLE = 'files';

export async function postDocument(ctx: Ctx, p: StockPosting): Promise<PostedMovement[]> {
  await openFinancialYear(ctx, p.businessDate);
  const moved = await postStock(ctx, p);
  // postStock writes transfers first, an out and an in each, then goods out, then goods in.
  const split = (p.transfers ?? []).length * 2;
  const valued = (ms: readonly PostedMovement[]) => ms.filter((m) => m.direction !== 'revalue' && dec(m.value).gt(0));
  const stock = (m: PostedMovement) => ({ account: { system: 'stock' }, itemId: m.itemId, locationId: m.locationId });
  const entry = async (kind: 'stock_transfer' | 'stock_adjustment' | 'opening', lines: JournalLine[]) => {
    if (lines.length > 0) await postEntry(ctx, { kind, businessDate: p.businessDate, source: { table: p.sourceTable, id: p.sourceId }, lines });
  };
  await entry('stock_transfer', valued(moved.slice(0, split))
    .map((m) => (m.direction === 'in' ? { ...stock(m), debit: m.value } : { ...stock(m), credit: m.value })));
  const rest = valued(moved.slice(split));
  await entry('stock_adjustment', rest.filter((m) => m.direction === 'out')
    .flatMap((m) => [{ account: { system: 'stock_adjustment' }, debit: m.value }, { ...stock(m), credit: m.value }]));
  await entry('opening', rest.filter((m) => m.direction === 'in')
    .flatMap((m) => [{ ...stock(m), debit: m.value }, { account: { system: 'opening_equity' }, credit: m.value }]));
  return moved;
}
