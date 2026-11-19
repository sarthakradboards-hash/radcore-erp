// What a party owes, from its Debtors lines (RAD-111, the architect's ruling; ADR-007 §5). Pure, so it's tested on its
// own. `outstanding` is the net balance: debits less credits, so an advance, a credit, already lowers it, and a party
// in advance owes less than nothing. `oldestUnpaid` is the business date of the oldest bill credits haven't covered,
// the credits paying the oldest bills first (FIFO).
// shortcut: FIFO stands in for which bill each payment paid; M3-12's allocations (ADR-005 §7a) replace it.
import { dec, roundMoney, sum, type Money } from '@radcore/lib-common';

export type DebtorsLine = Readonly<{ businessDate: string; debit: string; credit: string }>;
export type Receivable = { outstanding: Money; oldestUnpaid: string | null };

export function receivable(lines: readonly DebtorsLine[]): Receivable {
  const credits = sum(lines.map((l) => l.credit));
  const bills = lines.filter((l) => dec(l.debit).gt(0)).sort((a, b) => (a.businessDate < b.businessDate ? -1 : a.businessDate > b.businessDate ? 1 : 0));
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
  return { outstanding: roundMoney(sum(lines.map((l) => l.debit)).minus(credits)), oldestUnpaid };
}
