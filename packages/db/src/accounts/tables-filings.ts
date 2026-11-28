// lib-accounts' filed-month lock (M5-08, RAD-156; ADR-009 §5, §7; RC-012). SQL zone (ADR-002 §3): `sql` only as a
// CHECK's argument.
import { isNull, sql } from 'drizzle-orm';
import { check, date, smallint, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { boundedText, id, json, radcoreTable } from '../columns.ts';

/**
 * The filed-month lock (ADR-009 §5): one row. `gstr1_through` and `gstr3b_through` are each the last day of the latest
 * month that return is filed for. A posting reads it FOR SHARE after the period lock (lockPeriod), and marking or
 * undoing a filing takes it FOR UPDATE, so it waits for the postings in flight. It moves only through
 * radcore.set_filed_lock; the app login may lock the row, never write it.
 */
export const gstFiledLock = radcoreTable('gst_filed_lock', {
  id: smallint().primaryKey().default(1),
  gstr1Through: date({ mode: 'string' }),
  gstr3bThrough: date({ mode: 'string' }),
}, (t) => [check('ck_gst_filed_lock_one', sql`${t.id} = 1`)]);

/**
 * A return marked filed (ADR-009 §5): the return, its month (the 1st), the ARN as the portal gives it, the day it was
 * filed, and what the books said then (the snapshot and its SHA-256), kept for good. One live filing per return and
 * month; an undone one keeps its row and snapshot (`undone_at`).
 */
export const gstFilings = radcoreTable('gst_filings', {
  id: id(),
  return: text().notNull(),
  month: date({ mode: 'string' }).notNull(),
  arn: boundedText({ max: 40 }).notNull(),
  filedOn: date({ mode: 'string' }).notNull(),
  snapshot: json().notNull(),
  snapshotSha256: text().notNull(),
  undoneAt: timestamp({ withTimezone: true }),
}, (t) => [
  check('ck_gst_filings_return', sql`${t.return} in ('gstr1', 'gstr3b')`),
  check('ck_gst_filings_month', sql`extract(day from ${t.month}) = 1`),
  check('ck_gst_filings_sha256', sql`${t.snapshotSha256} ~ '^[0-9a-f]{64}$'`),
  uniqueIndex('ux_gst_filings_live').on(t.return, t.month).where(isNull(t.undoneAt)),
]);
