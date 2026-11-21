// RAD-119 (M3-15): a party's statement and what there is to collect, from its Debtors lines and what's been paid on each
// bill (allocations and credits, v_document_paid). A bill is a receivable charge; it's due its credit days after its
// date. What isn't on a bill (an opening balance, a manual journal, an advance applied to nothing) is shown apart, so
// the open bills and it add up to the balance. A cancelled bill and its reversal leave together.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { collect, openBills, statement, type PartyLine } from './collect.ts';

const line = (o: Partial<PartyLine> & { businessDate: string }): PartyLine => ({
  entryId: randomUUID(), reversesEntryId: null, entryNumber: 'JV/26-27/0000001', documentNumber: null, kind: 'invoice', sourceTable: 'invoices', sourceId: randomUUID(),
  debit: '0.00', credit: '0.00', ...o,
});
const bill = (businessDate: string, debit: string, sourceId = randomUUID()) => line({ businessDate, debit, sourceId });
const receipt = (businessDate: string, credit: string) => line({ businessDate, credit, kind: 'payment_in', sourceTable: 'payments' });
const isBill = (t: string) => t === 'invoices';
const none = () => '0.00';

describe('open bills', () => {
  it('owes each bill less what’s paid on it, due its credit days after its date', () => {
    const [a, b] = [randomUUID(), randomUUID()];
    const paid = (_t: string, id: string) => (id === a ? '40.00' : '0.00');
    expect(openBills([bill('2026-10-01', '100.00', a), bill('2026-11-01', '50.00', b)], { isBill, paid, creditDays: 30, today: '2026-11-15' }))
      .toEqual([
        { table: 'invoices', id: a, entryNumber: 'JV/26-27/0000001', documentNumber: null, date: '2026-10-01', due: '2026-10-31', amount: '100.00', paid: '40.00', open: '60.00', overdue: true },
        { table: 'invoices', id: b, entryNumber: 'JV/26-27/0000001', documentNumber: null, date: '2026-11-01', due: '2026-12-01', amount: '50.00', paid: '0.00', open: '50.00', overdue: false },
      ]);
  });

  it('leaves out a bill paid in full, a debit that isn’t a bill, and a cancelled bill with its reversal', () => {
    const paidUp = randomUUID();
    const cancelled = bill('2026-10-05', '70.00');
    const lines = [bill('2026-10-01', '100.00', paidUp), line({ businessDate: '2026-04-01', debit: '25.00', kind: 'opening', sourceTable: 'journal_entries' }),
      cancelled, line({ businessDate: '2026-10-06', credit: '70.00', reversesEntryId: cancelled.entryId, sourceId: cancelled.sourceId })];
    expect(openBills(lines, { isBill, paid: (_t, id) => (id === paidUp ? '100.00' : '0.00'), creditDays: 0, today: '2026-11-15' })).toEqual([]);
  });
});

describe('what there is to collect', () => {
  it('splits the balance into open bills, what’s overdue, and what isn’t on a bill', () => {
    const lines = [line({ businessDate: '2026-04-01', debit: '25.00', kind: 'opening', sourceTable: 'journal_entries' }), bill('2026-10-01', '100.00'),
      bill('2026-11-10', '50.00'), receipt('2026-11-12', '30.00')];
    const bills = openBills(lines, { isBill, paid: none, creditDays: 15, today: '2026-11-15' });
    // 145 owed: 150 in open bills, 100 of it overdue since 16 October, and -5 not on a bill (25 opening, 30 paid on none).
    expect(collect(lines, bills)).toEqual({ outstanding: '145.00', overdue: '100.00', oldestDue: '2026-10-16', notOnABill: '-5.00' });
  });

  it('owes nothing with no lines, and a party in advance owes less than nothing', () => {
    expect(collect([], [])).toEqual({ outstanding: '0.00', overdue: '0.00', oldestDue: null, notOnABill: '0.00' });
    expect(collect([receipt('2026-11-12', '30.00')], [])).toEqual({ outstanding: '-30.00', overdue: '0.00', oldestDue: null, notOnABill: '-30.00' });
  });
});

describe('a statement', () => {
  it('opens with the balance before its first day, runs a balance through each line in it, and closes with the last', () => {
    const lines = [bill('2026-09-01', '100.00'), bill('2026-10-01', '50.00'), receipt('2026-10-15', '120.00'), bill('2026-12-01', '9.00')];
    const s = statement(lines, '2026-10-01', '2026-11-30');
    expect([s.opening, s.closing]).toEqual(['100.00', '30.00']);
    expect(s.lines.map((l) => [l.businessDate, l.debit, l.credit, l.balance])).toEqual([
      ['2026-10-01', '50.00', '0.00', '150.00'], ['2026-10-15', '0.00', '120.00', '30.00']]);
  });
});
