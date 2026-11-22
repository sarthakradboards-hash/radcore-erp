// Invoice links (M3-14, RAD-118; ADR-001 §6a, §7a; RC-047): a posted invoice sent to its customer as a link, under
// invoices:share at the invoice's scope (the architect's ruling). The link shows the invoice as issued, from its own
// frozen copy of the issuer and buyer: no party is read. A cancelled invoice's link answers as a dead one does.
import { invoiceLines, invoices, salesTx } from '@radcore/db/sales';
import type { Money } from '@radcore/lib-common';
import { AppError, createLink, defineSetting, linkMaxDays, linkRecord, linkUrl, listLinks, revokeLink, type Ctx } from '@radcore/lib-platform';
import { itemLabels } from '@radcore/lib-stock';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { listInvoiceLinks, revokeInvoiceLink, shareInvoice, viewInvoiceLink } from '../contract.ts';
import { invoiceOf, wrongStatus } from './invoices.ts';

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;
const VIEW = 'sales.invoice_view';
const PATH = '/l/invoice';
const DAY = 86_400_000;

/** How long a link to an invoice lasts; never longer than any link may (`platform.public_link_max_days`). */
export const DOCUMENT_LINK_DAYS = defineSetting('sales.document_link_days', z.number().int().min(1).max(365), 30, {
  label: 'Invoice links last',
  description: 'How many days a link sent to a customer to see their invoice stays open.',
  input: { kind: 'integer' },
  check: async (ctx, days) => {
    const most = ctx.settings.get(linkMaxDays);
    return days > most ? `At most ${most} days: no shared link lasts longer` : null;
  },
});

/** POST /sales/invoices/:id/links (invoices:share): a link to a posted invoice, its token shown this once. */
export async function shareInvoiceLink(ctx: Ctx, { id }: In<typeof shareInvoice>): Promise<Out<typeof shareInvoice>> {
  const inv = await invoiceOf(ctx, id, 'invoices:share');
  if (inv.status !== 'posted') throw wrongStatus(inv.status, 'shared');
  const days = Math.min(ctx.settings.get(DOCUMENT_LINK_DAYS), ctx.settings.get(linkMaxDays));
  const expiresAt = new Date(Date.now() + days * DAY);
  const link = await createLink(ctx, { action: VIEW, recordTable: 'invoices', recordId: id, expiresAt });
  return { id: link.id, token: link.token, path: linkUrl('', PATH, link.token), expiresAt: expiresAt.toISOString() };
}

const links = async (ctx: Ctx, id: string) => {
  await invoiceOf(ctx, id, 'invoices:share');
  return listLinks(ctx, VIEW, id);
};

/** GET /sales/invoices/:id/links (invoices:share): newest first, with no tokens. */
export async function invoiceLinks(ctx: Ctx, { id }: In<typeof listInvoiceLinks>): Promise<Out<typeof listInvoiceLinks>> {
  return { items: (await links(ctx, id)).map((l) => ({ id: l.id, expiresAt: l.expiresAt.toISOString(),
    revokedAt: l.revokedAt?.toISOString() ?? null, createdAt: l.createdAt.toISOString(), createdBy: l.createdBy })) };
}

/** DELETE /sales/invoices/:id/links/:linkId (invoices:share): any link on the invoice, whoever made it. */
export async function revokeInvoiceLinkNow(ctx: Ctx, { id, linkId }: In<typeof revokeInvoiceLink>): Promise<Out<typeof revokeInvoiceLink>> {
  if (!(await links(ctx, id)).some((l) => l.id === linkId)) throw new AppError('not_found', 'There is no such link on this invoice');
  await revokeLink(ctx, linkId);
  return {};
}

/** POST /l/invoice (a `sales.invoice_view` link): the link's own invoice as issued, while it stands posted. */
// Its input is empty: the handler takes the token out, and the link alone names the record.
export async function invoiceByLink(ctx: Ctx): Promise<Out<typeof viewInvoiceLink>> {
  const id = linkRecord(ctx, VIEW);
  const [r] = await salesTx(ctx).select().from(invoices).where(eq(invoices.id, id));
  if (r?.status !== 'posted' || r.number === null) throw new AppError('not_found', 'Not found');
  return issuedInvoice(ctx, { ...r, number: r.number });
}

/** An invoice as it was issued, from its own frozen copy of the issuer and buyer: the link's view and the printout's
 * (RAD-120). The caller has read the row within its scope, and it has a number. */
export async function issuedInvoice(ctx: Ctx, r: typeof invoices.$inferSelect & { number: string }): Promise<Out<typeof viewInvoiceLink>> {
  const lines = await salesTx(ctx).select().from(invoiceLines).where(eq(invoiceLines.invoiceId, r.id)).orderBy(asc(invoiceLines.lineNo));
  const items = await itemLabels(ctx, lines.map((l) => l.itemId));
  return {
    number: r.number, businessDate: r.businessDate, total: r.total as Money,
    issuer: { legalName: r.issuerLegalName ?? '', gstin: r.issuerGstin ?? '', addressLine1: r.issuerAddressLine1 ?? '',
      addressLine2: r.issuerAddressLine2, city: r.issuerCity ?? '', pincode: r.issuerPincode ?? '', stateCode: r.issuerStateCode ?? '' },
    buyer: { name: r.buyerName ?? '', gstin: r.buyerGstin, addressLine1: r.buyerAddressLine1, addressLine2: r.buyerAddressLine2,
      city: r.buyerCity, pincode: r.buyerPincode, stateCode: r.buyerStateCode ?? '' },
    shipTo: r.shipToName === null ? null : { name: r.shipToName, address: r.shipToAddress ?? '', stateCode: r.shipToStateCode ?? '' },
    placeOfSupply: r.placeOfSupply, taxable: r.taxable as Money, cgst: r.cgst as Money, sgst: r.sgst as Money, igst: r.igst as Money,
    cess: r.cess as Money, roundOff: r.roundOff,
    lines: lines.map((l) => {
      const item = items.get(l.itemId);
      return { lineNo: l.lineNo, sku: item?.sku ?? '', name: item?.name ?? '', unit: item?.unit ?? '', hsn: l.hsn, qty: l.qty, rate: l.rate,
        discountPercent: l.discountPercent, gstRate: l.gstRate, taxable: l.taxable, cgst: l.cgst, sgst: l.sgst, igst: l.igst,
        cessAdValorem: l.cessAdValorem, cessPerUnitAmount: l.cessPerUnitAmount, lineTotal: l.lineTotal,
        unitCondition: l.unitCondition as 'demo' | 'used' | 'damaged' | null };
    }),
  };
}
