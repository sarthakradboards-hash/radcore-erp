// RAD-113 (ADR-006 F6, F7; ADR-005 §2; ADR-007 §4, §7), without a database: an invoice's line tax by the place of
// supply, its totals and round-off, when a buyer must be named, and its date against its deliveries. ADR-006's
// hand-worked figures F6 (80,000.00 at 5%) and F7 (a non-zero round-off) are reproduced exactly (RAD-96).
import { AppError } from '@radcore/lib-platform';
import { describe, expect, it } from 'vitest';
import { checkInvoiceDate, invoiceOwner, lineTax, needsBuyerDetails, placeOfSupply, totalsOf } from './invoice-rules.ts';

const outcome = (fn: () => unknown): string => {
  try {
    fn();
    return 'ok';
  } catch (e) {
    if (e instanceof AppError) return `${e.code}: ${e.message}${e.issues.map((i) => ` / ${i.path.join('.')} ${i.code} ${i.message}`).join('')}`;
    throw e;
  }
};

describe('lineTax', () => {
  it('splits tax within the state as CGST and SGST at half the rate each (F6)', () => {
    expect(lineTax({ qty: '1', rate: '80000', discountPercent: '0', gstPercent: '5' }, true))
      .toEqual({ taxable: '80000.00', cgst: '2000.00', sgst: '2000.00', igst: '0.00', lineTotal: '84000.00' });
  });
  it('charges IGST at the whole rate between states', () => {
    expect(lineTax({ qty: '1', rate: '80000', discountPercent: '0', gstPercent: '5' }, false))
      .toEqual({ taxable: '80000.00', cgst: '0.00', sgst: '0.00', igst: '4000.00', lineTotal: '84000.00' });
  });
  it('takes the discount off before tax, rounding the taxable value and then each tax to the paisa', () => {
    expect(lineTax({ qty: '3', rate: '33.335', discountPercent: '10', gstPercent: '18' }, true))
      .toEqual({ taxable: '90.00', cgst: '8.10', sgst: '8.10', igst: '0.00', lineTotal: '106.20' });
    expect(lineTax({ qty: '1', rate: '10.01', discountPercent: '0', gstPercent: '5' }, true))
      .toEqual({ taxable: '10.01', cgst: '0.25', sgst: '0.25', igst: '0.00', lineTotal: '10.51' });
  });
});

describe('placeOfSupply', () => {
  it('is the buyer’s state, or the ship-to state where the goods go elsewhere', () => {
    expect(placeOfSupply('27', '27', null)).toEqual({ state: '27', intraState: true });
    expect(placeOfSupply('27', '29', null)).toEqual({ state: '29', intraState: false });
    expect(placeOfSupply('27', '29', '27')).toEqual({ state: '27', intraState: true });
    expect(placeOfSupply('27', '27', '29')).toEqual({ state: '29', intraState: false });
  });
});

describe('totalsOf', () => {
  it('adds the lines and, at a whole rupee, rounds off nothing (F6)', () => {
    expect(totalsOf([lineTax({ qty: '1', rate: '80000', discountPercent: '0', gstPercent: '5' }, true)])).toEqual({
      taxable: '80000.00', cgst: '2000.00', sgst: '2000.00', igst: '0.00', linesTotal: '84000.00', roundOff: '0.00', total: '84000.00' });
  });
  it('rounds the total to the rupee with a round-off under 1 (F7)', () => {
    expect(totalsOf([lineTax({ qty: '3', rate: '345', discountPercent: '0', gstPercent: '18' }, true)])).toEqual({
      taxable: '1035.00', cgst: '93.15', sgst: '93.15', igst: '0.00', linesTotal: '1221.30', roundOff: '-0.30', total: '1221.00' });
  });
  it('rounds half a rupee up, and adds each line’s own figures', () => {
    const lines = [lineTax({ qty: '1', rate: '100.50', discountPercent: '0', gstPercent: '0' }, false),
      lineTax({ qty: '2', rate: '10', discountPercent: '0', gstPercent: '18' }, false)];
    expect(totalsOf(lines)).toEqual({
      taxable: '120.50', cgst: '0.00', sgst: '0.00', igst: '3.60', linesTotal: '124.10', roundOff: '-0.10', total: '124.00' });
    expect(totalsOf([lineTax({ qty: '1', rate: '100.50', discountPercent: '0', gstPercent: '0' }, true)]))
      .toMatchObject({ linesTotal: '100.50', roundOff: '0.50', total: '101.00' });
    expect(totalsOf([])).toEqual({ taxable: '0.00', cgst: '0.00', sgst: '0.00', igst: '0.00', linesTotal: '0.00', roundOff: '0.00', total: '0.00' });
  });
});

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
