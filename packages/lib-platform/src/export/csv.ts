// CSV for exports (M1-29, ADR-003 §3). csv-stringify's escape_formulas puts an apostrophe before a cell starting
// with =, +, -, @, tab, CR or their full-width forms, so a spreadsheet never runs it as a formula. A strict decimal,
// date or E.164 phone string has no letters or brackets, so it can't be one, and is written as it is: -1250.50 stays
// a number and +919876543210 gets no apostrophe (RC-203). A cell starting with a space and then `=` is left as it
// is too: that's csv-stringify's rule, and Excel reads it as text.
import { stringify, type Stringifier } from 'csv-stringify';

// \d without the u flag is ASCII only, so a full-width ＋ or digit never matches and stays escaped.
const PLAIN = /^-?\d+(\.\d+)?$|^\d{4}-\d{2}-\d{2}$|^\+[1-9]\d{7,14}$/;

const cell = (value: string) => {
  if (!PLAIN.test(value)) return value;
  // csv-stringify applies escape_formulas from a cast's result to that cell alone; its types leave the key out.
  const plain = { value, escape_formulas: false };
  return plain;
};

/**
 * A CSV writer for one export: the header row from `columns`, then each row written to it, as a stream. A UTF-8
 * byte-order mark comes first, so Excel reads names in Hindi and the ₹ sign correctly.
 */
export const csvWriter = (columns: readonly string[]): Stringifier =>
  stringify({ header: true, columns: [...columns], bom: true, escape_formulas: true, cast: { string: cell } });
