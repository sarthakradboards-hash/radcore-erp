'use client';
// What the accounts screens share (RAD-100): their row types, read off lib-accounts' contracts, and how an entry is named.
import type { getJournal, listAccounts, listJournal } from '@radcore/lib-accounts/contract';
import type { EntryKind } from '@radcore/lib-common';
import type { z } from 'zod';
import { t } from '../../../lib/i18n/index.ts';

export type Account = z.output<typeof listAccounts.output>['items'][number];
export type Entry = z.output<typeof listJournal.output>['items'][number];
export type EntryDetail = z.output<typeof getJournal.output>;

/** An entry's kind in words: what posted it. */
export const kindText = (kind: EntryKind) => t(`books.kind.${kind}`);

const CODES = ['control_account', 'unbalanced', 'invalid_line', 'unknown_account', 'period_locked', 'year_not_open',
  'already_reversed', 'reversal_not_reversible', 'reverse_through_document', 'bank_matched'] as const;
/** The journal contracts' refusals in the screen's words, for Form's `messages`. */
export const JOURNAL_MESSAGES: Partial<Record<string, string>> = Object.fromEntries(CODES.map((c) => [c, t(`books.err.${c}`)]));

/** Who posted it, by name; never the raw id. */
export const postedBy = (p: Entry['postedBy']) => p.displayName ?? t('books.unknown');
