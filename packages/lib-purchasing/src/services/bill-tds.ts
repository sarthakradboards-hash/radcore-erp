// A purchase bill's TDS at posting (M5-10, RAD-158; ADR-009 §4, §7, F29): each service line with a section is deducted
// through lib-accounts' bookTds, the party's row taken after the bill's documents and before the series. The supplier is
// owed the bill less it (`owed`, the architect on RAD-158), and the rest goes to TDS Payable.
import { purchaseBillLines } from '@radcore/db/purchasing';
import { bookTds, type JournalLine } from '@radcore/lib-accounts';
import { dec, roundMoney, type Money } from '@radcore/lib-common';
import type { Ctx } from '@radcore/lib-platform';

type Line = typeof purchaseBillLines.$inferSelect;

/** Books the bill's TDS, and answers it with the entry's last lines: TDS Payable, and Creditors for the bill less it. */
export async function billTds(ctx: Ctx, b: Readonly<{ id: string; partyId: string; businessDate: string; total: Money }>, lines: readonly Line[],
  amounts: readonly ({ taxable: string; lineTotal: string } | undefined)[]): Promise<{ tds: Money; entryLines: JournalLine[] }> {
  const { total } = await bookTds(ctx, { table: 'purchase_bills', id: b.id, partyId: b.partyId, businessDate: b.businessDate }, lines.flatMap((l, i) => {
    const a = amounts[i];
    return l.tdsSectionId === null || a === undefined ? [] : [{ lineId: l.id, sectionId: l.tdsSectionId, base: a.taxable, payable: a.lineTotal,
      path: ['lines', i, 'tdsSectionId'] }];
  }));
  return { tds: total, entryLines: [...(dec(total).isZero() ? [] : [{ account: { system: 'tds_payable' as const }, credit: total }]),
    { account: { system: 'creditors' }, partyId: b.partyId, credit: roundMoney(dec(b.total).minus(dec(total))) }] };
}
