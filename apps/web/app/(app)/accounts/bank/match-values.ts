// What the matching screen words (RAD-168 on RAD-165's #454; ADR-009 §12): each book line a statement line may match, as the
// server ranks them (same signed amount, within the match days, by reference, then the party in the narration, then the
// nearest date), and the matching contracts' refusals.
import { dec, ENTRY_KINDS, formatDate, formatMoney, sum, type EntryKind } from '@radcore/lib-common';
import type { listBookLinesContract, listMatchCandidatesContract } from '@radcore/lib-accounts/contract';
import type { z } from 'zod';
import { t } from '../../../../lib/i18n/index.ts';

type Candidate = z.output<typeof listMatchCandidatesContract.output>['candidates'][number];
type BookLine = z.output<typeof listBookLinesContract.output>['items'][number];

const CODES = ['already_matched', 'entry_reversed', 'match_unbalanced', 'not_this_account', 'not_matched', 'statement_in_use'] as const;
/** The matching contracts' refusals in the screen's words. */
export const MATCH_MESSAGES: Partial<Record<string, string>> = Object.fromEntries(CODES.map((c) => [c, t(`books.bank.err.${c}`)]));

const isKind = (k: string): k is EntryKind => (ENTRY_KINDS as readonly string[]).includes(k);

/** "PAY/26-27/00012, Payment made, 3 Nov 2026, Shree Transport: by reference" and so on, best reason first. */
export function candidateLabel(c: Candidate): string {
  const why = c.byReference ? t('books.bank.match.byReference')
    : c.byParty === 'whole' ? t('books.bank.match.byParty')
      : c.byParty === 'word' ? t('books.bank.match.byWord')
        : t(c.daysApart === 1 ? 'books.bank.match.day' : 'books.bank.match.days', { n: String(c.daysApart) });
  const parts = [c.entryNumber, isKind(c.kind) ? t(`books.kind.${c.kind}`) : c.kind, formatDate(c.businessDate), ...(c.party === null ? [] : [c.party])];
  return `${parts.join(', ')}: ${why}`;
}

/** A book line to tick in a several-line match: "JV/26-27/00012, Payment made, 3 Nov 2026, Shree Transport: ₹4,500.00 out". */
export function bookLineLabel(b: BookLine): string {
  const parts = [b.entryNumber, isKind(b.kind) ? t(`books.kind.${b.kind}`) : b.kind, formatDate(b.businessDate), ...(b.party === null ? [] : [b.party])];
  return `${parts.join(', ')}: ${t(b.direction === 'in' ? 'books.bank.several.in' : 'books.bank.several.out', { amount: formatMoney(b.amount) })}`;
}

type Moved = { direction: 'in' | 'out'; amount: string };
const signed = (m: Moved) => (m.direction === 'in' ? m.amount : dec(m.amount).neg().toFixed(2));

/**
 * The two sides of a several-line match, each the signed sum of what's ticked (money into the account counts up), and
 * whether they come to the same: the screen offers the match only then; the server judges it again (match_unbalanced).
 */
export function matchTotals(statement: readonly Moved[], book: readonly Moved[]) {
  const s = sum(statement.map(signed));
  const b = sum(book.map(signed));
  return { statement: s.toFixed(2), book: b.toFixed(2), difference: s.minus(b).toFixed(2), balanced: statement.length > 0 && book.length > 0 && s.eq(b) };
}

/** A signed total in words: "₹7,500.00 out", "₹900.00 in", "₹0.00". */
export const movedWords = (signedTotal: string) => {
  const x = dec(signedTotal);
  if (x.isZero()) return formatMoney('0.00');
  return t(x.gt(0) ? 'books.bank.several.in' : 'books.bank.several.out', { amount: formatMoney(x.abs().toFixed(2)) });
};
