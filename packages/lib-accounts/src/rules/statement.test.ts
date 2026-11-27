// ADR-009 §11 (RAD-159; RC-136): a statement's rows read by its account's layout, the running balance chained within
// the file and to the lines already stored either side of it.
import { describe, expect, it } from 'vitest';
import { chainToStored, readStatement, type StatementFormat, type StatementLine } from './statement.ts';

const F: StatementFormat = { dateColumn: 'Txn Date', narrationColumn: 'Description', referenceColumn: 'Ref No', withdrawalColumn: 'Debit',
  depositColumn: 'Credit', balanceColumn: 'Balance', newestFirst: false };
const HEADER = ['Txn Date', 'Description', 'Ref No', 'Debit', 'Credit', 'Balance'];
const table = (rows: string[][], header = HEADER) => ({ header, rows });
const codes = (r: { refusals: { row: number; code: string }[] }) => r.refusals.map((x) => [x.row, x.code]);
const line = (valueDate: string, direction: 'in' | 'out', amount: string, balance: string, rowNo = 2): StatementLine =>
  ({ rowNo, valueDate, narration: 'x', reference: '', direction, amount: amount as StatementLine['amount'], balance: balance as StatementLine['balance'] });

describe('readStatement', () => {
  it('finds the header below the bank’s title lines, and numbers rows as the spreadsheet does (GL-053)', () => {
    const r = readStatement(table([['Account 0012', '', '', '', '', ''], [], HEADER, ['01-04-2026', 'NEFT ASHA', 'N123', '', '1,000.00', '11,000.00'],
      ['', 'Closing balance', '', '', '', '11,000.00']], ['HDFC Bank statement']), F);
    expect(r.refusals).toEqual([]);
    expect(r.lines).toEqual([{ rowNo: 5, valueDate: '2026-04-01', narration: 'NEFT ASHA', reference: 'N123', direction: 'in', amount: '1000.00',
      balance: '11000.00' }]);
  });

  it('keeps an in and an out of the same amount on one day: their balances differ', () => {
    const r = readStatement(table([['02-04-2026', 'CHQ', '', '500.00', '', '9,500.00'], ['02-04-2026', 'REFUND', '', '', '500.00', '10,000.00']]), F);
    expect(r.refusals).toEqual([]);
    expect(r.lines.map((l) => [l.direction, l.balance])).toEqual([['out', '9500.00'], ['in', '10000.00']]);
  });

  it('reads a newest-first statement oldest first, chaining its balances, an overdraft as Dr', () => {
    const r = readStatement(table([['03-04-2026', 'B', '', '200.00', '', '50.00 Dr'], ['02-04-2026', 'A', '', '100.00', '', '150.00 Cr']]),
      { ...F, newestFirst: true });
    expect(r.refusals).toEqual([]);
    expect(r.lines.map((l) => l.balance)).toEqual(['150.00', '-50.00']);
  });

  it('names each refused row: a broken chain, both amounts, a bad date, no balance, a repeated line', () => {
    const r = readStatement(table([
      ['01-04-2026', 'A', '', '', '100.00', '1,100.00'],
      ['02-04-2026', 'B', '', '', '100.00', '1,300.00'],
      ['03-04-2026', 'C', '', '10.00', '10.00', '1,300.00'],
      ['31-02-2026', 'D', '', '10.00', '', '1,290.00'],
      ['04-04-2026', 'E', '', '10.00', '', ''],
    ]), F);
    expect(codes(r)).toEqual([[3, 'balance_chain_broken'], [4, 'one_amount'], [5, 'invalid_date'], [6, 'balance_required']]);
    const twice = readStatement(table([['01-04-2026', 'A', '', '', '100.00', '100.00'], ['01-04-2026', 'A', '', '100.00', '', '0.00'],
      ['01-04-2026', 'A', '', '', '100.00', '100.00']]), F);
    expect(codes(twice)).toEqual([[4, 'duplicate_row']]);
  });

  it('refuses a file with no running balance as a whole (RC-136)', () => {
    const r = readStatement(table([['01-04-2026', 'A', '', '', '100.00']], HEADER.slice(0, 5)), F);
    expect(codes(r)).toEqual([[0, 'balance_required']]);
  });
});

describe('chainToStored', () => {
  const april = [line('2026-04-01', 'in', '100.00', '1100.00', 2), line('2026-04-02', 'out', '50.00', '1050.00', 3)];

  it('finds every line of a file imported again present, and adds nothing', () => {
    expect(chainToStored(april, { within: april }, 'Balance')).toEqual({ fresh: [], present: 2, refusals: [] });
  });

  it('fills in an earlier month whose last balance leads into the next stored line', () => {
    const may = line('2026-05-01', 'in', '10.00', '1060.00');
    expect(chainToStored(april, { within: [], after: may }, 'Balance').fresh).toHaveLength(2);
    const before = line('2026-03-31', 'in', '1000.00', '1000.00');
    expect(chainToStored(april, { within: [], before, after: may }, 'Balance').refusals).toEqual([]);
  });

  it('refuses a hole either side as a gap, and a stored line the file leaves out', () => {
    const gapBefore = chainToStored(april, { within: [], before: line('2026-03-20', 'in', '1.00', '999.00') }, 'Balance');
    expect(gapBefore.refusals.map((r) => [r.row, r.code])).toEqual([[2, 'balance_gap']]);
    const gapAfter = chainToStored(april, { within: [], after: line('2026-06-01', 'in', '10.00', '2000.00') }, 'Balance');
    expect(gapAfter.refusals.map((r) => [r.row, r.code])).toEqual([[3, 'balance_gap']]);
    const missing = chainToStored(april, { within: [...april, line('2026-04-02', 'out', '5.00', '1045.00')] }, 'Balance');
    expect(missing.refusals.map((r) => r.code)).toEqual(['balance_chain_broken']);
  });
});
