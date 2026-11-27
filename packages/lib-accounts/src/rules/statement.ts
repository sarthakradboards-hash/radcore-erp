// A bank statement's rows, read and checked (M5-11, RAD-159; ADR-009 §11; RC-136). Pure: the file's table in, its lines
// or every refused row out, and then the chain against the lines already stored either side of it. Row numbers are
// as a spreadsheet shows them, title lines above the header included, so the person finds the row in the bank's file.
import { dec, roundMoney, type Money } from '@radcore/lib-common';
import { parseAmountCell, parseDateCell, type Table } from '@radcore/lib-platform';

/** The account's layout: the header names of its columns (`reference` may be absent), and the row order. */
export type StatementFormat = {
  dateColumn: string; narrationColumn: string; referenceColumn: string | null; withdrawalColumn: string; depositColumn: string;
  balanceColumn: string; newestFirst: boolean;
};
export type StatementLine = { rowNo: number; valueDate: string; narration: string; reference: string; direction: 'in' | 'out';
  amount: Money; balance: Money };
/** A refusal, by row and column, with its code; row 0 is the file as a whole. */
export type Refusal = { row: number; column: string; code: string; message: string };
type Read = { lines: StatementLine[]; refusals: Refusal[] };

// How far down the header may sit below the bank's title lines (GL-053).
const HEADER_WITHIN = 30;
const whole = (code: string, message: string): Read => ({ lines: [], refusals: [{ row: 0, column: '', code, message }] });
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// A balance may carry the bank's Cr or Dr (an overdraft is Dr): "1,25,000.50 Cr", "350.00 Dr".
function balanceOf(cell: string): string | undefined {
  const side = /\s*(cr|dr)\.?$/i.exec(cell.trim());
  const v = parseAmountCell(side === null ? cell : cell.trim().slice(0, side.index));
  if (v === undefined) return undefined;
  return side?.[1]?.toLowerCase() === 'dr' ? dec(v).neg().toString() : v;
}

/** The file's lines in the order they happened (oldest first), or every refused row (ADR-009 §11). */
export function readStatement(t: Table, f: StatementFormat): Read {
  const records = [t.header, ...t.rows];
  const wanted = [f.dateColumn, f.narrationColumn, f.withdrawalColumn, f.depositColumn, f.balanceColumn, ...(f.referenceColumn === null ? [] : [f.referenceColumn])];
  const at = records.slice(0, HEADER_WITHIN).findIndex((r) => wanted.every((w) => r.some((c) => same(c, w))));
  if (at < 0) {
    const header = records[0] ?? [];
    if (!header.some((c) => same(c, f.balanceColumn)) && wanted.filter((w) => w !== f.balanceColumn).every((w) => header.some((c) => same(c, w)))) {
      return whole('balance_required', `The file has no ${f.balanceColumn} column: download the statement with its running balance`);
    }
    return whole('statement_header_missing', `No row in the first ${HEADER_WITHIN} has the columns ${wanted.join(', ')}`);
  }
  const header = records[at] ?? [];
  const col = (name: string) => header.findIndex((c) => same(c, name));
  const [date, narration, withdrawal, deposit, balance] = [f.dateColumn, f.narrationColumn, f.withdrawalColumn, f.depositColumn, f.balanceColumn].map(col);
  const reference = f.referenceColumn === null ? -1 : col(f.referenceColumn);
  const out: Read = { lines: [], refusals: [] };
  records.slice(at + 1).forEach((cells, i) => {
    const row = at + i + 2;
    const cell = (c: number | undefined) => (c === undefined || c < 0 ? '' : cells[c] ?? '').trim();
    // A blank row, or the bank's footer (totals, "closing balance") with no date and no amount, isn't a line.
    if (cell(date) === '' && cell(withdrawal) === '' && cell(deposit) === '') return;
    const refuse = (column: string, code: string, message: string) => out.refusals.push({ row, column, code, message });
    const valueDate = parseDateCell(cell(date));
    if (valueDate === undefined) refuse(f.dateColumn, 'invalid_date', `"${cell(date).slice(0, 30)}" isn't a real date`);
    const [w, d] = [cell(withdrawal), cell(deposit)];
    const paidOut = w === '' ? undefined : parseAmountCell(w);
    const paidIn = d === '' ? undefined : parseAmountCell(d);
    const amounts = [paidOut, paidIn].filter((v) => v !== undefined && !dec(v).isZero());
    if ((w !== '' && paidOut === undefined) || (d !== '' && paidIn === undefined)) refuse(w !== '' && paidOut === undefined ? f.withdrawalColumn : f.depositColumn,
      'invalid_amount', 'That isn’t an amount');
    else if (amounts.length !== 1 || dec(amounts[0] ?? '0').lt(0)) {
      refuse(f.withdrawalColumn, 'one_amount', `A line has either a ${f.withdrawalColumn} or a ${f.depositColumn} above zero, not both or neither`);
    }
    const bal = balanceOf(cell(balance));
    if (bal === undefined) refuse(f.balanceColumn, 'balance_required', 'Every line needs its running balance');
    const text = cell(narration);
    const ref = cell(reference);
    if (text.length > 500) refuse(f.narrationColumn, 'too_long', 'At most 500 characters');
    if (ref.length > 100) refuse(f.referenceColumn ?? '', 'too_long', 'At most 100 characters');
    const amount = amounts[0];
    if (valueDate === undefined || amount === undefined || bal === undefined || out.refusals.some((r) => r.row === row)) return;
    out.lines.push({ rowNo: row, valueDate, narration: text, reference: ref, direction: paidIn !== undefined && !dec(paidIn).isZero() ? 'in' : 'out',
      amount: roundMoney(amount), balance: roundMoney(bal) });
  });
  if (out.lines.length === 0 && out.refusals.length === 0) return whole('statement_empty', 'The file has no lines below its header');
  if (f.newestFirst) out.lines.reverse();
  for (let i = 1; i < out.lines.length; i++) {
    const [prev, line] = [out.lines[i - 1], out.lines[i]];
    if (prev !== undefined && line !== undefined && !dec(prev.balance).plus(signed(line)).eq(dec(line.balance))) {
      out.refusals.push({ row: line.rowNo, column: f.balanceColumn, code: 'balance_chain_broken',
        message: `The balance ${line.balance} isn’t ${prev.balance} ${line.direction === 'in' ? 'plus' : 'less'} ${line.amount}` });
    }
  }
  const seen = new Map<string, number>();
  for (const l of out.lines) {
    const k = keyOf(l);
    const first = seen.get(k);
    if (first === undefined) seen.set(k, l.rowNo);
    else out.refusals.push({ row: l.rowNo, column: '', code: 'duplicate_row', message: `This line repeats row ${first}` });
  }
  out.refusals.sort((a, b) => a.row - b.row);
  return out;
}

/** A line's amount as it moves the balance. */
export const signed = (l: { direction: string; amount: string }) => (l.direction === 'in' ? dec(l.amount) : dec(l.amount).neg());
/** What makes a line already present (RC-136): the database's unique index on the same columns. */
export const keyOf = (l: { valueDate: string; direction: string; amount: string; balance: string; reference: string }) =>
  [l.valueDate, l.direction, roundMoney(l.amount), roundMoney(l.balance), l.reference].join('|');

/** The stored lines around a file's dates: the last before its first day, those on its days, and the first after its
 * last day. */
export type Stored = { before?: StatementLine; within: readonly StatementLine[]; after?: StatementLine };

/**
 * The file's lines against what's stored (ADR-009 §11): each line on the file's days that's already stored is present,
 * and every stored line on those days must be in the file; the file opens at the balance the line before it closed
 * on, and closes at the balance the line after it opened on, so a month may be filled in before a later one, but a
 * hole between files is refused (`balance_gap`).
 * shortcut: a file must hold whole days where it meets a stored one; a file that starts part-way through a stored day is
 * refused. Upgrade if a bank's statement can end mid-day.
 */
export function chainToStored(lines: readonly StatementLine[], stored: Stored, balanceColumn: string):
  { fresh: StatementLine[]; present: number; refusals: Refusal[] } {
  const first = lines[0];
  const last = lines.at(-1);
  if (first === undefined || last === undefined) return { fresh: [], present: 0, refusals: [] };
  const refusals: Refusal[] = [];
  const keys = new Set(stored.within.map(keyOf));
  const fresh = lines.filter((l) => !keys.has(keyOf(l)));
  const inFile = new Set(lines.map(keyOf));
  for (const s of stored.within.filter((x) => !inFile.has(keyOf(x)))) {
    const near = lines.find((l) => l.valueDate >= s.valueDate) ?? last;
    refusals.push({ row: near.rowNo, column: balanceColumn, code: 'balance_chain_broken',
      message: `The line of ${s.valueDate} for ${s.amount} (balance ${s.balance}), already imported, isn’t in this file` });
  }
  const opening = dec(first.balance).minus(signed(first));
  if (stored.before !== undefined && !opening.eq(dec(stored.before.balance))) {
    refusals.push({ row: first.rowNo, column: balanceColumn, code: 'balance_gap',
      message: `This file opens at ${roundMoney(opening)}, but the statement already imported closed at ${stored.before.balance} on ${stored.before.valueDate}: a part is missing between them` });
  }
  if (stored.after !== undefined && !dec(stored.after.balance).minus(signed(stored.after)).eq(dec(last.balance))) {
    refusals.push({ row: last.rowNo, column: balanceColumn, code: 'balance_gap',
      message: `This file closes at ${last.balance}, but the statement already imported goes on from ${roundMoney(dec(stored.after.balance).minus(signed(stored.after)))} on ${stored.after.valueDate}: a part is missing between them` });
  }
  return { fresh, present: lines.length - fresh.length, refusals };
}
