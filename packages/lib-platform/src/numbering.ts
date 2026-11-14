// Document numbers (M2-04, RAD-87, ADR-006 §1 and §3, RC-206, RC-200): gap-free per series and financial year. A
// series is declared once, in its library: `defineSeries('accounts.journal', 'JV')`. Its prefix is a setting, read
// with the request's other settings when its Ctx was built, so drawing a number is one query and nothing else.
// The draw is a document's last step, after every check has passed (ADR-006 §1's lock order), so the counter's row
// lock is held for the shortest time; a save that rolls back gives its number back.
import { numberCounters, platformTx } from '@radcore/db/platform';
import { financialYear } from '@radcore/lib-common';
import { z } from 'zod';
import type { Ctx } from './ctx.ts';
import { AppError } from './errors.ts';
import { defineSetting, type SettingDef } from './settings.ts';

const KEY = /^(platform|hr|gst|ops|accounts|crm|stock|payroll|purchasing|sales|service)\.[a-z][a-z0-9_]*$/;
// Rule 46 allows 16 characters: a prefix of up to 4, "/26-27/" and 5 digits. The CA settles the format (CA-44).
const PREFIX = z.string().regex(/^[A-Z0-9]{1,4}$/, 'Use 1 to 4 capital letters or digits');
const DIGITS = 5;
/** The most numbers one series draws in a financial year, so a number fits its 16 characters. */
export const SERIES_MAX = 10 ** DIGITS - 1;

/** One numbering series: its key (`<module>.<name>`) and its prefix's setting (`<key>_prefix`). */
export type Series = Readonly<{ key: string; prefix: SettingDef<string> }>;

/** Declares a series. Throws at load time on a bad key or prefix. */
export function defineSeries(key: string, prefix: string): Series {
  if (!KEY.test(key)) throw new TypeError(`Series key "${key}" must be <module>.<name> in lower case`);
  return Object.freeze({ key, prefix: defineSetting(`${key}_prefix`, PREFIX, prefix) });
}

/**
 * The series' next number for the financial year of `businessDate`, such as "JV/26-27/00042", in one query. The
 * counter's row stays locked until the transaction ends, so concurrent saves take turns and none skips or repeats.
 * Past SERIES_MAX it refuses with `series_full`, which a route that numbers documents lists among its errors.
 */
export async function nextNumber(ctx: Ctx, series: Series, businessDate: string): Promise<string> {
  const prefix = ctx.settings.get(series.prefix);
  const year = financialYear(businessDate).label;
  // The update sets `last` to itself; the database's trigger makes it exactly one more (migration 0033).
  const [row] = await platformTx(ctx).insert(numberCounters).values({ series: series.key, financialYear: year })
    .onConflictDoUpdate({ target: [numberCounters.series, numberCounters.financialYear], set: { last: numberCounters.last } })
    .returning({ last: numberCounters.last });
  if (row === undefined) throw new Error(`${series.key}: no number was drawn`);
  if (row.last > SERIES_MAX) {
    throw new AppError('series_full', `This year's ${series.key} numbers have run out. Ask an admin to start a new series`);
  }
  return `${prefix}/${year.slice(2)}/${String(row.last).padStart(DIGITS, '0')}`;
}
