// A purchase order's printout (RAD-136, on RAD-120's engine): what we ask the supplier for, at what rates, with its tax.
// It isn't a tax document, so the supplier's address prints as the screen shows it: with parties:contact or pii:read,
// else "Hidden". A draft has no number yet, so it doesn't print.
import { getCompanyProfile, getPartyById } from '@radcore/lib-accounts';
import { amountInWords, dec, formatDate, formatMoney } from '@radcore/lib-common';
import { AppError, type Ctx, type PrintBlock, type PrintDef } from '@radcore/lib-platform';
import { getOrderById } from '../services/orders.ts';

type Detail = string | { masked: string } | null;
const text = (v: Detail): string => (v === null ? '' : typeof v === 'string' ? v : v.masked);
const oneLine = (parts: readonly string[]) => parts.filter((p) => p !== '').join(', ');
const rupees = (x: string | null): string => (x === null ? '—' : formatMoney(x));

async function orderOf(ctx: Ctx, id: string) {
  const o = await getOrderById(ctx, { id });
  if (o.status === 'draft') throw new AppError('wrong_status', 'A draft purchase order has no number yet: place it to print it');
  const { company } = await getCompanyProfile(ctx);
  const p = await getPartyById(ctx, { id: o.supplierId });
  const shown = ctx.shows('whole', 'parties:contact');
  const address = shown ? oneLine([text(p.addressLine1), text(p.addressLine2), `${text(p.city)} ${text(p.pincode)}`.trim()]) : 'Hidden';
  return { ...o, company, supplier: { id: p.id, name: p.name, gstin: p.gstin, stateCode: p.stateCode, address, shown } };
}

export const purchaseOrderPrint: PrintDef<Awaited<ReturnType<typeof orderOf>>> = {
  read: orderOf,
  title: (m) => `Purchase order ${m.number ?? ''}`,
  looks: (m) => (m.supplier.shown ? [{ table: 'parties', id: m.supplier.id }] : []),
  layout: (m) => {
    const c = m.company;
    const a = m.amounts;
    const taxes = ([['CGST', a.cgst], ['SGST', a.sgst], ['IGST', a.igst], ['Round off', a.roundOff]] as const)
      .filter(([, v]) => v !== null && !dec(v).isZero()).map(([label, v]) => ({ label, value: rupees(v) }));
    const blocks: PrintBlock[] = [
      { kind: 'heading', text: 'Purchase order' },
      ...(c === null ? [] : [{ kind: 'text', text: c.legalName, bold: true } as const,
        { kind: 'text', text: oneLine([c.addressLine1, c.addressLine2 ?? '', `${c.city} ${c.pincode}`]) } as const,
        { kind: 'pairs', rows: [['GSTIN', c.gstin], ['State code', c.stateCode]] } as const]),
      { kind: 'pairs', rows: [['PO no.', m.number ?? ''], ['Date', formatDate(m.businessDate)],
        ...(m.expectedBy === null ? [] : [['Expected by', formatDate(m.expectedBy)] as const])] },
      { kind: 'text', text: 'To', bold: true },
      { kind: 'text', text: m.supplier.name },
      ...(m.supplier.address === '' ? [] : [{ kind: 'text', text: m.supplier.address } as const]),
      { kind: 'pairs', rows: [['GSTIN', m.supplier.gstin ?? 'Unregistered'], ['State code', m.supplier.stateCode]] },
      { kind: 'table', columns: [{ label: '#', share: 0.6, onThermal: false }, { label: 'Item', share: 4 }, { label: 'Qty', share: 1.2, align: 'right' },
        { label: 'Rate', share: 1.8, align: 'right' }, { label: 'GST', share: 1, align: 'right', onThermal: false }, { label: 'Amount', share: 2, align: 'right' }],
      rows: m.lines.map((l) => [String(l.lineNo), `${l.name} (${l.sku})`, `${dec(l.qty).toString()} ${l.unit}`.trim(), rupees(l.rate),
        l.amounts.gstRate === null ? '—' : `${dec(l.amounts.gstRate).toString()}%`, rupees(l.amounts.lineTotal)]) },
      { kind: 'totals', rows: [{ label: 'Taxable value', value: rupees(a.taxable) }, ...taxes, { label: 'Total', value: rupees(a.total), strong: true }] },
      ...(a.total === null ? [] : [{ kind: 'text', text: amountInWords(a.total), small: true } as const]),
      ...(m.notes === null ? [] : [{ kind: 'text', text: m.notes, small: true } as const]),
      ...(c === null ? [] : [{ kind: 'rule' } as const, { kind: 'text', text: `For ${c.legalName}`, align: 'right', bold: true } as const,
        { kind: 'text', text: 'Authorised signatory', align: 'right', small: true } as const]),
    ];
    return blocks;
  },
};
