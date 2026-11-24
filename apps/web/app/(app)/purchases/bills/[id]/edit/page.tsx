'use client';
// A draft purchase bill rewritten whole (RAD-143 on RAD-138's updatePurchaseBill): its receipt lines named once the goods are in,
// its file attached. A posted or cancelled bill isn't a draft any more, so it's refused (`wrong_status`, worded).
import { getPurchaseBill, listPurchaseBills, updatePurchaseBill } from '@radcore/lib-purchasing/contract';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { announce } from '../../../../../../components/ui/live-region.tsx';
import { useApiMutation, useApiQuery } from '../../../../../../lib/api/query.ts';
import { t } from '../../../../../../lib/i18n/index.ts';
import { BillForm } from '../../bill-form.tsx';
import { billToForm } from '../../bill-values.ts';

export default function EditPurchaseBillPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const q = useApiQuery(getPurchaseBill, { id });
  const update = useApiMutation(updatePurchaseBill, { invalidates: [getPurchaseBill, listPurchaseBills] });
  const b = q.data;
  const back = <p><Link href={`/purchases/bills/${id}`}>{t('purchases.bill.backToBill')}</Link></p>;
  if (q.error !== null) return <>{back}<p role="alert" className="kit-form-alert">{t('purchases.bill.missing')}</p></>;
  if (b === undefined) return <p>{t('loading')}</p>;
  if (b.status !== 'draft') return <>{back}<p>{t('purchases.bill.notDraft')}</p></>;
  return (
    <>
      {back}
      <h1 id="edit-bill">{t('purchases.bill.edit.title', { invoice: b.supplierInvoiceNumber })}</h1>
      <BillForm labelledBy="edit-bill" initial={billToForm(b)} supplier={{ id: b.supplierId, name: b.supplierName }} submit={t('purchases.bill.saveDraft')}
        onSubmit={async (v) => {
          await update.submit({ id, ...v });
          setTimeout(() => announce(t('purchases.bill.saved')), 0);
          router.push(`/purchases/bills/${id}`);
        }} />
    </>
  );
}
