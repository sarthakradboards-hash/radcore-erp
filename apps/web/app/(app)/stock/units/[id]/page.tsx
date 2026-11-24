'use client';
// One serialised unit (RAD-144 on #394's getStockUnit): whose it is, where, in what condition, and its trail, oldest first. Each
// event names the document that moved it, linked where the screens have a page for that document.
import { formatDate } from '@radcore/lib-common';
import { getStockUnit } from '@radcore/lib-stock/contract';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useId } from 'react';
import { useApiQuery } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import '../../../../../components/ui/table/table.css';

/** A document's page, by the table the trail names; a document without one shows its kind alone. */
const PAGES: Partial<Record<string, string>> = {
  goods_receipts: '/purchases/receipts', deliveries: '/sales/deliveries', delivery_returns: '/sales/delivery-returns',
  invoices: '/sales/invoices', stock_transfers: '/stock/transfers', stock_adjustments: '/stock/adjustments', stock_counts: '/stock/counts',
  job_work_challans: '/stock/job-work', job_work_receipts: '/stock/job-work/receipts', sales_orders: '/sales/orders',
  credit_notes: '/sales/credit-notes', purchase_bills: '/purchases/bills', supplier_returns: '/purchases/returns',
};

export default function StockUnitPage() {
  const { id } = useParams<{ id: string }>();
  const q = useApiQuery(getStockUnit, { id });
  const captionId = useId();
  const u = q.data;
  const back = <p><Link href="/stock/units">{t('stock.units.back')}</Link></p>;
  if (q.error !== null) {
    return (
      <>
        {back}
        <div role="alert" className="kit-form-alert">
          {t('stock.units.missing')} <button type="button" className="kit-button" onClick={() => void q.refetch()}>{t('error.retry')}</button>
        </div>
      </>
    );
  }
  if (u === undefined) return <p>{t('loading')}</p>;
  return (
    <>
      {back}
      <h1>{t('stock.units.unit', { serial: u.serialNo })}</h1>
      <dl className="admin-facts" aria-label={t('stock.facts')}>
        <dt>{t('stock.line.item')}</dt><dd>{u.name} ({u.sku})</dd>
        <dt>{t('stock.units.chassis')}</dt><dd>{u.chassisNo ?? t('stock.units.noChassis')}</dd>
        <dt>{t('stock.units.ownership')}</dt><dd>{t(`stock.units.ownership.${u.ownership}`)}</dd>
        <dt>{t('stock.place')}</dt><dd>{u.locationName ?? t('stock.units.nowhere')}</dd>
        <dt>{t('stock.units.condition')}</dt><dd>{t(`stock.adjustment.condition.${u.condition}`)}</dd>
        <dt>{t('stock.line.batch')}</dt><dd>{u.batchNo ?? t('stock.batch.none')}</dd>
        {u.promised ? <><dt>{t('stock.units.promised')}</dt><dd>{t('stock.units.promised.yes')}</dd></> : null}
      </dl>
      <div className="kit-table">
        <div className="kit-table-scroll" role="region" aria-labelledby={captionId} tabIndex={0}>
          <table>
            <caption id={captionId}>{t('stock.units.trail')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('stock.col.date')}</th>
                <th scope="col">{t('stock.units.event')}</th>
                <th scope="col">{t('stock.place')}</th>
                <th scope="col">{t('stock.units.condition')}</th>
                <th scope="col">{t('stock.units.document')}</th>
              </tr>
            </thead>
            <tbody>
              {u.events.map((e) => {
                const page = PAGES[e.source.table];
                const kind = t(`stock.units.event.${e.kind}`);
                return (
                  <tr key={e.id}>
                    <td>{formatDate(e.businessDate)}</td>
                    <td>{kind}</td>
                    <td>{e.locationName ?? ''}</td>
                    <td>{e.condition === null ? '' : t(`stock.adjustment.condition.${e.condition}`)}</td>
                    <td>{page === undefined ? '' : <Link href={`${page}/${e.source.id}`}>{t('stock.units.openDocument')}</Link>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
