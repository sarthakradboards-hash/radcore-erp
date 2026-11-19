// The journal's own arithmetic (ADR-006 §1), apart from the database, so it's mutation-tested (RAD-96, RC-069): each
// line is a debit or a credit above zero, rounded to money; an entry has two lines or more, and its debits equal its
// credits; a reversal is the same lines with the sides swapped. journal.ts runs these before anything is read or
// written, and the database checks the balance again at commit (RA002).
import { dec, roundMoney, sum, type Money } from '@radcore/lib-common';
import { AppError } from '@radcore/lib-platform';

/** A line's two sides as a caller gives them: one of them, above zero. */
export type Sides = Readonly<{ debit?: Money; credit?: Money }>;

const refuse = (code: string, message: string): never => { throw new AppError(code, message); };

/** One line's debit and credit, rounded to money: exactly one above zero, neither below. invalid_line otherwise. */
export function lineAmounts(l: Sides): { debit: Money; credit: Money } {
  const debit = roundMoney(l.debit ?? '0');
  const credit = roundMoney(l.credit ?? '0');
  if (dec(debit).gt(0) === dec(credit).gt(0)) refuse('invalid_line', 'Each line is a debit or a credit above zero, not both');
  if (dec(debit).lt(0) || dec(credit).lt(0)) refuse('invalid_line', 'A debit or credit is never below zero');
  return { debit, credit };
}

/** Every line's amounts, for an entry of two lines or more whose debits equal its credits. unbalanced otherwise. */
export function balancedAmounts(lines: readonly Sides[]): { debit: Money; credit: Money }[] {
  if (lines.length < 2) refuse('unbalanced', 'An entry has two lines or more');
  const amounts = lines.map(lineAmounts);
  if (!sum(amounts.map((a) => a.debit)).eq(sum(amounts.map((a) => a.credit)))) {
    refuse('unbalanced', 'The debits and credits differ');
  }
  return amounts;
}

/** A posted line's sides swapped, for its reversal: its credit becomes the debit and its debit the credit. */
export const swapSides = (l: Readonly<{ debit: string; credit: string }>): { debit: Money; credit: Money } =>
  ({ debit: roundMoney(l.credit), credit: roundMoney(l.debit) });
