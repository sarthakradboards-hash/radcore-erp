// Document numbers (M2-04, RAD-87, ADR-006 §1 and §3, RC-206, RC-200): gap-free per series and financial year. A
// series is declared once, in its library: `defineSeries('sales.invoice', 'INV', { label: 'Invoices' })`. Its prefix
// isn't a setting (RAD-132, ADR-001 §8c): `series_prefixes` holds each change and the year it starts, and the
// counter's insert trigger takes the latest one on or before the year, else the declared prefix, so drawing a number is
// still one statement. A year's counter keeps the prefix its first number took, so one year's numbers never mix two
// prefixes and no issued number changes (the architect on #171, until the CA settles the format, CA-44).
// The draw is a document's last step, after every check has passed (ADR-006 §1's lock order), so the counter's row
// lock is held for the shortest time; a save that rolls back gives its number back.
import { numberCounters, platformTx } from '@radcore/db/platform';
import { financialYear } from '@radcore/lib-common';
import { z } from 'zod';
import type { Ctx } from './ctx.ts';
import { AppError } from './errors.ts';

const KEY = /^(platform|hr|gst|ops|accounts|crm|stock|payroll|purchasing|sales|service)\.[a-z][a-z0-9_]*$/;
/** A series' prefix: 1 to 4 capital letters or digits. */
export const seriesPrefix = () => z.string().regex(/^[A-Z0-9]{1,4}$/, 'Use 1 to 4 capital letters or digits');
// Rule 46 allows a tax invoice 16 characters: a prefix of up to 4, "/26-27/" and 5 digits, so 5 is the default. A
// series no rule bounds takes more: the journal numbers nearly every document's entry (the architect on #171).
const DIGITS = 5;

/** One numbering series: its key (`<module>.<name>`), label, declared prefix, and digits. */
export type Series = Readonly<{ key: string; label: string; prefix: string; digits: number; max: number }>;

// Every series declared in this process, by key: the tools test checks apps/api composes each one (ADR-001 §8c).
const declared = new Set<string>();

/** Declares a series. Throws at load time on a bad key, prefix, label or digit count. */
export function defineSeries(key: string, prefix: string, { digits = DIGITS, label }: { digits?: number; label: string }): Series {
  if (!KEY.test(key)) throw new TypeError(`Series key "${key}" must be <module>.<name> in lower case`);
  if (!Number.isInteger(digits) || digits < 4 || digits > 9) throw new TypeError(`Series ${key}: 4 to 9 digits`);
  if (label.trim() === '') throw new TypeError(`Series ${key} needs a label`);
  const series: Series = Object.freeze({ key, label, prefix: seriesPrefix().parse(prefix), digits, max: 10 ** digits - 1 });
  declared.add(key);
  return series;
}

/** The keys of every series declared so far in this process (for the composition test). */
export const declaredSeriesKeys = (): readonly string[] => [...declared].toSorted();

/** A number as it prints: prefix, the year's short label and the zero-padded count, such as "JV/26-27/00042". */
export const formatNumber = (series: Series, prefix: string, year: string, n: number) =>
  `${prefix}/${year.slice(2)}/${String(n).padStart(series.digits, '0')}`;

/**
 * The series' next number for the financial year of `businessDate`, such as "JV/26-27/00042", in one query. The
 * counter's row stays locked until the transaction ends, so concurrent saves take turns and none skips or repeats.
 * Past the series' most it refuses with `series_full`, which a route that numbers documents lists among its errors.
 */
export async function nextNumber(ctx: Ctx, series: Series, businessDate: string): Promise<string> {
  const year = financialYear(businessDate).label;
  // A year's first draw inserts the counter, and the database's trigger gives it the latest prefix in series_prefixes
  // on or before the year, else this declared one. A later draw sets `last` to itself, and the trigger makes it exactly
  // one more and keeps the prefix (migrations 0038 and RAD-132's).
  const [row] = await platformTx(ctx).insert(numberCounters)
    .values({ series: series.key, financialYear: year, prefix: series.prefix })
    .onConflictDoUpdate({ target: [numberCounters.series, numberCounters.financialYear], set: { last: numberCounters.last } })
    .returning({ last: numberCounters.last, prefix: numberCounters.prefix });
  if (row === undefined) throw new Error(`${series.key}: no number was drawn`);
  if (row.last > series.max) {
    throw new AppError('series_full', `This year's ${series.key} numbers have run out. Ask an admin to start a new series`);
  }
  return formatNumber(series, row.prefix, year, row.last);
}
