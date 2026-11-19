// What a party owes, from its Debtors lines (RAD-111, the architect's ruling; ADR-007 §5). Pure, so it's tested on its
// own. `outstanding` is the net balance: debits less credits, so an advance, a credit, already lowers it, and a party
// in advance owes less than nothing. `oldestUnpaid` is the business date of the oldest bill credits haven't covered,
// the credits paying the oldest bills first (FIFO). A cancelled entry and its reversal leave the FIFO together: the
// reversal's credit undoes its own bill, never pays an older one (the auditor on #229).
// shortcut: FIFO stands in for which bill each payment paid; M3-12's allocations (ADR-005 §7a) replace it.
import { dec, roundMoney, sum, type Money } from '@radcore/lib-common';

/** A Debtors line, with its entry and, for a reversal, the entry it reverses. */
export type DebtorsLine = Readonly<{ businessDate: string; debit: string; credit: string; entryId: string; reversesEntryId: string | null }>;
export type Receivable = { outstanding: Money; oldestUnpaid: string | null };

export function receivable(lines: readonly DebtorsLine[]): Receivable {
  const reversed = new Set(lines.flatMap((l) => (l.reversesEntryId === null ? [] : [l.reversesEntryId])));
  const live = lines.filter((l) => l.reversesEntryId === null && !reversed.has(l.entryId));
  const credits = sum(live.map((l) => l.credit));
  const bills = live.filter((l) => dec(l.debit).gt(0)).sort((a, b) => (a.businessDate < b.businessDate ? -1 : a.businessDate > b.businessDate ? 1 : 0));
  let left = credits;
  let oldestUnpaid: string | null = null;
  for (const bill of bills) {
    if (left.gte(bill.debit)) {
      left = left.minus(bill.debit);
    } else {
      oldestUnpaid = bill.businessDate;
      break;
    }
  }
  return { outstanding: roundMoney(sum(lines.map((l) => l.debit)).minus(sum(lines.map((l) => l.credit)))), oldestUnpaid };
}
