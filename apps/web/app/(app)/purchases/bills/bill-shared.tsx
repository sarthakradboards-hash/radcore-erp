'use client';
// What the purchase bill screens share (RAD-143 on RAD-138's contracts): status names, the status bar's steps, and the match view.
// The match view is three-way: each goods line's PO and receipt, its rate against the PO's, and whether that's past
// purchasing.bill_tolerance_pct, all as the server reports them (overPoRate, overTolerance). Nothing is worked out here.
// A reverse-charge charge (RAD-169 on RAD-153, ADR-010 §4) shows the GST we pay ourselves, by head, as the server reports it.
import { dec, formatMoney } from '@radcore/lib-common';
import type { getPurchaseBill } from '@radcore/lib-purchasing/contract';
import { useId } from 'react';
import type { z } from 'zod';
import { t } from '../../../../lib/i18n/index.ts';
import '../../../../components/ui/table/table.css';
import { asPrice, asWritten } from '../../admin/decimal.ts';

export type Bill = z.output<typeof getPurchaseBill.output>;
type Status = Bill['status'];

export const billStatusName = (s: Status) => t(`purchases.bill.status.${s}`);
/** Our number once posted, "Draft" before. */
export const billNumberText = (number: string | null) => number ?? t('purchases.bill.status.draft');
/** Draft, then posted; a cancelled bill's bar runs on to Cancelled. */
export const billSteps = (s: Status) => (s === 'cancelled' ? ['draft', 'posted', 'cancelled'] as const : ['draft', 'posted'] as const)
  .map((key) => ({ key, label: billStatusName(key) }));

const money = (x: string | null) => (x === null ? '' : formatMoney(x));
const tax = (a: Bill['lines'][number]['amounts']) => [a.cgst, a.sgst, a.igst].filter((x) => x !== null).map((x) => formatMoney(x)).join(' + ');
/** The reverse-charge heads that carry tax (IGST, or CGST + SGST), or nothing on a line that isn't under reverse charge. */
const rcmTax = ({ reverseCharge: r }: Bill['lines'][number]['amounts']) => {
  if (r === null) return '';
  const heads = [r.cgst, r.sgst, r.igst].filter((x) => !dec(x).isZero());
  return (heads.length === 0 ? [r.igst] : heads).map((x) => formatMoney(x)).join(' + ');
};

/** The match view: each goods line against its PO line and receipt line, then the charges. */
export function MatchView({ bill }: { bill: Bill }) {
  const goodsId = useId();
  const chargesId = useId();
  const jobWorkId = useId();
  const goods = bill.lines.filter((l) => l.kind === 'goods');
  const charges = bill.lines.filter((l) => l.kind === 'charge');
  const jobWork = bill.lines.filter((l) => l.kind === 'job_work');
  const rcm = charges.some((l) => l.amounts.reverseCharge !== null);
  return (
    <>
      <div className="kit-table">
        <div className="kit-table-scroll" role="region" aria-labelledby={goodsId} tabIndex={0}>
          <table>
            <caption id={goodsId}>{t('purchases.bill.match')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('purchases.bill.col.item')}</th>
                <th scope="col">{t('purchases.bill.col.po')}</th>
                <th scope="col">{t('purchases.bill.col.received')}</th>
                <th scope="col" className="kit-numeric">{t('purchases.bill.col.qty')}</th>
                <th scope="col" className="kit-numeric">{t('purchases.bill.col.poRate')}</th>
                <th scope="col" className="kit-numeric">{t('purchases.bill.col.rate')}</th>
                <th scope="col" className="kit-numeric">{t('purchases.bill.col.over')}</th>
                <th scope="col">{t('purchases.bill.col.verdict')}</th>
                <th scope="col" className="kit-numeric">{t('sales.amounts.taxable')}</th>
                <th scope="col" className="kit-numeric">{t('purchases.bill.col.gst')}</th>
                <th scope="col" className="kit-numeric">{t('purchases.bill.col.lineTotal')}</th>
              </tr>
            </thead>
            <tbody>
              {goods.map((l) => (
                <tr key={l.id}>
                  <td>{l.name} ({l.sku})</td>
                  <td>{l.poNumber}</td>
                  <td>{l.receiptLineId === null ? t('purchases.bill.notReceived') : t('purchases.bill.received')}</td>
                  <td className="kit-numeric">{asWritten(l.qty)} {l.unit}</td>
                  <td className="kit-numeric">{asPrice(l.poRate)}</td>
                  <td className="kit-numeric">{asPrice(l.rate)}</td>
                  <td className="kit-numeric">{l.overPoRate === null ? t('purchases.bill.freeItem') : `${asWritten(l.overPoRate)}%`}</td>
                  <td>{l.overTolerance ? <strong>{t('purchases.bill.pastTolerance')}</strong> : t('purchases.bill.withinTolerance')}</td>
                  <td className="kit-numeric">{money(l.amounts.taxable)}</td>
                  <td className="kit-numeric">{tax(l.amounts)}</td>
                  <td className="kit-numeric">{money(l.amounts.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {charges.length === 0 ? null : (
        <div className="kit-table">
          <div className="kit-table-scroll" role="region" aria-labelledby={chargesId} tabIndex={0}>
            <table>
              <caption id={chargesId}>{t('purchases.bill.charges')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('purchases.bill.col.charge')}</th>
                  <th scope="col">{t('purchases.bill.col.hsn')}</th>
                  <th scope="col" className="kit-numeric">{t('sales.amounts.taxable')}</th>
                  <th scope="col" className="kit-numeric">{t('purchases.bill.col.gst')}</th>
                  {rcm ? <th scope="col" className="kit-numeric">{t('purchases.bill.col.rcm')}</th> : null}
                  <th scope="col" className="kit-numeric">{t('purchases.bill.col.lineTotal')}</th>
                </tr>
              </thead>
              <tbody>
                {charges.map((l) => (
                  <tr key={l.id}>
                    <td>{t(`purchases.bill.charge.${l.charge}`)}: {l.description}</td>
                    <td>{l.hsn}</td>
                    <td className="kit-numeric">{money(l.amounts.taxable)}</td>
                    <td className="kit-numeric">{tax(l.amounts)}</td>
                    {rcm ? <td className="kit-numeric">{rcmTax(l.amounts)}</td> : null}
                    <td className="kit-numeric">{money(l.amounts.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {rcm ? <p className="admin-notice">{t('purchases.bill.rcm.note')}</p> : null}
      {jobWork.length === 0 ? null : (
        // A job worker's charges (#408), against the charge rate their job-work receipt recorded. Its four reference fields are
        // null for a reader who can't see that receipt, so they show nothing then.
        <div className="kit-table">
          <div className="kit-table-scroll" role="region" aria-labelledby={jobWorkId} tabIndex={0}>
            <table>
              <caption id={jobWorkId}>{t('purchases.bill.jobWork')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('purchases.bill.jobWork.made')}</th>
                  <th scope="col">{t('purchases.bill.jobWork.receipt')}</th>
                  <th scope="col" className="kit-numeric">{t('purchases.bill.col.qty')}</th>
                  <th scope="col" className="kit-numeric">{t('purchases.bill.jobWork.chargeRate')}</th>
                  <th scope="col" className="kit-numeric">{t('purchases.bill.col.rate')}</th>
                  <th scope="col" className="kit-numeric">{t('purchases.bill.jobWork.over')}</th>
                  <th scope="col">{t('purchases.bill.col.verdict')}</th>
                  <th scope="col">{t('purchases.bill.col.hsn')}</th>
                  <th scope="col" className="kit-numeric">{t('sales.amounts.taxable')}</th>
                  <th scope="col" className="kit-numeric">{t('purchases.bill.col.gst')}</th>
                  <th scope="col" className="kit-numeric">{t('purchases.bill.col.lineTotal')}</th>
                </tr>
              </thead>
              <tbody>
                {jobWork.map((l) => (
                  <tr key={l.id}>
                    <td>{l.name} ({l.sku})</td>
                    <td>{l.receiptNumber ?? ''}</td>
                    <td className="kit-numeric">{asWritten(l.qty)} {l.unit}</td>
                    <td className="kit-numeric">{l.chargeRate === null ? '' : asPrice(l.chargeRate)}</td>
                    <td className="kit-numeric">{asPrice(l.rate)}</td>
                    <td className="kit-numeric">{l.overChargeRate === null ? '' : `${asWritten(l.overChargeRate)}%`}</td>
                    <td>{l.overTolerance === null ? '' : l.overTolerance ? <strong>{t('purchases.bill.pastTolerance')}</strong> : t('purchases.bill.withinTolerance')}</td>
                    <td>{l.hsn}</td>
                    <td className="kit-numeric">{money(l.amounts.taxable)}</td>
                    <td className="kit-numeric">{tax(l.amounts)}</td>
                    <td className="kit-numeric">{money(l.amounts.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {bill.chargesOverTolerance ? <p className="admin-notice">{t('purchases.bill.chargesPast')}</p> : null}
    </>
  );
}
