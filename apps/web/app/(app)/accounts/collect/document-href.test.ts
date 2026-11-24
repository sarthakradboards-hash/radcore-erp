import { expect, it } from 'vitest';
import { documentHref, documentWord } from './document-href.ts';

it('links the sales documents the app has a page for, and leaves the rest as plain text', () => {
  expect(documentHref('invoices', 'abc')).toBe('/sales/invoices/abc');
  expect(documentHref('credit_notes', 'abc')).toBe('/sales/credit-notes/abc');
  expect(documentHref('delivery_returns', 'abc')).toBe('/sales/delivery-returns/abc');
  expect(documentHref('payments', 'abc')).toBeNull();
  expect(documentHref('constructor', 'abc')).toBeNull();
});

it('words the documents a payment is applied to, and shows any other table as words', () => {
  expect(['invoices', 'credit_notes', 'purchase_bills'].map(documentWord)).toEqual(['Invoice', 'Credit note', 'Purchase bill']);
  expect(documentWord('delivery_returns')).toBe('delivery returns');
  expect(documentWord('constructor')).toBe('constructor');
});
