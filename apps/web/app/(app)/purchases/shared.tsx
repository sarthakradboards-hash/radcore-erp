'use client';
// What the purchasing screens share (RAD-143): the refusals in the screen's words, where a PO is on its way, and its
// lines as a table. The server holds every rule (limits, approval, tax, what's been received); the screens draw what it
// sends and word what it refuses. No amount is worked out here (ADR-001, RC-176).
import { formatMoney } from '@radcore/lib-common';
import type { getPurchaseOrder } from '@radcore/lib-purchasing/contract';
import { useId } from 'react';
import type { z } from 'zod';
import { t } from '../../../lib/i18n/index.ts';
import '../../../components/ui/table/table.css';
import { asPrice, asWritten } from '../admin/decimal.ts';

type Order = z.output<typeof getPurchaseOrder.output>;

const CODES = ['date_in_future', 'year_not_open', 'period_locked', 'unknown_party', 'not_a_supplier', 'unknown_item', 'item_inactive',
  'quantity_too_precise', 'wrong_status', 'no_gst_rate', 'company_profile_incomplete', 'version_changed', 'series_full',
  'over_approved', 'fixed_once_placed', 'po_received', 'own_request', 'approver_too_new', 'not_pending'] as const;
/** The purchasing contracts' refusals in the screen's words, for Form's, ReasonDialog's and ConfirmDialog's `messages`. */
export const PURCHASE_MESSAGES: Partial<Record<string, string>> = Object.fromEntries(CODES.map((c) => [c, t(`purchases.err.${c}`)]));

/** A PO's number, or "Draft" while it has none. */
export const numberText = (number: string | null) => number ?? t('purchases.draft');
export const statusName = (s: Order['status']) => t(`purchases.status.${s}`);

/** The steps: draft, placed, closed; a cancelled PO's bar ends at Cancelled. */
export const orderSteps = (status: Order['status']) =>
  (status === 'cancelled' ? ['draft', 'placed', 'cancelled'] as const : ['draft', 'placed', 'closed'] as const)
    .map((key) => ({ key, label: statusName(key) }));

const money = (x: string | null) => (x === null ? '' : formatMoney(x));

/** The lines: item, quantity, how much has come in, rate before GST, and the amounts the server worked out. While a draft's
 * tax can't be worked out the tax columns are empty; the PO's note says why. */
export function OrderLines({ number, lines }: { number: string | null; lines: Order['lines'] }) {
  const captionId = useId();
  return (
    <div className="kit-table">
      <div className="kit-table-scroll" role="region" aria-labelledby={captionId} tabIndex={0}>
        <table>
          <caption id={captionId}>{number === null ? t('purchases.lines') : t('purchases.lines.of', { number })}</caption>
          <thead>
            <tr>
              <th scope="col">{t('purchases.line.item')}</th>
              <th scope="col" className="kit-numeric">{t('purchases.line.qty')}</th>
              <th scope="col" className="kit-numeric">{t('purchases.line.received')}</th>
              <th scope="col" className="kit-numeric">{t('purchases.line.rate')}</th>
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
                <td className="kit-numeric">{asWritten(l.qty)} {l.unit}</td>
                <td className="kit-numeric">{asWritten(l.received)}</td>
                <td className="kit-numeric">{asPrice(l.rate)}</td>
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
