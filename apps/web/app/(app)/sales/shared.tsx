'use client';
// What the sales screens share (RAD-125): the row types read off lib-sales' contracts, the refusals in the screen's
// words, and a document's lines as a table. The server holds every rule (credit, price, status, dates); the screens only
// draw what it sends and word what it refuses.
import { getItem } from '@radcore/lib-stock/contract';
import type { getQuote, listOrders, listQuotes } from '@radcore/lib-sales/contract';
import { useId } from 'react';
import type { z } from 'zod';
import { useApiQuery } from '../../../lib/api/query.ts';
import { t } from '../../../lib/i18n/index.ts';
import '../../../components/ui/table/table.css';
import { asPrice, asWritten } from '../admin/decimal.ts';

type Quote = z.output<typeof getQuote.output>;
export type QuoteRow = z.output<typeof listQuotes.output>['items'][number];
export type OrderRow = z.output<typeof listOrders.output>['items'][number];
export type Line = Quote['lines'][number];

// needs_override has no line here: its message and the issues the server names read best as it sends them.
const CODES = ['date_in_future', 'date_before_source', 'unknown_party', 'not_a_customer', 'unknown_item', 'quantity_too_precise',
  'wrong_status', 'year_not_open', 'period_locked', 'no_gst_rate', 'order_delivered', 'reason_required', 'version_changed',
  'not_on_source', 'over_quantity', 'other_party', 'account_inactive', 'company_profile_incomplete',
  'buyer_details_required', 'still_applied', 'credit_note_stands', 'unknown_location', 'location_inactive', 'place_not_sellable',
  'not_enough_stock', 'qty_not_positive', 'batches_mismatch', 'units_mismatch', 'serial_twice', 'not_serialised', 'delivery_in_use',
  'already_reversed', 'not_reversible'] as const;
/** The sales contracts' refusals in the screen's words, for Form's and ReasonDialog's `messages`. */
export const SALES_MESSAGES: Partial<Record<string, string>> = Object.fromEntries(CODES.map((c) => [c, t(`sales.err.${c}`)]));

/** A document's number, or "Draft" while it has none. */
export const numberText = (number: string | null) => number ?? t('sales.draft');

/** An item by its name and SKU, read from the item list; a role that can't read items sees a plain word. */
export function ItemName({ id }: { id: string }) {
  const q = useApiQuery(getItem, { id });
  if (q.error !== null) return t('sales.line.unknownItem');
  return q.data === undefined ? t('loading') : `${q.data.name} (${q.data.sku})`;
}

/** The lines as they were written: item, quantity, rate before GST, and discount. */
export function LinesTable({ number, lines }: { number: string | null; lines: readonly Line[] }) {
  const captionId = useId();
  return (
    <div className="kit-table">
      <div className="kit-table-scroll" role="region" aria-labelledby={captionId} tabIndex={0}>
        <table>
          <caption id={captionId}>{number === null ? t('sales.lines') : t('sales.lines.of', { number })}</caption>
          <thead>
            <tr>
              <th scope="col">{t('sales.line.item')}</th>
              <th scope="col" className="kit-numeric">{t('sales.line.qty')}</th>
              <th scope="col" className="kit-numeric">{t('sales.line.rate')}</th>
              <th scope="col" className="kit-numeric">{t('sales.line.discount')}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td>{l.name} ({l.sku})</td>
                <td className="kit-numeric">{asWritten(l.qty)}</td>
                <td className="kit-numeric">{asPrice(l.rate)}</td>
                <td className="kit-numeric">{asWritten(l.discountPercent)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
