'use client';
// One delivery (RAD-125 on RAD-112's contracts), in the record layout: where it is (the status bar), the order it goes
// against and the returns taken against it (related-record buttons), its facts and its lines with what posting wrote. A
// draft is posted (the credit check runs again; when it finds issues the dialog names them and offers an override request,
// which someone with sales:override decides) or deleted; a posted delivery is cancelled with a date and a reason under
// deliveries:cancel, while nothing on it is invoiced or taken back. Its form waits for the stock-by-batch read.
import { dateString, formatDate, indiaDate } from '@radcore/lib-common';
import {
  cancelDelivery, countDeliveryReturns, deleteDelivery, getDelivery, listDeliveries, listDeliveryReturns, postDelivery, printChallan, requestDeliveryOverride,
} from '@radcore/lib-sales/contract';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { z } from 'zod';
import { useMe } from '../../../../../components/shell/session-provider.tsx';
import { CloseButton, Dialog } from '../../../../../components/ui/dialog/dialog.tsx';
import { TextAreaField, TextField } from '../../../../../components/ui/form/fields.tsx';
import { Form, SubmitButton } from '../../../../../components/ui/form/form.tsx';
import { announce } from '../../../../../components/ui/live-region.tsx';
import { CountCards, RelatedRecords, StatusBar } from '../../../../../components/ui/record/record.tsx';
import { useApiList, useApiMutation, useApiQuery } from '../../../../../lib/api/query.ts';
import { t } from '../../../../../lib/i18n/index.ts';
import { ConfirmDialog } from '../../../admin/shared.tsx';
import { OverrideConfirm } from '../../override-confirm.tsx';
import { SALES_MESSAGES } from '../../shared.tsx';
import { deliverySteps } from '../../status.ts';
import { DELIVERY_CANCEL_MESSAGES, DELIVERY_MESSAGES, DocumentLines, PlaceName } from '../shared.tsx';
import { PrintButtons } from '../../print-buttons.tsx';

const later = (text: string) => setTimeout(() => announce(text), 0);
const cancelSchema = z.object({ businessDate: dateString(), reason: cancelDelivery.input.shape.reason });
type Dialogs = 'post' | 'cancel' | 'delete' | null;

export default function DeliveryPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { permissions } = useMe();
  const mayWrite = permissions.includes('deliveries:write');
  const mayCancel = permissions.includes('deliveries:cancel');
  const q = useApiQuery(getDelivery, { id });
  const returns = useApiList(listDeliveryReturns, { filter: { deliveryId: id } });
  // The count comes from the server's own count, never from adding up the page of links above (RC-176).
  const counts = useApiQuery(countDeliveryReturns, { deliveryId: id });
  const again = [getDelivery, listDeliveries];
  const post = useApiMutation(postDelivery, { invalidates: again });
  const override = useApiMutation(requestDeliveryOverride, { invalidates: again });
  const cancel = useApiMutation(cancelDelivery, { invalidates: again });
  // A deleted record is gone: refetching it would be a 404, so only the list is refreshed.
  const remove = useApiMutation(deleteDelivery, { invalidates: [listDeliveries] });
  const [dialog, setDialog] = useState<Dialogs>(null);
  const delivery = q.data;

  if (q.error !== null) {
    return (
      <>
        <p><Link href="/sales/deliveries">{t('sales.back')}</Link></p>
        <div role="alert" className="kit-form-alert">
          {t('sales.missing')} <button type="button" className="kit-button" onClick={() => void q.refetch()}>{t('error.retry')}</button>
        </div>
      </>
    );
  }
  if (delivery === undefined) return <p>{t('loading')}</p>;
  const open = (which: Exclude<Dialogs, null>) => () => setDialog(which);
  const shut = (isOpen: boolean) => { if (!isOpen) setDialog(null); };
  const taken = returns.items;

  return (
    <>
      <p><Link href="/sales/deliveries">{t('sales.back')}</Link></p>
      <h1>{delivery.number === null ? t('sales.delivery.title.draft') : t('sales.delivery.title', { number: delivery.number })}</h1>
      <StatusBar label={t('sales.status.step')} steps={deliverySteps(delivery.status)} current={delivery.status} />
      <RelatedRecords label={t('sales.related')} links={[
        { label: t('sales.delivery.order'), href: `/sales/orders/${delivery.orderId}` },
        ...taken.map((r) => ({ label: `${t('sales.delivery.returns')}: ${r.number ?? t('sales.draft')}`, href: `/sales/delivery-returns/${r.id}` })),
      ]} />
      <CountCards label={t('sales.counts')} cards={[
        { label: t('sales.count.lines'), value: String(delivery.lines.length) },
        ...Object.entries(counts.data?.byStatus ?? {}).filter(([, n]) => n > 0)
          .map(([status, n]) => ({ label: `${t('sales.delivery.returns.count')}: ${t(`sales.return.status.${status as 'draft'}`)}`, value: String(n) })),
      ]} />
      <dl className="admin-facts" aria-label={t('sales.facts')}>
        <dt>{t('sales.party')}</dt><dd>{delivery.partyName}</dd>
        <dt>{t('sales.date')}</dt><dd>{formatDate(delivery.businessDate)}</dd>
        <dt>{t('sales.delivery.place')}</dt><dd><PlaceName id={delivery.locationId} /></dd>
        <dt>{t('sales.notes')}</dt><dd>{delivery.notes ?? t('sales.noNotes')}</dd>
      </dl>
      <DocumentLines caption={delivery.number === null ? t('sales.lines') : t('sales.lines.of', { number: delivery.number })} lines={delivery.lines} />
      <div className="kit-actions">
        {delivery.status !== 'draft' ? <PrintButtons contract={printChallan} id={id} /> : null}
        {mayWrite && delivery.status === 'draft' ? (
          <>
            <Link className="kit-button" href={`/sales/deliveries/${id}/edit`}>{t('sales.delivery.edit')}</Link>
            <button type="button" className="kit-button kit-button-primary" onClick={open('post')}>{t('sales.delivery.post')}</button>
            <button type="button" className="kit-button" onClick={open('delete')}>{t('sales.delete')}</button>
          </>
        ) : null}
        {mayCancel && delivery.status === 'posted' ? (
          <button type="button" className="kit-button" onClick={open('cancel')}>{t('sales.delivery.cancel')}</button>
        ) : null}
      </div>

      <OverrideConfirm open={dialog === 'post'} onOpenChange={shut} title={t('sales.delivery.post.title')} body={t('sales.delivery.post.body')}
        action={t('sales.delivery.post')} messages={DELIVERY_MESSAGES} overrideBody={t('sales.delivery.override.body')} overrideAction={t('sales.delivery.override')}
        onConfirm={async () => t('sales.delivery.posted', { number: (await post.submit({ id })).number })}
        onAskOverride={async () => { await override.submit({ id }); return t('sales.delivery.overridden'); }} />

      <ConfirmDialog open={dialog === 'delete'} onOpenChange={shut} messages={SALES_MESSAGES} title={t('sales.delivery.delete.title')}
        body={t('sales.delivery.delete.body')} action={t('sales.delete')} done={t('sales.delivery.deleted')}
        onConfirm={async () => { await remove.submit({ id }); router.push('/sales/deliveries'); }} />

      <Dialog open={dialog === 'cancel'} onOpenChange={shut} title={t('sales.delivery.cancel.title', { number: delivery.number ?? '' })}
        description={t('sales.delivery.cancel.body')}>
        <Form schema={cancelSchema} saved={false} messages={DELIVERY_CANCEL_MESSAGES} defaultValues={{ businessDate: indiaDate(new Date()), reason: '' }}
          onSubmit={async (v) => { await cancel.submit({ id, ...v }); setDialog(null); later(t('sales.delivery.cancelled')); }}>
          <TextField name="businessDate" label={t('sales.delivery.cancel.date')} type="date" />
          <TextAreaField name="reason" label={t('sales.reason')} />
          <div className="kit-actions">
            <CloseButton>{t('sales.cancel')}</CloseButton>
            <SubmitButton>{t('sales.delivery.cancel')}</SubmitButton>
          </div>
        </Form>
      </Dialog>
    </>
  );
}
