'use client';
// QC for an arrival (RAD-143 on postGoodsReceipt, inward:qc): each line split into accepted and rejected, by batch and unit. Saving
// posts the receipt in one go. Only a draft is inspected.
import { getGoodsReceipt, listGoodsReceipts, postGoodsReceipt } from '@radcore/lib-purchasing/contract';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMe } from '../../../../../../components/shell/session-provider.tsx';
import { announce } from '../../../../../../components/ui/live-region.tsx';
import { useApiMutation, useApiQuery } from '../../../../../../lib/api/query.ts';
import { t } from '../../../../../../lib/i18n/index.ts';
import { QcForm } from '../../qc-form.tsx';
import { qcStart } from '../../qc-values.ts';

export default function QcPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const mayQc = useMe().permissions.includes('inward:qc');
  const q = useApiQuery(getGoodsReceipt, { id });
  const post = useApiMutation(postGoodsReceipt, { invalidates: [getGoodsReceipt, listGoodsReceipts] });
  const receipt = q.data;
  const back = <p><Link href={`/purchases/receipts/${id}`}>{t('inward.back')}</Link></p>;
  if (!mayQc) return <>{back}<p role="alert" className="kit-form-alert">{t('inward.err.forbidden')}</p></>;
  if (q.error !== null) return <>{back}<p role="alert" className="kit-form-alert">{t('inward.missing')}</p></>;
  if (receipt === undefined) return <p>{t('loading')}</p>;
  if (receipt.status !== 'draft') return <>{back}<p role="alert" className="kit-form-alert">{t('inward.qc.err.draft')}</p></>;
  return (
    <>
      {back}
      <h1 id="qc-title">{t('inward.qc.title')}</h1>
      <QcForm labelledBy="qc-title" initial={qcStart(receipt.lines)}
        onSubmit={async (v) => {
          const { number } = await post.submit({ id, lines: v.lines });
          setTimeout(() => announce(t('inward.qc.posted', { number })), 0);
          router.push(`/purchases/receipts/${id}`);
        }} />
    </>
  );
}
