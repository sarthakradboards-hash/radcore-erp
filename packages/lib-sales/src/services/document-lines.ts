// What quotes and orders share (M3-08, RAD-112): their party (one we sell to), their lines (items that exist, in
// quantities their units allow), their dates (ADR-007 §4).
import { getPartyById, SELLS_TO_KINDS, systemPartyId } from '@radcore/lib-accounts';
import { indiaDate } from '@radcore/lib-common';
import { AppError, type Ctx } from '@radcore/lib-platform';
import { batchNumbers, checkQuantity, itemLabels } from '@radcore/lib-stock';

export type LineIn = { itemId: string; qty: string; rate: string; discountPercent: string };

/** The Counter customer buys only through the quick bill, which bills at the counter what it delivers there (the
 * architect on RAD-115): an order of its own, or a quote that becomes one, would wait under a party no one owns. */
export async function refuseCounterCustomer(ctx: Ctx, partyId: string): Promise<void> {
  if (partyId === await systemPartyId(ctx, 'walk_in')) {
    throw new AppError('counter_customer_only', 'The Counter customer buys only through the quick bill',
      [{ path: ['partyId'], code: 'counter_customer_only', message: 'Choose a named party, or use the quick bill' }]);
  }
}

/** Today's date in India, the bound a document's date may not pass (§4). */
export const today = (): string => indiaDate(new Date());

/** The party, if it's one we sell to and switched on: a customer, dealer or franchisee. Answers its name. */
export async function sellingTo(ctx: Ctx, partyId: string): Promise<string> {
  const party = await getPartyById(ctx, { id: partyId }).catch((e: unknown) => {
    if (e instanceof AppError && e.code === 'not_found') {
      throw new AppError('unknown_party', 'There is no such party', [{ path: ['partyId'], code: 'unknown', message: 'Choose a party' }]);
    }
    throw e;
  });
  if (!party.active || !party.kinds.some((k) => (SELLS_TO_KINDS as readonly string[]).includes(k))) {
    throw new AppError('not_a_customer', `${party.name} isn’t a customer, dealer or franchisee we sell to`,
      [{ path: ['partyId'], code: 'not_a_customer', message: party.active ? 'Choose a party we sell to' : 'This party is switched off' }]);
  }
  return party.name;
}

/** Each line's item exists and its quantity fits the item's unit (RC-162), numbered from 1 in the order sent. */
export async function checkedLines(ctx: Ctx, lines: readonly LineIn[]): Promise<(LineIn & { lineNo: number })[]> {
  for (const [n, line] of lines.entries()) {
    await checkQuantity(ctx, line.itemId, line.qty).catch((e: unknown) => {
      if (e instanceof AppError && e.code === 'not_found') {
        throw new AppError('unknown_item', 'One of these items doesn’t exist', [{ path: ['lines', n, 'itemId'], code: 'unknown', message: 'Choose an item' }]);
      }
      throw e instanceof AppError ? new AppError(e.code, e.message, [{ path: ['lines', n, 'qty'], code: e.code, message: e.message }]) : e;
    });
  }
  return lines.map((l, i) => ({ ...l, lineNo: i + 1 }));
}

/** Each line with its item's SKU and name, in one read of lib-stock's items (RAD-125). An item gone since shows empty. */
export async function labelled<L extends { itemId: string }>(ctx: Ctx, lines: readonly L[]): Promise<(L & { sku: string; name: string })[]> {
  const labels = await itemLabels(ctx, lines.map((l) => l.itemId));
  return lines.map((l) => ({ ...l, sku: labels.get(l.itemId)?.sku ?? '', name: labels.get(l.itemId)?.name ?? '' }));
}

/** Each line's picked batches with their numbers (ui-2's return form, #293), read from lib-stock: "batch unknown" (a
 * negative-stock delivery's part beyond what was on hand) has none. */
export async function numberedBatches<L extends { batches: readonly { batchId: string | null; qty: string }[] }>(ctx: Ctx, lines: readonly L[]):
  Promise<(L & { batches: { batchId: string | null; batchNo: string | null; qty: string }[] })[]> {
  const numbers = await batchNumbers(ctx, [...new Set(lines.flatMap((l) => l.batches.flatMap((b) => (b.batchId === null ? [] : [b.batchId]))))]);
  return lines.map((l) => ({ ...l, batches: l.batches.map((b) => ({ ...b, batchNo: b.batchId === null ? null : numbers.get(b.batchId) ?? null })) }));
}
