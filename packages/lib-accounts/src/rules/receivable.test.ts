// RAD-111 (the architect's ruling): what a party owes, from its Debtors lines. `outstanding` is the net balance, so an
// advance (a credit) already lowers it; `oldestUnpaid` is the date of the oldest bill not yet covered, credits paying
// the oldest bills first (FIFO), until M3-12's allocations say which bill each payment paid.
import { describe, expect, it } from 'vitest';
import { receivable } from './receivable.ts';

const dr = (businessDate: string, amount: string) => ({ businessDate, debit: amount, credit: '0.00' });
const cr = (businessDate: string, amount: string) => ({ businessDate, debit: '0.00', credit: amount });

describe('what a party owes', () => {
  it('owes nothing with no lines', () => {
    expect(receivable([])).toEqual({ outstanding: '0.00', oldestUnpaid: null });
  });

  it('owes its bills less its payments, with the oldest bill not yet paid first in line', () => {
    expect(receivable([dr('2026-04-10', '100.00'), dr('2026-05-01', '50.00'), cr('2026-05-20', '60.00')]))
      .toEqual({ outstanding: '90.00', oldestUnpaid: '2026-04-10' });
    // Payments cover the oldest bills first: 100 paid in full, so the bill of 1 May is the oldest unpaid.
    expect(receivable([dr('2026-04-10', '100.00'), dr('2026-05-01', '50.00'), cr('2026-05-20', '100.00')]))
      .toEqual({ outstanding: '50.00', oldestUnpaid: '2026-05-01' });
    // A bill paid but for one paisa is still unpaid.
    expect(receivable([dr('2026-04-10', '100.00'), cr('2026-05-20', '99.99')])).toEqual({ outstanding: '0.01', oldestUnpaid: '2026-04-10' });
  });

  it('owes nothing, and nothing unpaid, once payments cover every bill; an advance leaves the party in credit', () => {
    expect(receivable([dr('2026-04-10', '100.00'), cr('2026-05-20', '100.00')])).toEqual({ outstanding: '0.00', oldestUnpaid: null });
    expect(receivable([cr('2026-04-01', '500.00')])).toEqual({ outstanding: '-500.00', oldestUnpaid: null });
    expect(receivable([cr('2026-04-01', '500.00'), dr('2026-04-10', '300.00')])).toEqual({ outstanding: '-200.00', oldestUnpaid: null });
  });

  it('orders the bills by date, whatever order the lines come in', () => {
    expect(receivable([dr('2026-06-01', '50.00'), dr('2026-04-10', '100.00'), cr('2026-06-02', '100.00')]))
      .toEqual({ outstanding: '50.00', oldestUnpaid: '2026-06-01' });
  });
});
