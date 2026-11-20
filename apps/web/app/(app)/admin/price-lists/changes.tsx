'use client';
// What a price-list version changes against the version in force now (RAD-98's getPriceListChanges): shown to the
// person drafting it and, beside the approval's hash, to the person approving it, so nobody approves blind (RC-037).
// Every item whose rate differs, by SKU: new (not priced in force), taken out (no proposed rate), or changed.
import { getPriceListChanges } from '@radcore/lib-sales/contract';
import { useId } from 'react';
import { useApiQuery } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import '../../../../components/ui/table/table.css';
import { asPrice } from '../decimal.ts';

export function PriceChanges({ versionId }: { versionId: string }) {
  const captionId = useId();
  const q = useApiQuery(getPriceListChanges, { id: versionId });
  const c = q.data;
  if (q.error !== null) return <p role="alert" className="kit-form-alert">{t('error.title')}</p>;
  if (c === undefined) return <p>{t('loading')}</p>;
  const taxMoved = c.inForce !== null && c.inForce.taxInclusive !== c.taxInclusive;
  return (
    <>
      <p>
        {t(c.taxInclusive ? 'admin.prices.changes.taxIn' : 'admin.prices.changes.taxOut')}
        {taxMoved ? ` ${t('admin.prices.changes.taxMoved')}` : ''}
      </p>
      {c.changes.length === 0 ? <p>{t('admin.prices.changes.none')}</p> : (
        <div className="kit-table">
          <div className="kit-table-scroll" role="region" aria-labelledby={captionId} tabIndex={0}>
            <table>
              <caption id={captionId}>{t('admin.prices.changes.caption', { n: String(c.changes.length), name: c.name })}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('admin.items.sku')}</th>
                  <th scope="col">{t('admin.items.name')}</th>
                  <th scope="col">{t('admin.items.unit')}</th>
                  <th scope="col" className="kit-numeric">{t('admin.prices.changes.inForce')}</th>
                  <th scope="col" className="kit-numeric">{t('admin.prices.changes.proposed')}</th>
                  <th scope="col">{t('admin.prices.changes.what')}</th>
                </tr>
              </thead>
              <tbody>
                {c.changes.map((r) => (
                  <tr key={r.itemId}>
                    <td>{r.sku}</td>
                    <td>{r.name}</td>
                    <td>{r.unit}</td>
                    <td className="kit-numeric">{r.inForce === null ? '—' : asPrice(r.inForce)}</td>
                    <td className="kit-numeric">{r.proposed === null ? '—' : asPrice(r.proposed)}</td>
                    <td>{t(r.inForce === null ? 'admin.prices.changes.new' : r.proposed === null ? 'admin.prices.changes.out' : 'admin.prices.changes.changed')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
