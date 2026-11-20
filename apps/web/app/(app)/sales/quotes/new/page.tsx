'use client';
// A new quote (RAD-125): a draft, which gets its number only when it's sent.
import { createQuote, listQuotes } from '@radcore/lib-sales/contract';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { announce } from '../../../../../components/ui/live-region.tsx';
import { useApiMutation } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { DocumentForm, NEW_DOCUMENT } from '../../document-form.tsx';

export default function NewQuotePage() {
  const router = useRouter();
  const create = useApiMutation(createQuote, { invalidates: [listQuotes] });
  return (
    <>
      <p><Link href="/sales/quotes">{t('sales.back')}</Link></p>
      <h1 id="new-quote">{t('sales.quote.new.title')}</h1>
      <DocumentForm labelledBy="new-quote" initial={NEW_DOCUMENT} quote submit={t('sales.quote.save')}
        onSubmit={async (v) => {
          const { id } = await create.submit(v);
          setTimeout(() => announce(t('sales.quote.saved')), 0);
          router.push(`/sales/quotes/${id}`);
        }} />
    </>
  );
}
