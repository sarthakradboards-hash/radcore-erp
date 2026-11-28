// The period lock and year close (M5-09, RAD-157; ADR-009 §6, §9), re-exported by ./contract. Under books:lock, with a
// move back or a reopen approved by someone else holding books:unlock (D-06). Like every contract file it imports only
// zod and lib-common (D5).
import { dateString, defineContract, idString, momentString, principalOut, reason } from '@radcore/lib-common';
import { approvalContracts } from '@radcore/lib-platform/contract';
import { z } from 'zod';

const read = { readOnly: true, isolation: 'read committed' } as const;
const write = { readOnly: false, isolation: 'read committed' } as const;
// What a close or a reopen can meet in the journal engine (tools/permission-reach.test.ts's ENGINE_ERRORS) and numbering.
const ENGINE = ['account_inactive', 'period_locked', 'month_filed', 'year_not_open', 'series_full'] as const;
// What a request, and its approval again, checks of the years (ADR-009 §6).
const UNLOCK = ['lock_not_back', 'year_closed', 'year_not_closed', 'later_year_closed'] as const;

/** GET /books/period (books:lock): where the lock stands, each opened year newest first with its live close, and the
 * year-end checklist a close ticks (the setting `accounts.year_end_checklist`). */
export const getPeriodContract = defineContract({
  method: 'GET', path: '/books/period', auth: 'session', perm: 'books:lock', tx: read,
  input: z.object({}),
  output: z.object({
    lockedThrough: dateString().nullable(),
    years: z.array(z.object({ start: dateString(), label: z.string(),
      closed: z.object({ id: idString(), at: momentString(), by: principalOut }).nullable() })),
    checklist: z.array(z.string()),
  }),
});

/** POST /books/period/lock (books:lock): moves the lock forward to `through`, a day before today. It waits for the
 * postings in flight (RC-163). A move back is a request (POST /books/period/unlock-requests). */
export const lockPeriodContract = defineContract({
  method: 'POST', path: '/books/period/lock', auth: 'session', perm: 'books:lock', tx: write,
  input: z.object({ through: dateString(), reason: reason() }),
  output: z.object({ lockedThrough: dateString() }),
  errors: ['lock_in_future', 'lock_not_forward'],
});

/** POST /books/period/unlock-requests (books:lock): asks to move the lock back to `through` (`move_back`), or to reopen
 * the latest closed year with the lock going back to `through` inside it (`reopen_year`). Someone else holding
 * books:unlock decides it (`period-unlock` approvals). */
export const askUnlockContract = defineContract({
  method: 'POST', path: '/books/period/unlock-requests', auth: 'session', perm: 'books:lock', tx: write,
  input: z.object({ kind: z.enum(['move_back', 'reopen_year']), through: dateString(), reason: reason() }),
  output: z.object({ id: idString(), versionHash: z.string() }),
  errors: [...UNLOCK],
});

/** A move back or a reopen, decided under books:unlock, never by its asker (D-06). A request the lock moved past is
 * stale (`version_changed`); a reopen reverses the year's close, dated its 31 March. */
export const periodUnlockApproval = approvalContracts('period-unlock', 'books:unlock', [...UNLOCK, ...ENGINE]);

/** POST /books/years/:start/close (books:lock): closes the year starting `start` (F20), once the lock is at or past its
 * 31 March, the year before is closed, the books check passes as at that day, and every checklist item is ticked.
 * Posts the `year_close` entry, moving the year's income and expenses to Retained Earnings. */
export const closeYearContract = defineContract({
  method: 'POST', path: '/books/years/:start/close', auth: 'session', perm: 'books:lock', tx: write,
  input: z.object({ start: dateString().refine((d) => d.endsWith('-04-01'), 'A financial year starts on 1 April'),
    ticks: z.array(z.string().trim().min(1).max(200)).max(50), reason: reason() }),
  output: z.object({ id: idString(), entry: z.string().nullable() }),
  errors: ['lock_before_year_end', 'earlier_year_open', 'year_closed', 'checklist_incomplete', 'books_check_failed', ...ENGINE],
});
