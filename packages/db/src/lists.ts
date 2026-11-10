// The conditions a module's list query is built from (M1-29), from Drizzle's operators alone, so no SQL is written
// (ADR-002 §3). Each returns `undefined` when its filter is empty, which `and()` drops. A repo combines them with
// its scope term, which is never undefined (ADR-002's worked example).
import { indiaTimeToMoment } from '@radcore/lib-common';
import { and, eq, gt, gte, ilike, lt, lte, or, type AnyColumn, type SQL } from 'drizzle-orm';

/** LIKE's own characters as literal text: a search for "50%" or "a_b" finds those, not every row (RC-203). */
export const escapeLike = (text: string): string => text.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * A search box's `filter.search` over one or more text columns: each word must appear in one of them, in any case.
 * Blank text adds no condition. ILIKE with the pattern escaped, which a trigram index on the column can serve.
 */
export function searchWords(columns: readonly [AnyColumn, ...AnyColumn[]], text: string | undefined): SQL | undefined {
  const words = (text ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 8);
  if (words.length === 0) return undefined;
  return and(...words.map((w) => or(...columns.map((c) => ilike(c, `%${escapeLike(w)}%`)))));
}

/** A date column between two dates, both included, compared as they are, so the column's index is used (RC-202). */
export function onDates(column: AnyColumn, range: { from?: string | undefined; to?: string | undefined }): SQL | undefined {
  return and(range.from ? gte(column, range.from) : undefined, range.to ? lte(column, range.to) : undefined);
}

const nextDay = (date: string): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/**
 * A timestamp column on India dates, both included: from India's midnight starting `from` up to (not including)
 * the midnight after `to`. The dates become moments, never the column, so its index is used (RC-202, RC-204).
 */
export function onIndiaDays(column: AnyColumn, range: { from?: string | undefined; to?: string | undefined }): SQL | undefined {
  return and(
    range.from ? gte(column, indiaTimeToMoment(`${range.from}T00:00`)) : undefined,
    range.to ? lt(column, indiaTimeToMoment(`${nextDay(range.to)}T00:00`)) : undefined,
  );
}

/**
 * The rows after a page's last one, for keyset paging over the list's sort key in order (ADR-002): for a newest-first
 * list on (invoiceDate, id), `invoiceDate < d or (invoiceDate = d and id < i)`. The key ends in a unique column, so
 * no row is skipped or repeated. No cursor, no condition.
 */
export function after(key: readonly [AnyColumn, ...AnyColumn[]], values: readonly unknown[] | undefined,
  direction: 'asc' | 'desc'): SQL | undefined {
  if (values === undefined) return undefined;
  if (values.length !== key.length) throw new TypeError('A page cursor has one value per sort column');
  const past = direction === 'desc' ? lt : gt;
  const branches = key.map((column, i) =>
    and(...key.slice(0, i).map((c, j) => eq(c, values[j])), past(column, values[i])));
  return or(...branches);
}
