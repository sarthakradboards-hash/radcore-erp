import { expect, it } from 'vitest';
import { documentHref } from './document-href.ts';

it('links the sales documents the app has a page for, and leaves the rest as plain text', () => {
  expect(documentHref('invoices', 'abc')).toBe('/sales/invoices/abc');
  expect(documentHref('credit_notes', 'abc')).toBe('/sales/credit-notes/abc');
  expect(documentHref('delivery_returns', 'abc')).toBe('/sales/delivery-returns/abc');
  expect(documentHref('payments', 'abc')).toBeNull();
  expect(documentHref('constructor', 'abc')).toBeNull();
});
