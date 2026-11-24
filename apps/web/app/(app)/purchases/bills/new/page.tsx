'use client';
// A new purchase bill (RAD-143 on RAD-138's createPurchaseBill): saved as a draft, then posted from its page.
import { createPurchaseBill, listPurchaseBills } from '@radcore/lib-purchasing/contract';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { announce } from '../../../../../components/ui/live-region.tsx';
import { useApiMutation } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { BillForm } from '../bill-form.tsx';
import { blankBill } from '../bill-values.ts';

export default function NewPurchaseBillPage() {
  const router = useRouter();
  const create = useApiMutation(createPurchaseBill, { invalidates: [listPurchaseBills] });
  return (
    <>
      <p><Link href="/purchases/bills">{t('purchases.bill.back')}</Link></p>
      <h1 id="new-bill">{t('purchases.bill.new.title')}</h1>
      <BillForm labelledBy="new-bill" initial={blankBill()} submit={t('purchases.bill.saveDraft')}
        onSubmit={async (v) => {
          const r = await create.submit(v);
          setTimeout(() => announce(t('purchases.bill.saved')), 0);
          router.push(`/purchases/bills/${r.id}`);
        }} />
    </>
  );
}
