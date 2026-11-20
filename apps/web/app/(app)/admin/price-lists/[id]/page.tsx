'use client';
// One price list (RAD-99 on RAD-98's contracts): the version in force and its rates, and the draft that changes them.
// A list with no draft gets one from prices:write, copied from the version in force.
import { formatDate } from '@radcore/lib-common';
import { getPriceList, listPriceListRates, listPriceLists, startPriceListDraft } from '@radcore/lib-sales/contract';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { z } from 'zod';
import { useMe } from '../../../../../components/shell/session-provider.tsx';
import { Form, SubmitButton } from '../../../../../components/ui/form/form.tsx';
import { DataTable } from '../../../../../components/ui/table/data-table.tsx';
import { useApiList, useApiMutation, useApiQuery } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { Draft, rateColumns } from './draft.tsx';

const nothing = z.object({});

function InForce({ versionId, name }: { versionId: string; name: string }) {
  const rates = useApiList(listPriceListRates, { id: versionId, filter: {} });
  return <DataTable caption={t('admin.prices.rates.inForce', { name })} columns={rateColumns} rowKey={(r) => r.itemId}
    list={rates} empty={t('admin.prices.rates.empty')} />;
}

export default function PriceListPage() {
  const { id } = useParams<{ id: string }>();
  const mayWrite = useMe().permissions.includes('prices:write');
  const q = useApiQuery(getPriceList, { id });
  const start = useApiMutation(startPriceListDraft, { invalidates: [getPriceList, listPriceLists] });
  const l = q.data;

  if (q.error !== null) {
    return (
      <>
        <p><Link href="/admin/price-lists">{t('admin.prices.back')}</Link></p>
        <div role="alert" className="kit-form-alert">
          {t('admin.prices.missing')}{' '}
          <button type="button" className="kit-button" onClick={() => void q.refetch()}>{t('error.retry')}</button>
        </div>
      </>
    );
  }
  if (l === undefined) return <p>{t('loading')}</p>;

  return (
    <>
      <p><Link href="/admin/price-lists">{t('admin.prices.back')}</Link></p>
      <h1>{l.name}</h1>
      <dl className="admin-facts" aria-label={t('admin.prices.facts')}>
        <dt>{t('admin.prices.inForce')}</dt>
        <dd>{l.inForce === null ? t('admin.prices.notApproved') : t('admin.prices.since', { when: formatDate(l.inForce.inForceFrom) })}</dd>
        {l.inForce === null ? null : (
          <><dt>{t('admin.prices.tax')}</dt><dd>{t(l.inForce.taxInclusive ? 'admin.prices.tax.inclusive' : 'admin.prices.tax.exclusive')}</dd></>
        )}
        <dt>{t('admin.locations.col.status')}</dt><dd>{t(l.active ? 'admin.locations.active' : 'admin.locations.inactive')}</dd>
      </dl>

      <h2>{t('admin.prices.inForce')}</h2>
      {l.inForce === null ? <p>{t('admin.prices.notApproved')}</p> : <InForce versionId={l.inForce.versionId} name={l.name} />}

      <h2 id="draft">{t('admin.prices.draft')}</h2>
      {l.draftId !== null ? <Draft draftId={l.draftId} name={l.name} /> : mayWrite ? (
        <Form aria-labelledby="draft" schema={nothing} defaultValues={{}} saved={t('admin.prices.draft.started')}
          onSubmit={() => start.submit({ id })}>
          <p>{t('admin.prices.draft.startHint')}</p>
          <SubmitButton>{t('admin.prices.draft.start')}</SubmitButton>
        </Form>
      ) : <p>{t('admin.prices.draft.noneWaiting')}</p>}
    </>
  );
}
