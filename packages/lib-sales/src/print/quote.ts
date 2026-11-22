// A quote's printout (RAD-120): its lines at their rates and discounts, with the tax worked out as an invoice's. A
// draft prints marked as one, with no number. The issuer is today's company profile.
import { getCompanyProfile } from '@radcore/lib-accounts';
import { amountInWords, formatDate } from '@radcore/lib-common';
import type { PrintDef } from '@radcore/lib-platform';
import { getQuoteById } from '../services/quotes.ts';
import { issuerBlocks, partyBlocks, partyLook, partyOf, percent, quantity, rupees, signature, taxTotals } from './shared.ts';

const quoteOf = async (ctx: Parameters<PrintDef<unknown>['read']>[0], id: string) => {
  const q = await getQuoteById(ctx, { id });
  const { company } = await getCompanyProfile(ctx);
  const party = await partyOf(ctx, q.partyId, false);
  return { ...q, company, party };
};

export const quotePrint: PrintDef<Awaited<ReturnType<typeof quoteOf>>> = {
  read: quoteOf,
  title: (m) => (m.number === null ? 'Quotation (draft)' : `Quotation ${m.number}`),
  looks: (m) => partyLook(m.party),
  layout: (m) => [
    { kind: 'heading', text: m.number === null ? 'Quotation (draft)' : 'Quotation' },
    ...issuerBlocks(m.company),
    { kind: 'pairs', rows: [['Quotation no.', m.number ?? 'Draft'], ['Date', formatDate(m.businessDate)],
      ...(m.validUntil === null ? [] : [['Valid until', formatDate(m.validUntil)] as const])] },
    ...partyBlocks('To', m.party),
    { kind: 'table', columns: [{ label: '#', share: 0.6, onThermal: false }, { label: 'Item', share: 4 }, { label: 'Qty', share: 1.2, align: 'right' },
      { label: 'Rate', share: 1.8, align: 'right' }, { label: 'Disc.', share: 1, align: 'right', onThermal: false },
      { label: 'GST', share: 1, align: 'right', onThermal: false }, { label: 'Amount', share: 2, align: 'right' }],
    rows: m.lines.map((l) => [String(l.lineNo), `${l.name} (${l.sku})`, quantity(l.qty), rupees(l.rate), percent(l.discountPercent),
      percent(l.amounts.gstRate), rupees(l.amounts.lineTotal)]) },
    { kind: 'totals', rows: taxTotals(m.amounts) },
    // While a draft's tax can't be worked out, its note says why, in place of the total in words.
    { kind: 'text', text: m.amounts.total === null ? m.amounts.note ?? '' : amountInWords(m.amounts.total), small: true },
    ...(m.notes === null ? [] : [{ kind: 'text', text: m.notes, small: true } as const]),
    ...(m.company === null ? [] : signature(m.company.legalName)),
  ],
};
