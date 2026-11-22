'use client';
// What the deliveries and delivery returns screens share (RAD-125): their row types read off lib-sales' contracts, a place
// by its name, and the lines of a draft or posted document as a table. A delivery's lines name the batches and serials the
// goods came from; what posting wrote (the cost it went out at, what it sold for, the GST) is empty on a draft.
import { formatMoney, isMasked, type Masked } from '@radcore/lib-common';
import type { getDelivery, listDeliveries, listDeliveryReturns } from '@radcore/lib-sales/contract';
import { listLocations } from '@radcore/lib-stock/contract';
import { useId } from 'react';
import type { z } from 'zod';
import { Pii } from '../../../../components/ui/masked.tsx';
import { useApiList } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import '../../../../components/ui/table/table.css';
import { asWritten } from '../../admin/decimal.ts';
import { SALES_MESSAGES } from '../shared.tsx';

export const STATUSES = ['draft', 'posted', 'cancelled'] as const;
export type DeliveryRow = z.output<typeof listDeliveries.output>['items'][number];
type Delivery = z.output<typeof getDelivery.output>;
export type ReturnRow = z.output<typeof listDeliveryReturns.output>['items'][number];
/** What the table reads of a line: a delivery's and a return's lines share it (they differ only in the line they point to). */
type Line = Pick<Delivery['lines'][number], 'id' | 'name' | 'sku' | 'qty' | 'batches' | 'serials' | 'taxable' | 'gst' | 'value'>;

/** A place by its name, from the location list (locations:read); a person who can't read it sees a plain word.
 * shortcut: only the first 200 places are searched, so a company with more shows "A place" for the rest; give the locations
 * contract a get-by-id when one has that many (auditor-3 on #288). */
export function PlaceName({ id }: { id: string }) {
  const places = useApiList(listLocations, { filter: {} }, { limit: 200 });
  if (places.error !== null) return t('sales.delivery.place.unknown');
  return places.items.find((l) => l.id === id)?.name ?? (places.isPending ? t('loading') : t('sales.delivery.place.unknown'));
}

/** A money figure from posting: empty on a draft, a mask when the person may not see a cost. */
function Money({ x }: { x: string | null | Masked }) {
  if (x === null) return '';
  return isMasked(x) ? <Pii value={x} /> : formatMoney(x);
}

const batchesText = (l: Line) => (l.batches.some((b) => b.batchId === null)
  ? t('sales.delivery.batchUnknown') : t('sales.delivery.batches', { n: String(l.batches.length) }));

/** The lines: item, quantity, where from, serials, and what posting wrote. */
export function DocumentLines({ caption, lines }: { caption: string; lines: readonly Line[] }) {
  const captionId = useId();
  return (
    <div className="kit-table">
      <div className="kit-table-scroll" role="region" aria-labelledby={captionId} tabIndex={0}>
        <table>
          <caption id={captionId}>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">{t('sales.line.item')}</th>
              <th scope="col" className="kit-numeric">{t('sales.line.qty')}</th>
              <th scope="col">{t('sales.delivery.col.batches')}</th>
              <th scope="col">{t('sales.delivery.col.serials')}</th>
              <th scope="col" className="kit-numeric">{t('sales.delivery.col.taxable')}</th>
              <th scope="col" className="kit-numeric">{t('sales.delivery.col.gst')}</th>
              <th scope="col" className="kit-numeric">{t('sales.delivery.col.value')}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td>{l.name} ({l.sku})</td>
                <td className="kit-numeric">{asWritten(l.qty)}</td>
                <td>{batchesText(l)}</td>
                <td>{l.serials.length === 0 ? t('sales.delivery.noSerials') : t('sales.delivery.serials', { n: String(l.serials.length) })}</td>
                <td className="kit-numeric"><Money x={l.taxable} /></td>
                <td className="kit-numeric"><Money x={l.gst} /></td>
                <td className="kit-numeric"><Money x={l.value} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The date refusal means something different on each document and on a cancellation, so each says its own (see the invoice's). */
const own = (code: string): Partial<Record<string, string>> => ({ ...SALES_MESSAGES, date_before_source: code });
// A delivery's own words for the two refusals that read as an invoice's in the shared ones (e2e-2 on #293).
export const DELIVERY_MESSAGES = { ...own(t('sales.delivery.err.date_before_source')), over_quantity: t('sales.delivery.err.over_quantity'),
  not_on_source: t('sales.delivery.err.not_on_source') };
export const DELIVERY_CANCEL_MESSAGES = own(t('sales.delivery.err.cancel_date'));
// A return's own words for the two refusals that read as an invoice's in the shared ones (e2e-2 on #293).
export const RETURN_MESSAGES = { ...own(t('sales.return.err.date_before_source')), over_quantity: t('sales.return.err.over_quantity'),
  not_on_source: t('sales.return.err.not_on_source') };
export const RETURN_CANCEL_MESSAGES = own(t('sales.return.err.cancel_date'));
