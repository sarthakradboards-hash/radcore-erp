import { t } from '../../../../lib/i18n/index.ts';

// The page of a document a statement entry or an open bill comes from (RAD-126), for the documents the app has a page for.
const PAGES = new Map([['invoices', '/sales/invoices'], ['credit_notes', '/sales/credit-notes'], ['deliveries', '/sales/deliveries'],
  ['delivery_returns', '/sales/delivery-returns'], ['purchase_bills', '/purchases/bills']]);

export const documentHref = (table: string, id: string): string | null => {
  const page = PAGES.get(table);
  return page === undefined ? null : `${page}/${id}`;
};

// What a document table is called on screen, for the kinds a payment is applied to; any other shows its table name as words.
const WORDS = new Map([['invoices', t('books.pay.doc.invoices')], ['credit_notes', t('books.pay.doc.credit_notes')], ['purchase_bills', t('books.pay.doc.purchase_bills')]]);

export const documentWord = (table: string): string => WORDS.get(table) ?? table.replaceAll('_', ' ');
