// A delivery's challan (RAD-120, Rule 55): the goods that went out, with each line's HSN, quantity, batches and
// serials, and the taxable value and tax posting worked out. The issuer is today's company profile, since a challan
// keeps no frozen copy. A draft has no number, so it isn't a challan yet.
import { getCompanyProfile } from '@radcore/lib-accounts';
import { dec, formatDate, roundMoney } from '@radcore/lib-common';
import { AppError, type PrintDef } from '@radcore/lib-platform';
import { itemLabels } from '@radcore/lib-stock';
import { getDeliveryById } from '../services/deliveries.ts';
import { issuerBlocks, partyBlocks, partyLook, partyOf, quantity, rupees, signature } from './shared.ts';

const challanOf = async (ctx: Parameters<PrintDef<unknown>['read']>[0], id: string) => {
  const d = await getDeliveryById(ctx, { id });
  if (d.number === null) throw new AppError('wrong_status', 'This delivery is a draft, so it has no number to print yet');
  const { company } = await getCompanyProfile(ctx);
  const party = await partyOf(ctx, d.partyId, true);
  const labels = await itemLabels(ctx, d.lines.map((l) => l.itemId));
  return { ...d, number: d.number, company, party, labels };
};

export const challanPrint: PrintDef<Awaited<ReturnType<typeof challanOf>>> = {
  read: challanOf,
  title: (m) => `Delivery challan ${m.number}`,
  looks: (m) => partyLook(m.party),
  layout: (m) => {
    const sum = (pick: (l: (typeof m.lines)[number]) => string | null) => roundMoney(m.lines.reduce((t, l) => t.plus(pick(l) ?? '0'), dec('0')));
    const taxable = sum((l) => l.taxable);
    const gst = sum((l) => l.gst);
    return [
      { kind: 'heading', text: m.status === 'cancelled' ? 'Delivery challan (cancelled)' : 'Delivery challan' },
      ...issuerBlocks(m.company),
      { kind: 'pairs', rows: [['Challan no.', m.number], ['Date', formatDate(m.businessDate)]] },
      ...partyBlocks('Consignee', m.party),
      { kind: 'table', columns: [{ label: '#', share: 0.6, onThermal: false }, { label: 'Item', share: 4 }, { label: 'HSN', share: 1.7 },
        { label: 'Qty', share: 1.2, align: 'right' }, { label: 'Batch / serials', share: 3 },
        { label: 'Taxable', share: 2, align: 'right', onThermal: false }],
      rows: m.lines.map((l) => {
        const item = m.labels.get(l.itemId);
        const picked = [...l.batches.flatMap((b) => (b.batchNo === null ? [] : [b.batchNo])), ...l.serials].join(', ');
        return [String(l.lineNo), `${l.name} (${l.sku})`, item?.hsn ?? '', quantity(l.qty, item?.unit ?? ''), picked, rupees(l.taxable)];
      }) },
      { kind: 'totals', rows: [{ label: 'Taxable value', value: rupees(taxable) }, { label: 'GST', value: rupees(gst) },
        { label: 'Value', value: rupees(roundMoney(dec(taxable).plus(gst))), strong: true }] },
      ...(m.company === null ? [] : signature(m.company.legalName)),
      { kind: 'text', text: 'Received in good condition by', small: true },
    ];
  },
};
