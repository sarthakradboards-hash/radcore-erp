'use client';
// The chart of accounts (RAD-100 on RAD-86's routes): every account, by type, with the account it sits under. A control
// account (receivables, payables, stock, GST) is posted only by its documents, never by a manual journal (M2-03); the
// screen says which they are, and the manual journal doesn't offer them.
import { listAccounts } from '@radcore/lib-accounts/contract';
import { ACCOUNT_TYPES } from '@radcore/lib-common';
import { useId } from 'react';
import { useApiQuery } from '../../../../lib/api/query.ts';
import { t } from '../../../../lib/i18n/index.ts';
import '../../../../components/ui/table/table.css';
import type { Account } from '../shared.tsx';

function TypeTable({ type, accounts, nameOf }: { type: Account['type']; accounts: Account[]; nameOf: (id: string) => string }) {
  const captionId = useId();
  return (
    <div className="kit-table">
      <div className="kit-table-scroll" role="region" aria-labelledby={captionId} tabIndex={0}>
        <table>
          <caption id={captionId}>{t(`books.type.${type}`)}</caption>
          <thead>
            <tr>
              <th scope="col">{t('books.chart.name')}</th>
              <th scope="col">{t('books.chart.under')}</th>
              <th scope="col">{t('books.chart.posting')}</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id}>
                <td>{a.name}</td>
                <td>{a.parentId === null ? '' : nameOf(a.parentId)}</td>
                <td>{t(a.control ? 'books.chart.control' : 'books.chart.manual')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ChartPage() {
  const q = useApiQuery(listAccounts, {});
  const accounts = q.data?.items;
  if (q.error !== null) return <p role="alert" className="kit-form-alert">{t('error.title')}</p>;
  if (accounts === undefined) return <p>{t('loading')}</p>;
  const nameOf = (id: string) => accounts.find((a) => a.id === id)?.name ?? '';
  return (
    <>
      <h1>{t('books.chart.title')}</h1>
      <p>{t('books.chart.intro')}</p>
      {ACCOUNT_TYPES.map((type) => {
        const ofType = accounts.filter((a) => a.type === type);
        return ofType.length === 0 ? null : <TypeTable key={type} type={type} accounts={ofType} nameOf={nameOf} />;
      })}
    </>
  );
}
