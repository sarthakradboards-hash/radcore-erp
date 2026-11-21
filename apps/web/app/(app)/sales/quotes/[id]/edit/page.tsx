'use client';
// Editing a draft quote (RAD-125): it is rewritten whole. A quote that has been sent is no longer edited.
import { getQuote, listQuotes, updateQuote } from '@radcore/lib-sales/contract';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { announce } from '../../../../../../components/ui/live-region.tsx';
import { useApiMutation, useApiQuery } from '../../../../../../lib/api/query.ts';
import { t } from '../../../../../../lib/i18n/index.ts';
import { asPrice, asWritten } from '../../../../admin/decimal.ts';
import { DocumentForm } from '../../../document-form.tsx';

export default function EditQuotePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const q = useApiQuery(getQuote, { id });
  const update = useApiMutation(updateQuote, { invalidates: [getQuote, listQuotes] });
  const quote = q.data;
  const back = <p><Link href={`/sales/quotes/${id}`}>{t('sales.back')}</Link></p>;
  if (q.error !== null) return <>{back}<p role="alert" className="kit-form-alert">{t('sales.missing')}</p></>;
  if (quote === undefined) return <p>{t('loading')}</p>;
  if (quote.status !== 'draft') return <>{back}<p role="alert" className="kit-form-alert">{t('sales.err.wrong_status')}</p></>;
  return (
    <>
      {back}
      <h1 id="edit-quote">{t('sales.quote.edit.title')}</h1>
      <DocumentForm labelledBy="edit-quote" quote submit={t('sales.quote.save')} party={{ id: quote.partyId, name: quote.partyName }}
        initial={{ partyId: quote.partyId, businessDate: quote.businessDate, validUntil: quote.validUntil ?? '', notes: quote.notes ?? '',
          lines: quote.lines.map((l) => ({ itemId: l.itemId, qty: asWritten(l.qty), rate: asPrice(l.rate), discountPercent: asWritten(l.discountPercent) })) }}
        onSubmit={async (v) => {
          await update.submit({ id, ...v });
          setTimeout(() => announce(t('sales.quote.saved')), 0);
          router.push(`/sales/quotes/${id}`);
        }} />
    </>
  );
}
