'use client';
// A draft supplier return rewritten whole (RAD-143 on RAD-140's updateSupplierReturn). Its supplier is fixed once saved.
import { getSupplierReturn, listSupplierReturns, updateSupplierReturn } from '@radcore/lib-purchasing/contract';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { announce } from '../../../../../../components/ui/live-region.tsx';
import { useApiMutation, useApiQuery } from '../../../../../../lib/api/query.ts';
import { t } from '../../../../../../lib/i18n/index.ts';
import { ReturnForm } from '../../return-form.tsx';
import { returnToForm } from '../../return-values.ts';

export default function EditSupplierReturnPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const q = useApiQuery(getSupplierReturn, { id });
  const update = useApiMutation(updateSupplierReturn, { invalidates: [getSupplierReturn, listSupplierReturns] });
  const r = q.data;
  const back = <p><Link href={`/purchases/returns/${id}`}>{t('purchases.return.backToReturn')}</Link></p>;
  if (q.error !== null) return <>{back}<p role="alert" className="kit-form-alert">{t('purchases.return.missing')}</p></>;
  if (r === undefined) return <p>{t('loading')}</p>;
  if (r.status !== 'draft') return <>{back}<p>{t('purchases.return.notDraft')}</p></>;
  return (
    <>
      {back}
      <h1 id="edit-return">{t('purchases.return.edit.title')}</h1>
      <ReturnForm labelledBy="edit-return" initial={returnToForm(r)} supplier={{ id: r.supplierId, name: r.supplierName }}
        onSubmit={async (v) => {
          // The supplier is fixed once saved, so the update doesn't take it.
          await update.submit({ id, businessDate: v.businessDate, locationId: v.locationId, reason: v.reason, notes: v.notes, lines: v.lines });
          setTimeout(() => announce(t('purchases.return.saved')), 0);
          router.push(`/purchases/returns/${id}`);
        }} />
    </>
  );
}
