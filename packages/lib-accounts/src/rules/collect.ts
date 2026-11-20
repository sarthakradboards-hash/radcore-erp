// A party's statement and what there is to collect (RAD-119, M3-15), from its Debtors lines and what's been paid on each
// bill: its allocations and credits (v_document_paid, ADR-005 §7a). Pure, so it's tested on its own.
// - A bill is a document registered as a receivable charge; it's due its credit days after its date.
// - A bill's open amount is its Debtors debit less what's paid on it. One paid in full, or cancelled (its entry and the
//   reversal leave together), isn't open.
// - What isn't on a bill (an opening balance, a manual journal, a receipt applied to nothing) is the balance less the
//   open bills, so the two always add up to what the party owes.
import { addDays, dec, roundMoney, sum, type Money } from '@radcore/lib-common';

/** One of a party's Debtors lines, with its entry, the entry's document, and for a reversal, the entry it reverses. */
export type PartyLine = Readonly<{
  entryId: string; reversesEntryId: string | null; entryNumber: string; documentNumber: string | null; kind: string; businessDate: string;
  sourceTable: string; sourceId: string; debit: string; credit: string;
}>;
export type OpenBill = { table: string; id: string; entryNumber: string; documentNumber: string | null; date: string; due: string; amount: Money; paid: Money; open: Money;
  overdue: boolean };
export type ToCollect = { outstanding: Money; overdue: Money; oldestDue: string | null; notOnABill: Money };

const live = (lines: readonly PartyLine[]) => {
  const reversed = new Set(lines.flatMap((l) => (l.reversesEntryId === null ? [] : [l.reversesEntryId])));
  return lines.filter((l) => l.reversesEntryId === null && !reversed.has(l.entryId));
};
const net = (lines: readonly PartyLine[]) => roundMoney(sum(lines.map((l) => l.debit)).minus(sum(lines.map((l) => l.credit))));

/** The bills not yet paid in full, oldest first: each one's amount, what's paid on it, and when it's due. */
export function openBills(lines: readonly PartyLine[], o: Readonly<{ isBill: (table: string) => boolean; paid: (table: string, id: string) => string;
  creditDays: number; today: string }>): OpenBill[] {
  const bills = new Map<string, OpenBill>();
  for (const l of live(lines)) {
    if (!o.isBill(l.sourceTable) || !dec(l.debit).gt(0)) continue;
    const key = `${l.sourceTable}:${l.sourceId}`;
    const was = bills.get(key);
    const amount = roundMoney(dec(was?.amount ?? '0').plus(l.debit));
    const paid = roundMoney(o.paid(l.sourceTable, l.sourceId));
    const dueOn = addDays(l.businessDate, o.creditDays);
    bills.set(key, { table: l.sourceTable, id: l.sourceId, entryNumber: l.entryNumber, documentNumber: l.documentNumber, date: l.businessDate, due: dueOn, amount, paid,
      open: roundMoney(dec(amount).minus(paid)), overdue: dueOn.localeCompare(o.today) < 0 });
  }
  return [...bills.values()].filter((b) => dec(b.open).gt(0)).toSorted((a, b) => a.date.localeCompare(b.date));
}

/** The party's balance, what of it is overdue and since when, and what isn't on a bill. */
export function collect(lines: readonly PartyLine[], bills: readonly OpenBill[]): ToCollect {
  const outstanding = net(lines);
  const due = bills.filter((b) => b.overdue);
  return { outstanding, overdue: roundMoney(sum(due.map((b) => b.open))), oldestDue: due[0]?.due ?? null,
    notOnABill: roundMoney(dec(outstanding).minus(sum(bills.map((b) => b.open)))) };
}

/** The lines from `from` to `to`, each with the balance after it, between the balance before `from` and the last one. */
export function statement(lines: readonly PartyLine[], from: string, to: string) {
  const opening = net(lines.filter((l) => l.businessDate < from));
  let balance = dec(opening);
  const shown = lines.filter((l) => l.businessDate >= from && l.businessDate <= to).map((l) => {
    balance = balance.plus(l.debit).minus(l.credit);
    return { ...l, debit: roundMoney(l.debit), credit: roundMoney(l.credit), balance: roundMoney(balance) };
  });
  return { opening, lines: shown, closing: roundMoney(balance) };
}
