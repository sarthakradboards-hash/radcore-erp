'use client';
// A new supplier return (RAD-143 on RAD-140's createSupplierReturn): saved as a draft, then posted from its page.
import { createSupplierReturn, listSupplierReturns } from '@radcore/lib-purchasing/contract';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { announce } from '../../../../../components/ui/live-region.tsx';
import { useApiMutation } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { ReturnForm } from '../return-form.tsx';
import { blankReturn } from '../return-values.ts';

export default function NewSupplierReturnPage() {
  const router = useRouter();
  const create = useApiMutation(createSupplierReturn, { invalidates: [listSupplierReturns] });
  return (
    <>
      <p><Link href="/purchases/returns">{t('purchases.return.back')}</Link></p>
      <h1 id="new-return">{t('purchases.return.new.title')}</h1>
      <ReturnForm labelledBy="new-return" initial={blankReturn()} onSubmit={async (v) => {
        const r = await create.submit(v);
        setTimeout(() => announce(t('purchases.return.saved')), 0);
        router.push(`/purchases/returns/${r.id}`);
      }} />
    </>
  );
}
