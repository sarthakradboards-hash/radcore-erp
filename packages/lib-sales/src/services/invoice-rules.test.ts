// RAD-113 (ADR-006 F6, F7; ADR-005 §2; ADR-007 §4, §7), without a database: an invoice's line tax by the place of
// supply, its totals and round-off, when a buyer must be named, and its date against its deliveries. ADR-006's
// hand-worked figures F6 (80,000.00 at 5%) and F7 (a non-zero round-off) are reproduced exactly (RAD-96).
import { AppError } from '@radcore/lib-platform';
import { describe, expect, it } from 'vitest';
import { checkInvoiceDate, invoiceOwner, needsBuyerDetails } from './invoice-rules.ts';

const outcome = (fn: () => unknown): string => {
  try {
    fn();
    return 'ok';
  } catch (e) {
    if (e instanceof AppError) return `${e.code}: ${e.message}${e.issues.map((i) => ` / ${i.path.join('.')} ${i.code} ${i.message}`).join('')}`;
    throw e;
  }
};

describe('needsBuyerDetails', () => {
  it('names the buyer at or above the limit, on the invoice value or the taxable value as set', () => {
    const t = { total: '52500.00', taxable: '50000.00' };
    expect(needsBuyerDetails(t, '50000', 'invoice_value')).toBe(true);
    expect(needsBuyerDetails({ total: '50000.00', taxable: '47619.05' }, '50000', 'invoice_value')).toBe(true);
    expect(needsBuyerDetails({ total: '49999.99', taxable: '47619.04' }, '50000', 'invoice_value')).toBe(false);
    expect(needsBuyerDetails(t, '50000', 'taxable_value')).toBe(true);
    expect(needsBuyerDetails({ total: '52499.99', taxable: '49999.99' }, '50000', 'taxable_value')).toBe(false);
  });
});

describe('checkInvoiceDate', () => {
  it('takes the day of its latest delivery, up to the lag after its earliest', () => {
    expect(outcome(() => checkInvoiceDate('2026-06-05', ['2026-06-05'], 0))).toBe('ok');
    expect(outcome(() => checkInvoiceDate('2026-06-07', ['2026-06-05', '2026-06-07'], 2))).toBe('ok');
    expect(outcome(() => checkInvoiceDate('2026-06-05', [], 0))).toBe('ok');
  });
  it('refuses a date before any delivery it bills', () => {
    expect(outcome(() => checkInvoiceDate('2026-06-06', ['2026-06-07', '2026-06-05'], 5))).toBe(
      'date_before_source: An invoice can’t be dated before a delivery it bills / businessDate before_source A delivery on it is dated 2026-06-07');
    expect(outcome(() => checkInvoiceDate('2026-06-07', ['2026-06-08', '2026-06-05', '2026-06-06'], 5))).toBe(
      'date_before_source: An invoice can’t be dated before a delivery it bills / businessDate before_source A delivery on it is dated 2026-06-08');
  });
  it('refuses a date past the lag after its earliest delivery', () => {
    expect(outcome(() => checkInvoiceDate('2026-06-08', ['2026-06-07', '2026-06-05'], 2))).toBe(
      'invoice_too_late: This invoice is too long after the goods left / businessDate too_late Its earliest delivery is dated 2026-06-05: invoice it by 2026-06-07');
    expect(outcome(() => checkInvoiceDate('2026-06-06', ['2026-06-05'], 0))).toBe(
      'invoice_too_late: This invoice is too long after the goods left / businessDate too_late Its earliest delivery is dated 2026-06-05: invoice it by 2026-06-05');
  });
});

// The architect on RAD-113: the owner the deliveries share, else the maker.
describe('invoiceOwner', () => {
  it('is the owner every delivery shares', () => {
    expect(invoiceOwner(['user:a', 'user:a'], 'user:m')).toBe('user:a');
  });
  it('is the maker when the deliveries have several owners, or there are none', () => {
    expect(invoiceOwner(['user:a', 'user:b'], 'user:m')).toBe('user:m');
    expect(invoiceOwner([], 'user:m')).toBe('user:m');
  });
});
