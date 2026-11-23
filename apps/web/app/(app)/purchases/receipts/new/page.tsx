'use client';
// A new arrival (RAD-143): a draft against a placed purchase order. It gets its number only when QC posts it.
import { createGoodsReceipt, listGoodsReceipts } from '@radcore/lib-purchasing/contract';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMe } from '../../../../../components/shell/session-provider.tsx';
import { announce } from '../../../../../components/ui/live-region.tsx';
import { useApiMutation } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { ArrivalForm } from '../arrival-form.tsx';
import { NEW_ARRIVAL } from '../arrival-values.ts';

export default function NewArrivalPage() {
  const router = useRouter();
  const mayWrite = useMe().permissions.includes('inward:write');
  const create = useApiMutation(createGoodsReceipt, { invalidates: [listGoodsReceipts] });
  const back = <p><Link href="/purchases/receipts">{t('inward.back')}</Link></p>;
  if (!mayWrite) return <>{back}<p role="alert" className="kit-form-alert">{t('inward.err.forbidden')}</p></>;
  return (
    <>
      {back}
      <h1 id="new-arrival">{t('inward.form.new.title')}</h1>
      <ArrivalForm labelledBy="new-arrival" initial={NEW_ARRIVAL} submit={t('inward.form.save')}
        onSubmit={async (v) => {
          const { id } = await create.submit(v);
          setTimeout(() => announce(t('inward.form.saved')), 0);
          router.push(`/purchases/receipts/${id}`);
        }} />
    </>
  );
}
