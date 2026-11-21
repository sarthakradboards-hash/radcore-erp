// Invoice links (M3-14, RAD-118; ADR-001 §6a, §7a; RC-047), re-exported by ../contract.ts. A posted invoice is sent
// to its customer as a link that shows it as issued, for `sales.document_link_days` (never past
// `platform.public_link_max_days`), until it's revoked or the invoice is cancelled. Making, listing and revoking links
// are under invoices:share, at the invoice's scope. Like every contract file it imports only zod, lib-common and other
// libraries' contract entries (D5).
import { dateString, defineContract, idString, momentString, moneyString, quantityString, unitPriceString } from '@radcore/lib-common';
import { linkToken } from '@radcore/lib-platform/contract';
import { z } from 'zod';

const read = { readOnly: true, isolation: 'read committed' } as const;
const write = { readOnly: false, isolation: 'read committed' } as const;
const money = () => moneyString();
const link = z.object({ id: idString(), expiresAt: momentString(), revokedAt: momentString().nullable(), createdAt: momentString(),
  createdBy: z.string() });

/** A link to a posted invoice. Its token is in `path`'s fragment, shown this once (only its hash is kept), so the answer is
 * never kept for a replay: the web prefixes its own origin. */
export const shareInvoice = defineContract({
  method: 'POST', path: '/sales/invoices/:id/links', auth: 'session', perm: 'invoices:share', tx: write, storesAnswer: false,
  input: z.object({ id: idString() }), output: z.object({ id: idString(), token: z.string(), path: z.string(), expiresAt: momentString() }),
  errors: ['wrong_status'],
});
/** An invoice's links, newest first, with no tokens. */
export const listInvoiceLinks = defineContract({
  method: 'GET', path: '/sales/invoices/:id/links', auth: 'session', perm: 'invoices:share', tx: read,
  input: z.object({ id: idString() }), output: z.object({ items: z.array(link) }),
});
/** Stops any link on the invoice working, now, whoever made it (so a leaked one can be killed). */
export const revokeInvoiceLink = defineContract({
  method: 'DELETE', path: '/sales/invoices/:id/links/:linkId', auth: 'session', perm: 'invoices:share', tx: write,
  input: z.object({ id: idString(), linkId: idString() }), output: z.object({}),
});

// What the invoice carries as issued (CGST Rule 46), as plain fields: the buyer's name, address and GSTIN in full, the
// architect's ruling on RAD-118. Nothing else personal and no cost figure is in it, masked or not.
const party = { addressLine1: z.string().nullable(), addressLine2: z.string().nullable(), city: z.string().nullable(),
  pincode: z.string().nullable(), stateCode: z.string() };
const viewLine = z.object({
  lineNo: z.number().int().positive(), sku: z.string(), name: z.string(), unit: z.string(), hsn: z.string().nullable(), qty: quantityString(),
  rate: unitPriceString(), discountPercent: z.string(), gstRate: z.string().nullable(), taxable: money().nullable(), cgst: money().nullable(),
  sgst: money().nullable(), igst: money().nullable(), cessAdValorem: money(), cessPerUnitAmount: money(), lineTotal: money().nullable(),
});
/** A posted invoice, for whoever holds its link (`sales.invoice_view`): view-only, each opening logged. */
export const viewInvoiceLink = defineContract({
  method: 'POST', path: '/l/invoice', auth: 'link', action: 'sales.invoice_view', rateLimit: 'token-link', perm: null, tx: read,
  input: z.object({ token: linkToken() }),
  output: z.object({
    number: z.string(), businessDate: dateString(), total: money(),
    issuer: z.object({ legalName: z.string(), gstin: z.string(), ...party, addressLine1: z.string(), city: z.string(), pincode: z.string() }),
    buyer: z.object({ name: z.string(), gstin: z.string().nullable(), ...party }),
    shipTo: z.object({ name: z.string(), address: z.string(), stateCode: z.string() }).nullable(),
    placeOfSupply: z.string().nullable(), taxable: money(), cgst: money(), sgst: money(), igst: money(), cess: money(), roundOff: z.string(),
    lines: z.array(viewLine),
  }),
});
