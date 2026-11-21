'use client';
// Editing a draft invoice (RAD-125): it is rewritten whole. A posted invoice is never edited. The ship-to (a different
// address than the buyer's) isn't edited here yet: a draft keeps the one it has.
import { getInvoice, listInvoices, updateInvoice } from '@radcore/lib-sales/contract';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { announce } from '../../../../../../components/ui/live-region.tsx';
import { useApiMutation, useApiQuery } from '../../../../../../lib/api/query.ts';
import { t } from '../../../../../../lib/i18n/index.ts';
import { asPrice, asWritten } from '../../../../admin/decimal.ts';
import { InvoiceForm } from '../../invoice-form.tsx';

export default function EditInvoicePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const q = useApiQuery(getInvoice, { id });
  const update = useApiMutation(updateInvoice, { invalidates: [getInvoice, listInvoices] });
  const invoice = q.data;
  const back = <p><Link href={`/sales/invoices/${id}`}>{t('sales.back')}</Link></p>;
  if (q.error !== null) return <>{back}<p role="alert" className="kit-form-alert">{t('sales.missing')}</p></>;
  if (invoice === undefined) return <p>{t('loading')}</p>;
  if (invoice.status !== 'draft') return <>{back}<p role="alert" className="kit-form-alert">{t('sales.err.wrong_status')}</p></>;
  // A ship-to address is personal data. A person who can't see it can't send it back, and a save without it would replace
  // it with nothing, so this draft isn't edited by them.
  const shipTo = invoice.shipTo;
  if (shipTo !== null && typeof shipTo.address !== 'string') return <>{back}<p role="alert" className="kit-form-alert">{t('sales.invoice.edit.hidden')}</p></>;
  return (
    <>
      {back}
      <h1 id="edit-invoice">{t('sales.invoice.edit.title')}</h1>
      <InvoiceForm labelledBy="edit-invoice" submit={t('sales.invoice.save')} party={{ id: invoice.partyId, name: invoice.partyName }}
        initial={{ partyId: invoice.partyId, businessDate: invoice.businessDate, notes: invoice.notes ?? '',
          lines: invoice.lines.map((l) => ({ deliveryLineId: l.deliveryLineId, itemId: l.itemId, qty: asWritten(l.qty),
            rate: asPrice(l.rate), discountPercent: asWritten(l.discountPercent) })) }}
        onSubmit={async (v) => {
          await update.submit({ id, ...v, shipTo: shipTo === null ? null : { ...shipTo, address: String(shipTo.address) } });
          setTimeout(() => announce(t('sales.invoice.saved')), 0);
          router.push(`/sales/invoices/${id}`);
        }} />
    </>
  );
}
