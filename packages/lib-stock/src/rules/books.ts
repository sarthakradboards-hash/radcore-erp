// The books check's comparison (RAD-95, ADR-006 §7, RC-063): pure, on figures one snapshot read. As at a date, the
// trial balance balances and Stock in Hand equals the stock ledger for every item and place. On the current position,
// an empty place holds no value and its batches add up to its quantity. Healthy books answer no problems.
// shortcut: §7's GRNI, GDNI, job-work and party comparisons, and serialised units, join as their documents and
// `units` land (M2-06, M3, M4); the check then moves to the lowest library that reads them all (ADR-001 §3).
import { dec, roundMoney } from '@radcore/lib-common';
import type { BooksCheck } from '../contract.ts';

type Place = { readonly itemId: string; readonly locationId: string };
export type BooksFigures = {
  /** Every journal line's debits and credits, as at the date. */
  readonly trial: { readonly debit: string; readonly credit: string };
  /** Stock in Hand per item and place, debits less credits, as at the date. */
  readonly books: readonly (Place & { readonly value: string })[];
  /** The stock ledger per item and place, as at the date. */
  readonly ledger: readonly (Place & { readonly qty: string; readonly value: string })[];
  /** The stock ledger per item and place now. */
  readonly current: readonly (Place & { readonly qty: string; readonly value: string })[];
  /** The batches' quantities per item and place now. */
  readonly batches: readonly (Place & { readonly qty: string })[];
};
export type BooksProblem = { check: BooksCheck; itemId: string | null; locationId: string | null; message: string };

const keyOf = (p: Place) => `${p.itemId}|${p.locationId}`;
/** Every place either list names, in one order, with each list's figure there (zero where it has none). */
function pair<A extends Place, B extends Place>(as: readonly A[], bs: readonly B[], a: (x: A) => string, b: (x: B) => string) {
  const places = new Map<string, Place>([...as, ...bs].map((p) => [keyOf(p), { itemId: p.itemId, locationId: p.locationId }]));
  const left = new Map(as.map((x) => [keyOf(x), a(x)]));
  const right = new Map(bs.map((x) => [keyOf(x), b(x)]));
  return [...places].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
    .map(([key, place]) => ({ ...place, left: left.get(key) ?? '0', right: right.get(key) ?? '0' }));
}

export function booksProblems(f: BooksFigures): BooksProblem[] {
  const problems: BooksProblem[] = [];
  if (!dec(f.trial.debit).eq(dec(f.trial.credit))) {
    problems.push({ check: 'trial_balance', itemId: null, locationId: null,
      message: `Debits come to ${roundMoney(f.trial.debit)} and credits to ${roundMoney(f.trial.credit)}` });
  }
  for (const p of pair(f.books, f.ledger, (b) => b.value, (l) => l.value)) {
    if (!dec(p.left).eq(dec(p.right))) {
      problems.push({ check: 'stock_value', itemId: p.itemId, locationId: p.locationId,
        message: `Stock in Hand shows ${roundMoney(p.left)} for this item and place, the stock ledger ${roundMoney(p.right)}` });
    }
  }
  for (const c of f.current) {
    if (dec(c.qty).eq(0) && !dec(c.value).eq(0)) {
      problems.push({ check: 'empty_place_value', itemId: c.itemId, locationId: c.locationId,
        message: `Nothing is in this place, yet it holds ${roundMoney(c.value)}` });
    }
  }
  for (const p of pair(f.current, f.batches, (c) => c.qty, (b) => b.qty)) {
    if (!dec(p.left).eq(dec(p.right))) {
      problems.push({ check: 'batches', itemId: p.itemId, locationId: p.locationId,
        message: `This place holds ${dec(p.left).toString()}, but its batches add up to ${dec(p.right).toString()}` });
    }
  }
  return problems;
}
