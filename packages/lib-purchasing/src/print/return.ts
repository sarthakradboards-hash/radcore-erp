// A supplier return's printout (RAD-140, on RAD-120's engine): the goods going back to the supplier, and its debit note
// for any billed part (ADR-008 §8), Rule 53's particulars: its number and date, the bills it's against, and the tax. It's
// sent to the supplier, so it prints their name, address, state and GSTIN in full, never phone or email, and logs a look
// at the party (RAD-120's statutory rule). A draft has no number yet.
import { getCompanyProfile, getPartyById } from '@radcore/lib-accounts';
import { amountInWords, dec, formatDate, formatMoney } from '@radcore/lib-common';
import { AppError, type Ctx, type PrintBlock, type PrintDef } from '@radcore/lib-platform';
import { getReturnById } from '../services/returns.ts';

type Detail = string | { masked: string } | null;
// Statutory: the stored details in full. The service answers them unmasked (masking is the route's, on the way out).
const plain = (v: Detail): string => {
  if (v !== null && typeof v === 'object') throw new Error('a party’s stored detail came back masked');
  return v ?? '';
};
const oneLine = (parts: readonly string[]) => parts.filter((p) => p !== '').join(', ');

async function returnOf(ctx: Ctx, id: string) {
  const r = await getReturnById(ctx, { id });
  if (r.status === 'draft') throw new AppError('wrong_status', 'A draft return has no number yet: post it to print it');
  const { company } = await getCompanyProfile(ctx);
  const p = await getPartyById(ctx, { id: r.supplierId });
  const address = oneLine([plain(p.addressLine1), plain(p.addressLine2), `${plain(p.city)} ${plain(p.pincode)}`.trim()]);
  return { ...r, company, supplier: { id: p.id, name: p.name, gstin: p.gstin, stateCode: p.stateCode, address } };
}

export const supplierReturnPrint: PrintDef<Awaited<ReturnType<typeof returnOf>>> = {
  read: returnOf,
  title: (m) => `Supplier return ${m.number ?? ''}`,
  looks: (m) => [{ table: 'parties', id: m.supplier.id }],
  layout: (m) => {
    const c = m.company;
    const d = m.debitNote;
    const billed = m.lines.flatMap((l) => l.billed);
    const blocks: PrintBlock[] = [
      { kind: 'heading', text: `${m.debitNote === null ? 'Supplier return' : 'Debit note'}${m.status === 'cancelled' ? ' (cancelled)' : ''}` },
      ...(c === null ? [] : [{ kind: 'text', text: c.legalName, bold: true } as const,
        { kind: 'text', text: oneLine([c.addressLine1, c.addressLine2 ?? '', `${c.city} ${c.pincode}`]) } as const,
        { kind: 'pairs', rows: [['GSTIN', c.gstin], ['State code', c.stateCode]] } as const]),
      { kind: 'pairs', rows: [...(m.debitNote === null ? [] : [['Debit note no.', m.debitNote.number ?? ''] as const]), ['Return no.', m.number ?? ''],
        ['Date', formatDate(m.businessDate)],
        ...(billed.length === 0 ? [] : [['Against bills', [...new Set(billed.map((b) => b.billNumber))].join(', ')] as const])] },
      { kind: 'text', text: 'To', bold: true },
      { kind: 'text', text: m.supplier.name },
      ...(m.supplier.address === '' ? [] : [{ kind: 'text', text: m.supplier.address } as const]),
      { kind: 'pairs', rows: [['GSTIN', m.supplier.gstin ?? 'Unregistered'], ['State code', m.supplier.stateCode]] },
      { kind: 'table', columns: [{ label: '#', share: 0.6, onThermal: false }, { label: 'Item', share: 4 }, { label: 'Receipt', share: 2, onThermal: false },
        { label: 'Qty', share: 1.2, align: 'right' }, { label: 'Rate', share: 1.8, align: 'right' }, { label: 'Value', share: 2, align: 'right' }],
      rows: m.lines.map((l) => [String(l.lineNo), `${l.name} (${l.sku})${l.serials.length === 0 ? '' : `: ${l.serials.join(', ')}`}`,
        l.receiptNumber ?? '', `${dec(l.qty).toString()} ${l.unit}`.trim(), formatMoney(l.rate), formatMoney(l.unbilledValue)]) },
      ...(d === null ? [{ kind: 'totals', rows: [{ label: 'Value of goods returned', value: formatMoney(m.unbilledValue), strong: true }] } as const,
        { kind: 'text', text: amountInWords(m.unbilledValue), small: true } as const] : [
        { kind: 'table', columns: [{ label: 'Bill', share: 2 }, { label: 'Qty', share: 1.2, align: 'right' }, { label: 'Rate', share: 1.8, align: 'right' },
          { label: 'GST', share: 1, align: 'right', onThermal: false }, { label: 'Taxable', share: 2, align: 'right' }],
        rows: billed.map((b) => [b.billNumber, dec(b.qty).toString(), formatMoney(b.rate), b.gstRate === null ? '—' : `${dec(b.gstRate).toString()}%`,
          formatMoney(b.taxable)]) } as const,
        { kind: 'totals', rows: [
          ...(dec(m.unbilledValue).isZero() ? [] : [{ label: 'Not billed, back to goods received', value: formatMoney(m.unbilledValue) }]),
          { label: 'Taxable value', value: formatMoney(d.taxable) },
          ...([['CGST', d.cgst], ['SGST', d.sgst], ['IGST', d.igst], ['Round off', d.roundOff]] as const)
            .filter(([, v]) => v !== null && !dec(v).isZero()).map(([label, v]) => ({ label, value: formatMoney(v ?? '0') })),
          { label: 'Total debited', value: formatMoney(d.total), strong: true }] } as const,
        { kind: 'text', text: amountInWords(d.total), small: true } as const]),
      { kind: 'text', text: `Reason: ${m.reason}`, small: true },
      ...(m.notes === null ? [] : [{ kind: 'text', text: m.notes, small: true } as const]),
      ...(c === null ? [] : [{ kind: 'rule' } as const, { kind: 'text', text: `For ${c.legalName}`, align: 'right', bold: true } as const,
        { kind: 'text', text: 'Authorised signatory', align: 'right', small: true } as const]),
    ];
    return blocks;
  },
};
