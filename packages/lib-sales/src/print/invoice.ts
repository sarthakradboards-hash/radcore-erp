// The tax invoice's printout (RAD-120; ADR-007 §7, Rule 46, CA-35): as it was issued, from its own frozen copy of
// the issuer and buyer (RAD-118's issuedInvoice), so a reprint never reads today's profile (RC-022). Every Rule 46
// particular is on it, including "Tax payable on reverse charge: No" and the ship-to address. A draft has no number,
// so it isn't a tax invoice yet.
import { amountInWords, formatDate } from '@radcore/lib-common';
import { AppError, type PrintDef } from '@radcore/lib-platform';
import { issuedInvoice } from '../services/invoice-links.ts';
import { invoiceOf } from '../services/invoices.ts';
import { issuerBlocks, partyBlocks, percent, quantity, rupees, signature, taxTotals } from './shared.ts';

type Issued = Awaited<ReturnType<typeof issuedInvoice>> & { cancelled: boolean; partyId: string };

export const invoicePrint: PrintDef<Issued> = {
  async read(ctx, id) {
    const r = await invoiceOf(ctx, id, 'sales:read');
    if (r.number === null) throw new AppError('wrong_status', 'This invoice is a draft, so it has no number to print yet');
    return { ...(await issuedInvoice(ctx, { ...r, number: r.number })), cancelled: r.status === 'cancelled', partyId: r.partyId };
  },
  title: (m) => `Tax invoice ${m.number}`,
  // Its frozen buyer's address is on every copy (Rule 46): a look at the party, so the audit shows who printed it.
  looks: (m) => [{ table: 'parties', id: m.partyId }],
  layout: (m) => [
    { kind: 'heading', text: m.cancelled ? 'Tax invoice (cancelled)' : 'Tax invoice' },
    ...issuerBlocks(m.issuer),
    { kind: 'pairs', rows: [['Invoice no.', m.number], ['Date', formatDate(m.businessDate)],
      ['Place of supply', m.placeOfSupply ?? m.buyer.stateCode]] },
    ...partyBlocks('Bill to', m.buyer),
    ...(m.shipTo === null ? [] : [{ kind: 'text', text: 'Ship to', bold: true } as const, { kind: 'text', text: m.shipTo.name } as const,
      { kind: 'text', text: m.shipTo.address } as const, { kind: 'pairs', rows: [['State code', m.shipTo.stateCode]] } as const]),
    { kind: 'table', columns: [{ label: '#', share: 0.6, onThermal: false }, { label: 'Item', share: 4 }, { label: 'HSN', share: 1.7 },
      { label: 'Qty', share: 1.2, align: 'right' }, { label: 'Rate', share: 1.8, align: 'right', onThermal: false },
      { label: 'Taxable', share: 2, align: 'right', onThermal: false }, { label: 'GST', share: 1, align: 'right', onThermal: false },
      { label: 'Amount', share: 2, align: 'right' }],
    rows: m.lines.map((l) => [String(l.lineNo), `${l.name}${l.unitCondition === null ? '' : ` (${l.unitCondition})`}`, l.hsn ?? '',
      quantity(l.qty, l.unit), rupees(l.rate), rupees(l.taxable), percent(l.gstRate), rupees(l.lineTotal)]) },
    { kind: 'totals', rows: taxTotals({ ...m, roundOff: m.roundOff }) },
    { kind: 'text', text: amountInWords(m.total), small: true },
    { kind: 'text', text: 'Tax payable on reverse charge: No', small: true },
    ...signature(m.issuer.legalName),
  ],
};
