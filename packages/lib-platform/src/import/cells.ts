// From cells to values, with an error per row (M1-28, RC-118). No row vanishes: each is either a value or a list of
// what is wrong with it, by row number and column, so a person can fix the file and import it again.
import { dateString } from '@radcore/lib-common';
import { z } from 'zod';
import type { Table } from './read.ts';

// An amount as Indian and Western files write it: "9,111.00", "1,25,000.50", "125000.5", "-1,250", "(1,250.00)" for a
// debit, an optional "Rs", "Rs." or "₹" in front. Commas must sit where one of the two groupings puts them, so
// "9,1,11" and "9111,00" are refused rather than misread.
const GROUPED = /^(\d{1,3}(,\d{3})*|\d{1,2}(,\d{2})*,\d{3}|\d+)(\.\d+)?$/;

/** The decimal string an amount cell holds ("9,111.00" -> "9111.00"), or undefined if it isn't one (RC-118). */
export function parseAmountCell(cell: string): string | undefined {
  let s = cell.trim().replace(/^(₹|rs\.?|inr)\s*/i, '');
  let negative = false;
  const paren = /^\((.*)\)$/.exec(s);
  if (paren?.[1] !== undefined) { negative = true; s = paren[1].trim(); }
  if (s.startsWith('-')) { negative = !negative; s = s.slice(1).trim(); }
  if (!GROUPED.test(s)) return undefined;
  const plain = s.replace(/,/g, '').replace(/^0+(?=\d)/, '');
  return negative && /[1-9]/.test(plain) ? `-${plain}` : plain;
}

/** A zod cell schema for an amount: checks the shape and gives the decimal string, for a row schema. */
export const amountCell = () => z.string().transform((cell, ctx) => {
  const v = parseAmountCell(cell);
  if (v === undefined) {
    ctx.addIssue({ code: 'custom', message: `"${cell.slice(0, 30)}" isn't an amount` });
    return z.NEVER;
  }
  return v;
});

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october',
  'november', 'december'];
const monthOf = (word: string) => {
  const w = word.toLowerCase();
  const i = MONTHS.findIndex((m) => w === m || w === m.slice(0, 3) || (m === 'september' && w === 'sept'));
  return i < 0 ? undefined : String(i + 1);
};

/**
 * The YYYY-MM-DD a date cell holds, or undefined if it isn't a real date (RC-118). Day first, as Indian files write
 * it: "07-11-2026", "7/11/2026", "07.11.2026", "07 Nov 2026", "7-November-2026", and Excel's own "2026-11-07". A
 * two-digit year and month-first order are refused, not guessed, and 31-02-2026 fails lib-common's dateString.
 */
export function parseDateCell(cell: string): string | undefined {
  const s = cell.trim();
  let parts: [string | undefined, string | undefined, string | undefined] | undefined;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const dmy = /^(\d{1,2})([-/.])(\d{1,2})\2(\d{4})$/.exec(s);
  const named = /^(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s,]+(\d{4})$/.exec(s);
  if (iso) parts = [iso[1], iso[2], iso[3]];
  else if (dmy) parts = [dmy[4], dmy[3], dmy[1]];
  else if (named?.[2] !== undefined) parts = [named[3], monthOf(named[2]), named[1]];
  const [y, m, d] = parts ?? [];
  if (y === undefined || m === undefined || d === undefined) return undefined;
  const date = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  return DATE.safeParse(date).success ? date : undefined;
}
const DATE = dateString();

/** A zod cell schema for a date: checks it is a real date and gives YYYY-MM-DD, for a row schema. */
export const dateCell = () => z.string().transform((cell, ctx) => {
  const v = parseDateCell(cell);
  if (v === undefined) {
    ctx.addIssue({ code: 'custom', message: `"${cell.slice(0, 30)}" isn't a real date. Write it as DD-MM-YYYY` });
    return z.NEVER;
  }
  return v;
});

export type RowError = { row: number; column: string; message: string };
export type ImportResult<T> = { rows: { row: number; value: T }[]; errors: RowError[] };

/**
 * Checks every data row against a row schema keyed by header. Row numbers are as a spreadsheet shows them (the header
 * is row 1). A header the schema needs and the file lacks is one error for the file, on row 1.
 */
export function checkRows<S extends z.ZodObject>(t: Table, schema: S): ImportResult<z.output<S>> {
  const out: ImportResult<z.output<S>> = { rows: [], errors: [] };
  const missing = Object.keys(schema.shape).filter((k) => !t.header.includes(k));
  if (missing.length > 0) {
    out.errors.push({ row: 1, column: missing.join(', '), message: `The file has no column called ${missing.join(', ')}` });
    return out;
  }
  t.rows.forEach((cells, i) => {
    const row = i + 2;
    const raw = Object.fromEntries(t.header.map((h, c) => [h, cells[c] ?? '']));
    const r = schema.safeParse(raw);
    if (r.success) out.rows.push({ row, value: r.data });
    else for (const issue of r.error.issues) out.errors.push({ row, column: String(issue.path[0] ?? ''), message: issue.message });
  });
  return out;
}
