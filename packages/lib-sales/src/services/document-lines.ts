// What quotes and orders share (M3-08, RAD-112): their party (one we sell to), their lines (items that exist, in
// quantities their units allow), their dates (ADR-007 §4).
import { getPartyById } from '@radcore/lib-accounts';
import { indiaDate } from '@radcore/lib-common';
import { AppError, type Ctx } from '@radcore/lib-platform';
import { checkQuantity } from '@radcore/lib-stock';

export type LineIn = { itemId: string; qty: string; rate: string; discountPercent: string };

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
  if (!party.active || !party.kinds.some((k) => k === 'customer' || k === 'dealer' || k === 'franchisee')) {
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
