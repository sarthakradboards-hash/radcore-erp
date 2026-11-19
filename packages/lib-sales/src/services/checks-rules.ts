// The sale checks' arithmetic (M3-07, RAD-111), apart from the database, so it's unit- and mutation-tested: whether a
// party is over its credit limit or has bills overdue (RC-061), whether a line is sold below its cost (RC-131), and
// how big its discount is. checks.ts reads the figures (the party's terms and balance, each item's cost, the role's
// discount limit) and asks these; every sale stage asks the same ones.
import { addDays, dec, type DecimalInput } from '@radcore/lib-common';

/** Why a sale needs someone else's approval. A line's issues name the line by its index. */
export type CheckIssue =
  | { code: 'over_limit' }
  | { code: 'overdue' }
  | { code: 'below_cost'; line: number }
  | { code: 'cost_unknown'; line: number }
  | { code: 'over_discount'; line: number };

/** A party's credit position for one sale: what it owes, its terms, and what this sale adds. */
export type CreditFigures = Readonly<{
  /** The most it may owe; null: no limit is set, so no amount is too much. */
  limit: DecimalInput | null;
  /** What it owes now, before this sale: its net Debtors balance. */
  outstanding: DecimalInput;
  /** Goods delivered to it and not yet invoiced: owed all the same (the architect on RAD-111). */
  notInvoiced: DecimalInput;
  /** What this sale adds to what it owes: its unpaid part. */
  adds: DecimalInput;
  /** Days a bill may stay unpaid; null: none, so a bill is due the day it's made. */
  creditDays: number | null;
  /** The business date of its oldest bill still unpaid, or null when it owes nothing. */
  oldestUnpaid: string | null;
  /** The sale's business date. */
  on: string;
}>;

/** Whether the party ends over its limit after this sale (what it owes, what it has been delivered and not billed, and
 * this sale), and whether a bill of its is already past its days. */
export function creditResult(f: CreditFigures): { after: string; overLimit: boolean; overdue: boolean } {
  const after = dec(f.outstanding).plus(dec(f.notInvoiced)).plus(dec(f.adds));
  return {
    after: after.toFixed(2),
    overLimit: f.limit !== null && after.gt(dec(f.limit)),
    overdue: f.oldestUnpaid !== null && addDays(f.oldestUnpaid, f.creditDays ?? 0) < f.on,
  };
}

/** Whether a line sells below its cost. Both are per unit and before GST; a cost of null (none on hand, no purchase
 * price) can't be compared, so it's its own answer, never a pass. */
export function costResult(rate: DecimalInput, cost: DecimalInput | null): 'ok' | 'below_cost' | 'cost_unknown' {
  if (cost === null) return 'cost_unknown';
  return dec(rate).lt(dec(cost)) ? 'below_cost' : 'ok';
}

/** A line's discount off its list rate, in percent to 6 places, for display: 0 when there's no list rate or it isn't
 * below it. Whether it's too much is overDiscount's, on the exact figures. */
export function discountPercent(listRate: DecimalInput | null, rate: DecimalInput): string {
  if (listRate === null || dec(listRate).lte(0) || dec(rate).gte(dec(listRate))) return '0.000000';
  return dec(listRate).minus(dec(rate)).div(dec(listRate)).times(100).toDecimalPlaces(6).toFixed(6);
}

/** Whether a line's rate is further below its list rate than the person's limit allows: below list × (1 − limit/100),
 * worked exactly, never through the rounded percent (the architect on RAD-111). No list rate, no discount to judge. */
export function overDiscount(listRate: DecimalInput | null, rate: DecimalInput, allowedPercent: DecimalInput): boolean {
  if (listRate === null) return false;
  return dec(rate).lt(dec(listRate).times(dec('100').minus(dec(allowedPercent))).div('100'));
}

/** Every issue of a sale, in order: the credit ones first, then each line's. */
export function issuesOf(credit: { overLimit: boolean; overdue: boolean },
  lines: readonly { cost: 'ok' | 'below_cost' | 'cost_unknown'; overDiscount: boolean }[]): CheckIssue[] {
  return [
    ...(credit.overLimit ? [{ code: 'over_limit' } as const] : []),
    ...(credit.overdue ? [{ code: 'overdue' } as const] : []),
    ...lines.flatMap((l, line): CheckIssue[] => [
      ...(l.cost === 'ok' ? [] : [{ code: l.cost, line }]),
      ...(l.overDiscount ? [{ code: 'over_discount' as const, line }] : []),
    ]),
  ];
}
