'use client';
// A new invoice (RAD-125): a draft, which gets its number only when it's posted.
import { createInvoice, listInvoices } from '@radcore/lib-sales/contract';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { announce } from '../../../../../components/ui/live-region.tsx';
import { useApiMutation } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { InvoiceForm, NEW_INVOICE } from '../invoice-form.tsx';

export default function NewInvoicePage() {
  const router = useRouter();
  const create = useApiMutation(createInvoice, { invalidates: [listInvoices] });
  return (
    <>
      <p><Link href="/sales/invoices">{t('sales.back')}</Link></p>
      <h1 id="new-invoice">{t('sales.invoice.new.title')}</h1>
      <InvoiceForm labelledBy="new-invoice" initial={NEW_INVOICE} submit={t('sales.invoice.save')}
        onSubmit={async (v) => {
          const { id } = await create.submit({ ...v, shipTo: null });
          setTimeout(() => announce(t('sales.invoice.saved')), 0);
          router.push(`/sales/invoices/${id}`);
        }} />
    </>
  );
}
