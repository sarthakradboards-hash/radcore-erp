'use client';
// What the sales screens share (RAD-125): the row types read off lib-sales' contracts, the refusals in the screen's
// words, and a document's lines as a table. The server holds every rule (credit, price, status, dates); the screens only
// draw what it sends and word what it refuses.
import { formatMoney } from '@radcore/lib-common';
import { getItem } from '@radcore/lib-stock/contract';
import type { getQuote, listOrders, listQuotes } from '@radcore/lib-sales/contract';
import { Fragment, useId } from 'react';
import type { z } from 'zod';
import { useApiQuery } from '../../../lib/api/query.ts';
import { t } from '../../../lib/i18n/index.ts';
import '../../../components/ui/table/table.css';
import { asPrice, asWritten } from '../admin/decimal.ts';

type Quote = z.output<typeof getQuote.output>;
export type QuoteRow = z.output<typeof listQuotes.output>['items'][number];
export type OrderRow = z.output<typeof listOrders.output>['items'][number];
type Line = Quote['lines'][number];

// needs_override has no line here: its message and the issues the server names read best as it sends them.
const CODES = ['date_in_future', 'date_before_source', 'unknown_party', 'not_a_customer', 'unknown_item', 'quantity_too_precise',
  'wrong_status', 'year_not_open', 'period_locked', 'no_gst_rate', 'order_delivered', 'reason_required', 'version_changed',
  'not_on_source', 'over_quantity', 'other_party', 'account_inactive', 'company_profile_incomplete',
  'buyer_details_required', 'still_applied', 'credit_note_stands', 'change_over_checks', 'unknown_location', 'location_inactive',
  'place_not_sellable', 'not_enough_stock', 'qty_not_positive', 'batches_mismatch', 'units_mismatch', 'serial_twice', 'not_serialised',
  'delivery_in_use', 'already_reversed', 'not_reversible'] as const;
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

/** A line as the table reads it: its amounts, and for an order's line how much has been delivered and invoiced. */
type TableLine = Line & { delivered?: string; invoiced?: string };
const money = (x: string | null) => (x === null ? '' : formatMoney(x));

/** The lines: item, quantity (and for an order, delivered and invoiced), rate before GST, discount, and the amounts. While a
 * draft's tax can't be worked out the tax columns are empty; the document's note says why. */
export function LinesTable({ number, lines }: { number: string | null; lines: readonly TableLine[] }) {
  const captionId = useId();
  const progress = lines.some((l) => l.delivered !== undefined);
  return (
    <div className="kit-table">
      <div className="kit-table-scroll" role="region" aria-labelledby={captionId} tabIndex={0}>
        <table>
          <caption id={captionId}>{number === null ? t('sales.lines') : t('sales.lines.of', { number })}</caption>
          <thead>
            <tr>
              <th scope="col">{t('sales.line.item')}</th>
              <th scope="col" className="kit-numeric">{t('sales.line.qty')}</th>
              {progress ? <th scope="col" className="kit-numeric">{t('sales.line.delivered')}</th> : null}
              {progress ? <th scope="col" className="kit-numeric">{t('sales.line.invoiced')}</th> : null}
              <th scope="col" className="kit-numeric">{t('sales.line.rate')}</th>
              <th scope="col" className="kit-numeric">{t('sales.line.discount')}</th>
              <th scope="col" className="kit-numeric">{t('sales.amounts.taxable')}</th>
              <th scope="col" className="kit-numeric">{t('sales.amounts.cgst')}</th>
              <th scope="col" className="kit-numeric">{t('sales.amounts.sgst')}</th>
              <th scope="col" className="kit-numeric">{t('sales.amounts.igst')}</th>
              <th scope="col" className="kit-numeric">{t('sales.amounts.lineTotal')}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td>{l.name} ({l.sku})</td>
                <td className="kit-numeric">{asWritten(l.qty)}</td>
                {progress ? <td className="kit-numeric">{l.delivered === undefined ? '' : asWritten(l.delivered)}</td> : null}
                {progress ? <td className="kit-numeric">{l.invoiced === undefined ? '' : asWritten(l.invoiced)}</td> : null}
                <td className="kit-numeric">{asPrice(l.rate)}</td>
                <td className="kit-numeric">{asWritten(l.discountPercent)}</td>
                <td className="kit-numeric">{money(l.amounts.taxable)}</td>
                <td className="kit-numeric">{money(l.amounts.cgst)}</td>
                <td className="kit-numeric">{money(l.amounts.sgst)}</td>
                <td className="kit-numeric">{money(l.amounts.igst)}</td>
                <td className="kit-numeric">{money(l.amounts.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type Amounts = Quote['amounts'];

/** The document's totals as the server worked them out (a draft's on read, a sent quote's or confirmed order's as stored), and
 * its note when the tax can't be worked out yet. The screen adds nothing up and holds no GST rule. */
export function AmountsSummary({ number, amounts }: { number: string | null; amounts: Amounts }) {
  const rows: [string, string | null][] = [
    [t('sales.amounts.taxable'), money(amounts.taxable)], [t('sales.amounts.cgst'), amounts.cgst === null ? null : money(amounts.cgst)],
    [t('sales.amounts.sgst'), amounts.sgst === null ? null : money(amounts.sgst)], [t('sales.amounts.igst'), amounts.igst === null ? null : money(amounts.igst)],
    [t('sales.amounts.roundOff'), amounts.roundOff === null ? null : money(amounts.roundOff)],
    [t('sales.amounts.total'), amounts.total === null ? null : money(amounts.total)],
  ];
  return (
    <>
      {amounts.note === null ? null : <p className="admin-notice">{amounts.note}</p>}
      <dl className="admin-facts" aria-label={t('sales.amounts.of', { number: numberText(number) })}>
        {rows.filter(([, v]) => v !== null).map(([label, value]) => <Fragment key={label}><dt>{label}</dt><dd>{value}</dd></Fragment>)}
      </dl>
    </>
  );
}
