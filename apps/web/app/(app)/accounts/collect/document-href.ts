// The page of a document a statement entry or an open bill comes from (RAD-126), for the documents the app has a page for.
const PAGES = new Map([['invoices', 'invoices'], ['credit_notes', 'credit-notes'], ['deliveries', 'deliveries'], ['delivery_returns', 'delivery-returns']]);

export const documentHref = (table: string, id: string): string | null => {
  const page = PAGES.get(table);
  return page === undefined ? null : `/sales/${page}/${id}`;
};
