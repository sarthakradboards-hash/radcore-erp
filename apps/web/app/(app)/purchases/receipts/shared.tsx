'use client';
// What the goods receipt screens share (RAD-143 on RAD-137's contracts): the row types read off lib-purchasing's contracts, the
// places a receipt can name, the refusals in the screen's words, the status bar's steps and the lines of a receipt as a table.
// What posting wrote (the accepted and rejected quantities, their values, the batches and the units) is empty on a draft.
import { formatMoney } from '@radcore/lib-common';
import type { getGoodsReceipt, listGoodsReceipts } from '@radcore/lib-purchasing/contract';
import { listLocationKinds, listLocations } from '@radcore/lib-stock/contract';
import { useId } from 'react';
import type { z } from 'zod';
import { useApiList, useApiQuery } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import '../../../../components/ui/table/table.css';
import { asWritten } from '../../admin/decimal.ts';
import { SALES_MESSAGES } from '../../sales/shared.tsx';

export const RECEIPT_STATUSES = ['draft', 'posted', 'cancelled'] as const;
export type ReceiptRow = z.output<typeof listGoodsReceipts.output>['items'][number];
type Receipt = z.output<typeof getGoodsReceipt.output>;
export type ReceiptLine = Receipt['lines'][number];

const OWN = ['unknown_order', 'order_not_placed', 'unknown_order_line', 'not_a_rejects_place', 'over_ordered', 'qc_mismatch',
  'reject_reason_required', 'serials_mismatch', 'serial_sold', 'serial_in_stock', 'chassis_required', 'chassis_not_allowed', 'chassis_taken',
  'series_full', 'receipt_in_use', 'not_enough_stock', 'date_before_source'] as const;
/** The receipt contracts' refusals in the screen's words, for Form's and ConfirmDialog's `messages`: the sales area's for the shared
 * codes (a date, a place, a serial), these screens' own for the rest. */
export const RECEIPT_MESSAGES: Partial<Record<string, string>> = {
  ...SALES_MESSAGES, ...Object.fromEntries(OWN.map((c) => [c, t(`inward.err.${c}`)])), forbidden: t('inward.err.forbidden'),
};

/** A receipt's number, or the plain word while QC hasn't been done (it has no number until then). */
export const receiptNumber = (number: string | null) => number ?? t('inward.waiting');

/** The status bar's steps: waiting for QC, posted, and on to cancelled for one that was. */
export const receiptSteps = (status: string) => (status === 'cancelled' ? ['draft', 'posted', 'cancelled'] : ['draft', 'posted'])
  .map((key) => ({ key, label: t(`inward.status.${key as 'draft'}`) }));

/** The places a receipt can name, from the location list (locations:read): `rejects` those of the rejects kind, else those of a kind that
 * sells. A person who can't read the kinds is offered every active place and the server refuses a wrong one. A draft's own place is
 * offered even when it can't be listed now, so it isn't lost. */
export function usePlaceChoices(current: string, want: 'sellable' | 'rejected') {
  const kinds = useApiQuery(listLocationKinds, {});
  const places = useApiList(listLocations, { filter: { status: 'active' } }, { limit: 200 });
  const sells = new Set(kinds.data?.kinds.filter((k) => k.sellable).map((k) => k.kind));
  const fits = (kind: string) => kinds.data === undefined || (want === 'rejected' ? kind === 'rejected' : sells.has(kind as never));
  const options = places.items.filter((l) => fits(l.kind)).map((l) => ({ value: l.id, label: l.name }));
  if (current !== '' && !options.some((o) => o.value === current)) options.push({ value: current, label: t('inward.place.unknown') });
  return { options, ready: !places.isPending && !kinds.isPending };
}

const batchText = (b: ReceiptLine['batches'][number]) => (b.batchNo === '' ? t('inward.line.batchOwn') : b.batchNo);

/** The lines: item, ordered, received, and what QC wrote (accepted and rejected with their values, batches, units, why). */
export function ReceiptLines({ caption, lines }: { caption: string; lines: readonly ReceiptLine[] }) {
  const captionId = useId();
  // What QC wrote: the quantity, and beside it the value the stock and the ledger carry (empty on a draft).
  const done = (qty: string | null, value: string | null) => (qty === null ? '' : value === null ? asWritten(qty) : `${asWritten(qty)} (${formatMoney(value)})`);
  return (
    <div className="kit-table">
      <div className="kit-table-scroll" role="region" aria-labelledby={captionId} tabIndex={0}>
        <table>
          <caption id={captionId}>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">{t('inward.line.item')}</th>
              <th scope="col" className="kit-numeric">{t('inward.line.ordered')}</th>
              <th scope="col" className="kit-numeric">{t('inward.line.received')}</th>
              <th scope="col" className="kit-numeric">{t('inward.line.accepted')}</th>
              <th scope="col" className="kit-numeric">{t('inward.line.rejected')}</th>
              <th scope="col">{t('inward.line.batches')}</th>
              <th scope="col">{t('inward.line.units')}</th>
              <th scope="col">{t('inward.line.reason')}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td>{l.name} ({l.sku})</td>
                <td className="kit-numeric">{asWritten(l.ordered)}</td>
                <td className="kit-numeric">{asWritten(l.received)}</td>
                <td className="kit-numeric">{done(l.accepted, l.acceptedValue)}</td>
                <td className="kit-numeric">{done(l.rejected, l.rejectedValue)}</td>
                <td>{l.batches.length === 0 ? t('inward.line.noBatches') : l.batches.map(batchText).join(', ')}</td>
                <td>{l.serials.length === 0 ? t('inward.line.units.none') : t('inward.line.units.n', { n: String(l.serials.length) })}</td>
                <td>{l.rejectReason ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
