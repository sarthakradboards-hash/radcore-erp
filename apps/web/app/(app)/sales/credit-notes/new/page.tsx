'use client';
// A new credit note (RAD-125): a draft against a posted invoice, which gets its number only when it is approved and posted.
import { createCreditNote, listCreditNotes } from '@radcore/lib-sales/contract';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { announce } from '../../../../../components/ui/live-region.tsx';
import { useApiMutation } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { CreditNoteForm } from '../credit-note-form.tsx';
import { NEW_CREDIT } from '../credit-values.ts';

export default function NewCreditNotePage() {
  const router = useRouter();
  const create = useApiMutation(createCreditNote, { invalidates: [listCreditNotes] });
  return (
    <>
      <p><Link href="/sales/credit-notes">{t('sales.back')}</Link></p>
      <h1 id="new-credit">{t('sales.credit.new.title')}</h1>
      <CreditNoteForm labelledBy="new-credit" initial={NEW_CREDIT} submit={t('sales.credit.save')}
        onSubmit={async (v) => {
          const { id } = await create.submit(v);
          setTimeout(() => announce(t('sales.credit.saved')), 0);
          router.push(`/sales/credit-notes/${id}`);
        }} />
    </>
  );
}
