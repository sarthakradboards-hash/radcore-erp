// The sales documents' printouts (RAD-120, RC-152; ADR-007 §7), re-exported by ../contract.ts: each a PDF on A4 or the
// 80 mm roll, made by the server, under the document's own read key and scope, and logged as a look at it. Their
// templates are in ../print/. Like every contract file it imports only zod, lib-common and other libraries' contract
// entries (D5).
import { printContract } from '@radcore/lib-platform/contract';

/** A posted or cancelled invoice, with every Rule 46 particular; a draft has no number yet (wrong_status). */
export const printInvoice = printContract('/sales/invoices/:id/pdf', 'sales:read', 'invoices', ['wrong_status']);
/** A posted delivery's challan (Rule 55); a draft has no number yet (wrong_status). */
export const printChallan = printContract('/sales/deliveries/:id/pdf', 'sales:read', 'deliveries', ['wrong_status']);
/** A quote, a draft one marked as a draft. */
export const printQuote = printContract('/sales/quotes/:id/pdf', 'sales:read', 'sales_quotes');
