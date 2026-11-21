// RAD-114 (ADR-007 §6; ADR-006 §4, F9, F25, F26), without a database: a credit note line against what's left of its
// invoice line, by goods back or by value, and section 34's deadline for cutting output tax. ADR-006's hand-worked
// figures F9 (the scooter back, and its discount variant), F25 (late) and F26 (one pad of three) are reproduced exactly.
import { AppError } from '@radcore/lib-platform';
import { describe, expect, it } from 'vitest';
import { creditLine, isLate, isMonthDay, taxDeadline } from './credit-note-rules.ts';

const outcome = (fn: () => unknown): string => {
  try {
    fn();
    return 'ok';
  } catch (e) {
    if (e instanceof AppError) return `${e.code}: ${e.message}${e.issues.map((i) => ` / ${i.path.join('.')} ${i.code} ${i.message}`).join('')}`;
    throw e;
  }
};

const scooter = { qty: '1', taxable: '80000.00', cgst: '2000.00', sgst: '2000.00', igst: '0.00', cost: '61250.00' };
const pads = { qty: '3', taxable: '1035.00', cgst: '93.15', sgst: '93.15', igst: '0.00', cost: '600.00' };

describe('creditLine, goods back', () => {
  it('takes the whole line back at the value it went out at (F9)', () => {
    expect(creditLine(scooter, { qty: '1' }, '5', true, 0))
      .toEqual({ taxable: '80000.00', cgst: '2000.00', sgst: '2000.00', igst: '0.00', cost: '61250.00', lineTotal: '84000.00' });
  });
  it('takes its share of what is left for part of the line (F26)', () => {
    expect(creditLine(pads, { qty: '1' }, '18', true, 0))
      .toEqual({ taxable: '345.00', cgst: '31.05', sgst: '31.05', igst: '0.00', cost: '200.00', lineTotal: '407.10' });
  });
  it('rounds each share to the paisa, IGST included', () => {
    expect(creditLine({ qty: '3', taxable: '100.00', cgst: '0.00', sgst: '0.00', igst: '18.00', cost: '10.00' }, { qty: '2' }, '18', false, 0))
      .toEqual({ taxable: '66.67', cgst: '0.00', sgst: '0.00', igst: '12.00', cost: '6.67', lineTotal: '78.67' });
  });
  it('refuses more than is left of the line', () => {
    expect(outcome(() => creditLine(pads, { qty: '3.5' }, '18', true, 2)))
      .toBe('exceeds_invoice: A credit note can’t exceed what’s left of its invoice / lines.2.qty exceeds_invoice Only 3 is left on the invoice line');
  });
});

describe('creditLine, value only', () => {
  it('works the tax at the line rate within the state, with no cost (F9 variant)', () => {
    expect(creditLine(scooter, { taxable: '1000.00' }, '5', true, 0))
      .toEqual({ taxable: '1000.00', cgst: '25.00', sgst: '25.00', igst: '0.00', cost: '0.00', lineTotal: '1050.00' });
  });
  it('works IGST between states', () => {
    expect(creditLine({ ...scooter, cgst: '0.00', sgst: '0.00', igst: '4000.00' }, { taxable: '1000.00' }, '5', false, 0))
      .toEqual({ taxable: '1000.00', cgst: '0.00', sgst: '0.00', igst: '50.00', cost: '0.00', lineTotal: '1050.00' });
  });
  it('clears the tax left when it credits all the taxable value left', () => {
    expect(creditLine({ ...scooter, taxable: '1000.00', cgst: '25.01', sgst: '25.01' }, { taxable: '1000' }, '5', true, 0))
      .toEqual({ taxable: '1000.00', cgst: '25.01', sgst: '25.01', igst: '0.00', cost: '0.00', lineTotal: '1050.02' });
  });
  it('never credits more tax than is left', () => {
    expect(creditLine({ ...scooter, taxable: '1000.00', cgst: '24.00', sgst: '24.00' }, { taxable: '999.99' }, '5', true, 0))
      .toEqual({ taxable: '999.99', cgst: '24.00', sgst: '24.00', igst: '0.00', cost: '0.00', lineTotal: '1047.99' });
    expect(creditLine({ ...scooter, taxable: '1000.00', cgst: '0.00', sgst: '0.00', igst: '49.00' }, { taxable: '999.99' }, '5', false, 0))
      .toEqual({ taxable: '999.99', cgst: '0.00', sgst: '0.00', igst: '49.00', cost: '0.00', lineTotal: '1048.99' });
  });
  it('refuses more taxable value than is left of the line', () => {
    expect(outcome(() => creditLine({ ...scooter, taxable: '1000.00' }, { taxable: '1000.01' }, '5', true, 1)))
      .toBe('exceeds_invoice: A credit note can’t exceed what’s left of its invoice / lines.1.taxable exceeds_invoice Only 1000 is left on the invoice line');
  });
});

describe('the section 34 deadline (CA-10)', () => {
  it('is 30 November after the end of the invoice’s financial year (F25)', () => {
    expect(taxDeadline('2026-06-05', '11-30')).toBe('2027-11-30');
    expect(taxDeadline('2027-03-31', '11-30')).toBe('2027-11-30');
    expect(taxDeadline('2027-04-01', '11-30')).toBe('2028-11-30');
  });
  it('is the first such day after the year ends, when the setting names one before April', () => {
    expect(taxDeadline('2026-06-05', '03-31')).toBe('2028-03-31');
    expect(taxDeadline('2026-06-05', '04-01')).toBe('2027-04-01');
  });
  it('makes a note dated after it late, and one on or before it not (F25)', () => {
    expect(isLate('2027-11-25', '2026-06-05', '11-30')).toBe(false);
    expect(isLate('2027-11-30', '2026-06-05', '11-30')).toBe(false);
    expect(isLate('2027-12-02', '2026-06-05', '11-30')).toBe(true);
  });
  it('takes the setting as a real month and day', () => {
    expect(['11-30', '02-28', '02-29', '13-01', '1-30', '11-30x', 'x11-30'].map(isMonthDay))
      .toEqual([true, true, false, false, false, false, false]);
  });
});
