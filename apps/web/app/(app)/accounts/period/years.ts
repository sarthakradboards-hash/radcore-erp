// What the period lock screens share (RAD-168 on RAD-157's routes): which year offers a close or a reopen, what a
// `period-unlock` request asks (read from its approval's version), and their refusals in words. The server re-checks
// all of it; this only offers.
import { dateString, financialYear } from '@radcore/lib-common';
import type { getPeriodContract } from '@radcore/lib-accounts/contract';
import { z } from 'zod';
import { t } from '../../../../lib/i18n/index.ts';

const CODES = ['lock_in_future', 'lock_not_forward', 'lock_not_back', 'year_closed', 'year_not_closed', 'later_year_closed',
  'lock_before_year_end', 'earlier_year_open', 'checklist_incomplete', 'books_check_failed', 'account_inactive', 'series_full',
  'own_request', 'approver_too_new', 'version_changed', 'not_pending'] as const;
/** The period lock contracts' refusals in the screen's words, for Form's `messages` (also the unlock approvals page's). */
export const PERIOD_MESSAGES: Partial<Record<string, string>> = Object.fromEntries(CODES.map((c) => [c, t(`books.period.err.${c}`)]));

export type Year = z.output<typeof getPeriodContract.output>['years'][number];

/**
 * The action each year offers: a close for the earliest open year that has ended (a close goes in order), a reopen for the
 * latest closed one (only it can be reopened), nothing for the rest.
 */
export function yearAction(years: readonly Year[], start: string, today: string): 'close' | 'reopen' | null {
  const closed = years.filter((y) => y.closed !== null).map((y) => y.start).toSorted();
  if (closed.at(-1) === start) return 'reopen';
  const firstOpen = years.filter((y) => y.closed === null).map((y) => y.start).toSorted()[0];
  return firstOpen === start && financialYear(start).end < today ? 'close' : null;
}

/** A `period-unlock` approval's version (lib-accounts' periodUnlockSpec): what approving it does. */
export const unlockVersion = z.object({
  kind: z.enum(['move_back', 'reopen_year']), through: dateString(), reason: z.string(), lockedThrough: dateString().nullable(),
});
export type UnlockVersion = z.output<typeof unlockVersion>;

/** The version as the screen shows it, or null when it isn't one (then it can only be rejected). */
export const readUnlock = (version: unknown): UnlockVersion | null => unlockVersion.safeParse(version).data ?? null;
