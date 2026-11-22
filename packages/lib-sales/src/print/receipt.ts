// A receipt's printout (RAD-120, the architect's ruling): the slip for the person who paid, from lib-accounts'
// receiptForPrint. What was paid, how, and what it went against; never what's still owed. The issuer is today's
// company profile.
import { getCompanyProfile, receiptForPrint } from '@radcore/lib-accounts';
import { amountInWords, dec, formatDate } from '@radcore/lib-common';
import type { PrintBlock, PrintDef } from '@radcore/lib-platform';
import { issuerBlocks, rupees, signature } from './shared.ts';

const receiptOf = async (ctx: Parameters<PrintDef<unknown>['read']>[0], id: string) => {
  const r = await receiptForPrint(ctx, id);
  const { company } = await getCompanyProfile(ctx);
  return { ...r, company };
};

export const receiptPrint: PrintDef<Awaited<ReturnType<typeof receiptOf>>> = {
  read: receiptOf,
  title: (m) => `Receipt ${m.number}`,
  layout: (m) => {
    const against: PrintBlock[] = m.appliedTo.length === 0 ? [] : [{ kind: 'table',
      columns: [{ label: 'Against', share: 3 }, { label: 'Amount', share: 2, align: 'right' }],
      rows: m.appliedTo.map((a) => [a.document, rupees(a.amount)]) }];
    return [
      { kind: 'heading', text: 'Receipt' },
      ...issuerBlocks(m.company),
      { kind: 'pairs', rows: [['Receipt no.', m.number], ['Date', formatDate(m.businessDate)], ['Received from', m.partyName],
        ['Paid into', m.account], ...(m.reference === null ? [] : [['Reference', m.reference] as const])] },
      { kind: 'totals', rows: [...(dec(m.tds).isZero() ? [] : [{ label: 'Tax deducted at source', value: rupees(m.tds) }]),
        { label: 'Amount received', value: rupees(m.amount), strong: true }] },
      { kind: 'text', text: amountInWords(m.amount), small: true },
      ...against,
      ...(m.company === null ? [] : signature(m.company.legalName)),
    ];
  },
};
