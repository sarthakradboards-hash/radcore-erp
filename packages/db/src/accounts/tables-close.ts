// lib-accounts' period lock and year close (M5-09, RAD-157; ADR-009 §6, §7). SQL zone (ADR-002 §3): `sql` only as a
// CHECK's argument.
import { isNull, sql } from 'drizzle-orm';
import { check, date, index, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { boundedText, id, json, radcoreTable } from '../columns.ts';
import { financialYears } from './tables.ts';

/**
 * A request to move the period lock back, or to reopen the latest closed year with the lock going back to `through`
 * (ADR-009 §6; D-06). Asked under books:lock and approved by someone else holding books:unlock (`period-unlock`
 * approvals). `lock_was` is where the lock stood when it was asked: the version approved names the lock as it is now,
 * so a request the lock moved past is stale (`version_changed`). `applied_at` is set once, when the approval moves it.
 */
export const periodUnlockRequests = radcoreTable('period_unlock_requests', {
  id: id(),
  kind: text().notNull(),
  through: date({ mode: 'string' }).notNull(),
  reason: boundedText({ max: 500 }).notNull(),
  lockWas: date({ mode: 'string' }).notNull(),
  appliedAt: timestamp({ withTimezone: true }),
}, (t) => [
  check('ck_period_unlock_requests_kind', sql`${t.kind} in ('move_back', 'reopen_year')`),
  check('ck_period_unlock_requests_back', sql`${t.through} < ${t.lockWas}`),
]);

/**
 * A year's close (F20; ADR-009 §6): who closed it and the year-end checklist they ticked. Its `year_close` entry names
 * this row as its source, so a year reopened and closed again posts a new entry. One live close a year: a reopened one
 * keeps its row, with the request that reopened it.
 */
export const yearCloses = radcoreTable('year_closes', {
  id: id(),
  fyStart: date({ mode: 'string' }).notNull().references(() => financialYears.start, { onDelete: 'restrict' }),
  ticks: json().notNull(),
  reopenedAt: timestamp({ withTimezone: true }),
  reopenedBy: uuid().references(() => periodUnlockRequests.id, { onDelete: 'restrict' }),
}, (t) => [
  check('ck_year_closes_reopened', sql`(${t.reopenedAt} is null) = (${t.reopenedBy} is null)`),
  uniqueIndex('ux_year_closes_live').on(t.fyStart).where(isNull(t.reopenedAt)),
  index('ix_year_closes_fy_start').on(t.fyStart),
  index('ix_year_closes_reopened_by').on(t.reopenedBy),
]);
