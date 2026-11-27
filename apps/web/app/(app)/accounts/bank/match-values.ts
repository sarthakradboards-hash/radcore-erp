// What the matching screen words (RAD-168 on RAD-165's #454; ADR-009 §12): each book line a statement line may match, as the
// server ranks them (same signed amount, within the match days, by reference, then the party in the narration, then the
// nearest date), and the matching contracts' refusals.
import { ENTRY_KINDS, formatDate, type EntryKind } from '@radcore/lib-common';
import type { listMatchCandidatesContract } from '@radcore/lib-accounts/contract';
import type { z } from 'zod';
import { t } from '../../../../lib/i18n/index.ts';

type Candidate = z.output<typeof listMatchCandidatesContract.output>['candidates'][number];

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
