import { t } from '../../../../lib/i18n/index.ts';

// The page of a document a statement entry or an open bill comes from (RAD-126), for the documents the app has a page for.
const PAGES = new Map([['invoices', 'invoices'], ['credit_notes', 'credit-notes'], ['deliveries', 'deliveries'], ['delivery_returns', 'delivery-returns']]);

export const documentHref = (table: string, id: string): string | null => {
  const page = PAGES.get(table);
  return page === undefined ? null : `/sales/${page}/${id}`;
};

// What a document table is called on screen, for the kinds a payment is applied to; any other shows its table name as words.
const WORDS = new Map([['invoices', t('books.pay.doc.invoices')], ['credit_notes', t('books.pay.doc.credit_notes')], ['purchase_bills', t('books.pay.doc.purchase_bills')]]);

export const documentWord = (table: string): string => WORDS.get(table) ?? table.replaceAll('_', ' ');
