import { expect, it } from 'vitest';
import { creditWords, expenseTitle, lineName, readCashVersion } from './expense-values.ts';

const categories = [{ id: 'c1', name: 'Travel', credit: 'blocked' as const, blockedClause: '(g)', active: true, defaultTdsSectionId: null, defaultSac: null,
  accounts: [{ id: 'a1', code: '5100', name: 'Fuel' }] }];

it('names a line by its category and account, and never by a raw id', () => {
  expect(lineName(categories, { categoryId: 'c1', accountId: 'a1' })).toBe('Travel: Fuel');
  expect(lineName(categories, { categoryId: 'c1', accountId: 'gone' })).not.toContain('gone');
});

it('says what credit a posted line claimed, or why none', () => {
  expect(creditWords(null)).toBe('');
  expect(creditWords({ cgst: '9.10', sgst: '9.10', igst: '0.00', reason: null })).toContain('18.20');
  expect(creditWords({ cgst: '0.00', sgst: '0.00', igst: '0.00', reason: 'blocked' })).toMatch(/blocked/i);
});

it('titles a draft by the supplier’s bill, and reads only a whole approval version', () => {
  expect(expenseTitle({ number: 'EX/26-27/0001', supplierInvoiceNumber: 'B-7' })).toBe('EX/26-27/0001');
  expect(expenseTitle({ number: null, supplierInvoiceNumber: 'B-7' })).toContain('B-7');
  const v = { businessDate: '2026-11-27', payFromAccountId: 'cash', statedTotal: '11800.00', supplierInvoiceNumber: 'B-7', supplierInvoiceDate: '2026-11-26',
    lines: [{ categoryId: 'c1', accountId: 'a1', taxable: '10000.00', cgst: '900.00', sgst: '900.00', igst: '0.00' }] };
  expect(readCashVersion(v)?.statedTotal).toBe('11800.00');
  expect(readCashVersion({ ...v, lines: undefined })).toBeNull();
});
