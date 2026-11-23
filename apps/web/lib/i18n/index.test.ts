import { expect, it } from 'vitest';
import { admin } from './admin.ts';
import { books } from './books.ts';
import { core, t } from './index.ts';
import { bookings } from './bookings.ts';
import { deliveries } from './deliveries.ts';
import { approvals } from './approvals.ts';
import { quickBill } from './quick-bill.ts';
import { testRides } from './test-rides.ts';
import { collect } from './collect.ts';
import { creditNotes } from './credit-notes.ts';
import { crm } from './crm.ts';
import { invoices } from './invoices.ts';
import { kit } from './kit.ts';
import { masters } from './masters.ts';
import { sales } from './sales.ts';

it('fills placeholders and leaves an unknown one visible', () => {
  expect(t('error.reference', { id: 'abc123' })).toBe('Reference: abc123');
  expect(t('error.reference')).toBe('Reference: {id}');
  expect(t('notFound.title')).toBe('Page not found');
  expect(t('error.reference', {} as Record<string, string>)).toBe('Reference: {id}');
  expect(t('error.reference', Object.create({ id: 'inherited' }) as Record<string, string>)).toBe('Reference: {id}');
});

it('keeps each catalogue under its own prefix, so no key replaces another', () => {
  const catalogues = { core, admin, masters, books, collect, sales, invoices, approvals, deliveries, creditNotes, testRides, bookings, quickBill, crm, kit };
  const seen = new Map<string, string>();
  for (const [name, catalogue] of Object.entries(catalogues)) {
    for (const key of Object.keys(catalogue)) {
      expect(seen.get(key), `"${key}" is in both ${seen.get(key) ?? ''} and ${name}`).toBeUndefined();
      seen.set(key, name);
    }
  }
  expect(Object.keys(admin).every((k) => k.startsWith('admin.'))).toBe(true);
  expect(Object.keys(masters).every((k) => k.startsWith('admin.'))).toBe(true);
  expect(Object.keys(kit).every((k) => k.startsWith('kit.'))).toBe(true);
  expect(Object.keys(crm).every((k) => k.startsWith('crm.'))).toBe(true);
  expect(Object.keys(books).every((k) => k.startsWith('books.'))).toBe(true);
  expect(Object.keys(collect).every((k) => k.startsWith('books.'))).toBe(true);
  expect(Object.keys(sales).every((k) => k.startsWith('sales.'))).toBe(true);
  expect(Object.keys(invoices).every((k) => k.startsWith('sales.'))).toBe(true);
  expect(Object.keys(approvals).every((k) => k.startsWith('sales.'))).toBe(true);
  expect(Object.keys(creditNotes).every((k) => k.startsWith('sales.'))).toBe(true);
  expect(Object.keys(quickBill).every((k) => k.startsWith('sales.'))).toBe(true);
  expect(Object.keys(testRides).every((k) => k.startsWith('sales.'))).toBe(true);
  expect(Object.keys(bookings).every((k) => k.startsWith('sales.'))).toBe(true);
  expect(Object.keys(deliveries).every((k) => k.startsWith('sales.'))).toBe(true);
  expect(Object.keys(core).some((k) => k.startsWith('admin.') || k.startsWith('books.') || k.startsWith('kit.'))).toBe(false);
});
